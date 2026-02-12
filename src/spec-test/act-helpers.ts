// ============================================================================
// ACT HELPERS — retry orchestration, select dispatch, stabilization
// ============================================================================

import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { Tester } from "../b-test";
import type { ActResult, SpecStep, StepResult } from "./types";

import {
  executeActStep,
  extractSelectAction,
  getEnhancedErrorContext,
  MAX_RETRIES,
  RETRY_DELAY,
} from "./step-execution";
import { detectModalInDOM } from "./modal-handler";

/** Delay helper for retry and stabilization logic. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Check if an error is retryable (transient API errors). */
export function isRetryableError(message: string): boolean {
  return /schema|No object generated|rate|timeout|ECONNRESET|ETIMEDOUT/i.test(message);
}

/**
 * Execute a page action (navigation or refresh) with shared try/catch pattern.
 * Returns a StepResult for the action.
 */
export async function executePageAction(
  step: SpecStep, page: Page, stepStart: number,
  action: () => Promise<void>
): Promise<StepResult> {
  try {
    await action();
    await page.waitForLoadState('networkidle');
    const duration = Date.now() - stepStart;
    return { step, success: true, duration, actResult: { success: true, duration, pageUrl: page.url() } };
  } catch (error) {
    const duration = Date.now() - stepStart;
    return { step, success: false, duration, actResult: { success: false, duration, error: error instanceof Error ? error.message : String(error) } };
  }
}

/**
 * Try to dismiss a blocking modal/overlay by pressing Escape, then retry the action.
 * Returns the result of the retry, or null if no modal was detected/dismissed.
 */
export async function tryDismissModalAndRetry(
  instruction: string,
  stagehand: Stagehand,
  page: Page
): Promise<ActResult | null> {
  try {
    await page.keyboard.press('Escape');
    await delay(500);

    const retryResult = await executeActStep(instruction, stagehand);
    if (retryResult.success) {
      console.log(`[executeActWithRetry] Modal dismissed (Escape), retry succeeded for: "${instruction.slice(0, 60)}..."`);
      return retryResult;
    }
  } catch { /* modal dismissal didn't help */ }
  return null;
}

/**
 * Fallback for select/dropdown interactions that Stagehand can't handle.
 * Finds visible <select> elements on the page and sets the value directly via DOM.
 * Returns an ActResult on success, or null if no matching select was found.
 */
export async function trySelectFallback(page: Page, instruction: string): Promise<ActResult | null> {
  const selectAction = extractSelectAction(instruction);
  if (!selectAction) return null;

  try {
    const result = await page.evaluate((targetValue: string) => {
      const selects = Array.from(document.querySelectorAll('select'));
      for (const select of selects) {
        const rect = select.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0) continue;

        const options = Array.from(select.options);
        const match = options.find(opt =>
          opt.text.trim().toLowerCase() === targetValue.toLowerCase() ||
          opt.value.toLowerCase() === targetValue.toLowerCase()
        );

        if (match) {
          select.value = match.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          select.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, selectAction.value);

    if (result) {
      console.log(`[trySelectFallback] Direct DOM select succeeded for value "${selectAction.value}"`);
      return { success: true, duration: 0, pageUrl: page.url() };
    }
  } catch {
    console.log(`[trySelectFallback] DOM select fallback failed for "${selectAction.value}"`);
  }

  return null;
}

/**
 * Observe-first select/dropdown dispatch.
 * Uses stagehand.observe() to detect element type BEFORE choosing an interaction method.
 * - Native <select> → page.locator(selector).selectOption(value) (~100ms, always works)
 * - Custom <div>/<ul> dropdown → Two act() calls: click to open + click option
 * - Fallback → trySelectFallback() DOM manipulation
 * Returns an ActResult on success, or null to fall through to executeActWithRetry().
 */
export async function executeSelectAction(
  instruction: string, stagehand: Stagehand, page: Page
): Promise<ActResult | null> {
  const selectAction = extractSelectAction(instruction);
  if (!selectAction) return null;

  const startTime = Date.now();
  const { value } = selectAction;

  try {
    const observations = await stagehand.observe(instruction);
    if (!observations || observations.length === 0) {
      console.log(`[executeSelectAction] observe() returned no results — falling through to fallback`);
      return trySelectFallback(page, instruction);
    }

    const observation = observations[0];
    const selector = observation.selector;
    const observeMethod = (observation.method || '').toLowerCase();

    const isNativeSelect = observeMethod === 'selectoption' || observeMethod === 'select';
    console.log(`[executeSelectAction] observe method="${observeMethod}", isNativeSelect=${isNativeSelect} for "${instruction.slice(0, 60)}"`);

    // Native <select> → Playwright selectOption (fast, reliable, no LLM calls)
    if (isNativeSelect) {
      try {
        await page.locator(selector).first().selectOption({ label: value });
        console.log(`[executeSelectAction] selectOption(label: "${value}") succeeded`);
        return { success: true, duration: Date.now() - startTime, pageUrl: page.url() };
      } catch {
        try {
          await page.locator(selector).first().selectOption(value);
          console.log(`[executeSelectAction] selectOption("${value}") succeeded`);
          return { success: true, duration: Date.now() - startTime, pageUrl: page.url() };
        } catch {
          console.log(`[executeSelectAction] selectOption failed — falling through to DOM fallback`);
        }
      }
    }

    // Non-native (custom dropdown or input autocomplete) → use Stagehand act
    if (!isNativeSelect) {
      try {
        await stagehand.act(`Click on the ${observation.description || 'dropdown'} to open it`);
        await delay(300);
        await stagehand.act(`Click the option "${value}" in the dropdown list`);
        console.log(`[executeSelectAction] Custom dropdown dispatch succeeded for "${value}"`);
        return { success: true, duration: Date.now() - startTime, pageUrl: page.url() };
      } catch {
        console.log(`[executeSelectAction] Custom dropdown dispatch failed — falling through`);
      }
    }
  } catch (error) {
    console.log(`[executeSelectAction] observe() failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return trySelectFallback(page, instruction);
}

/**
 * Execute an Act step with retry logic for transient errors.
 * On final failure, attempts modal dismissal (Escape) before giving up.
 */
export async function executeActWithRetry(
  instruction: string,
  stagehand: Stagehand,
  page: Page
): Promise<ActResult> {
  let lastAttempt = 1;
  let lastFailedResult: ActResult | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    lastAttempt = attempt;
    try {
      const result = await executeActStep(instruction, stagehand);
      if (result.success) return result;

      lastFailedResult = result;

      if (result.error && isRetryableError(result.error) && attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY);
        continue;
      }

      // Enhance schema/object errors with page context
      if (result.error && /schema|No object generated/i.test(result.error)) {
        lastFailedResult = { ...result, error: await getEnhancedErrorContext(page, instruction, attempt) };
      }
      break;
    } catch (error) {
      const rawError = error instanceof Error ? error : new Error(String(error));
      if (isRetryableError(rawError.message) && attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY);
        continue;
      }
      let errorMsg: string;
      try { errorMsg = await getEnhancedErrorContext(page, instruction, attempt); }
      catch { errorMsg = rawError.message; }
      lastFailedResult = { success: false, duration: 0, error: errorMsg };
      break;
    }
  }

  // All retries exhausted — try dismissing a modal/overlay and retry once
  const modalRetry = await tryDismissModalAndRetry(instruction, stagehand, page);
  if (modalRetry) return modalRetry;

  // Try select/dropdown DOM fallback as last resort
  const selectFallback = await trySelectFallback(page, instruction);
  if (selectFallback) return selectFallback;

  return lastFailedResult ?? {
    success: false,
    duration: 0,
    error: await getEnhancedErrorContext(page, instruction, lastAttempt),
  };
}

// ============================================================================
// POST-ACTION STABILIZATION
// ============================================================================

/**
 * After a save/submit/publish action, wait for the SPA to process the state change.
 * Simple networkidle + delay is sufficient — the Check step that follows will
 * verify the expected outcome with the full dual-oracle (b-test + extract).
 */
export async function waitForFormDismissal(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 3000 });
  } catch { /* ignore — SPA may not trigger network activity */ }
  await delay(500);
}

/**
 * Wait for a modal/dialog to appear after a trigger action (edit, delete, etc.).
 * DOM-first polling (4x500ms = 2s) with LLM fallback for non-standard modals.
 * Non-fatal on timeout — not all trigger actions produce modals.
 */
export async function waitForModalAppearance(tester: Tester, page: Page): Promise<void> {
  // Fast DOM poll: 4 attempts × 500ms = 2s max
  for (let i = 0; i < 4; i++) {
    const modal = await detectModalInDOM(page);
    if (modal) {
      console.log(`[waitForModalAppearance] Modal detected via DOM: ${modal.selector}`);
      return;
    }
    await delay(500);
  }
  // LLM fallback for custom/non-standard modals
  try {
    await tester.waitFor(
      "A modal, dialog, confirmation popup, or overlay has appeared on the page.",
      1500
    );
    console.log(`[waitForModalAppearance] Modal detected via LLM`);
  } catch {
    // No modal appeared — action may have completed directly (no confirmation needed)
  }
}

/**
 * Wait for a modal/dialog to close after a dismiss action (confirm, cancel, etc.).
 * DOM-first polling (4x300ms = 1.2s) with LLM fallback.
 * Non-fatal on timeout. Resets snapshots after dismissal for clean check baseline.
 */
export async function waitForModalDismissal(tester: Tester, page: Page): Promise<void> {
  // Fast DOM poll: check if modal is gone
  for (let i = 0; i < 4; i++) {
    const modal = await detectModalInDOM(page);
    if (!modal) {
      console.log(`[waitForModalDismissal] Modal dismissed (confirmed via DOM)`);
      tester.clearSnapshots();
      await tester.snapshot(page);
      return;
    }
    await delay(300);
  }
  // LLM fallback for non-standard modals
  try {
    await tester.waitFor(
      "The modal, dialog, or popup that was previously visible has been closed.",
      1500
    );
    console.log(`[waitForModalDismissal] Modal dismissed (confirmed via LLM)`);
  } catch {
    // Modal didn't close — possible silent failure
  }
  // Reset snapshots for clean check step baseline
  tester.clearSnapshots();
  await tester.snapshot(page);
}
