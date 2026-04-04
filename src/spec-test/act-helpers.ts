// ============================================================================
// ACT HELPERS — page action execution, delay, retry utilities
// ============================================================================

import { z } from "zod";
import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { SpecStep, StepResult } from "./types";

/** Delay helper for retry and stabilization logic. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Check if an error is retryable (transient API errors). */
export function isRetryableError(message: string): boolean {
  return /schema|No object generated|rate|timeout|ECONNRESET|ETIMEDOUT/i.test(message);
}

/** Milliseconds to wait between retries. */
const RETRY_DELAY = 1000;

/** Native input types that Stagehand's act() can't reliably interact with due to shadow DOM. */
const NATIVE_WIDGET_TYPES = ["date", "time", "datetime-local"] as const;

/** Keyword hints for matching instruction to a specific input element. */
const POSITION_HINTS: Array<{ keywords: RegExp; biasToward: "first" | "last" }> = [
  { keywords: /start|begin|from|earliest|since/i, biasToward: "first" },
  { keywords: /end|finish|to|until|latest/i, biasToward: "last" },
];

const FILL_VALUE_SCHEMA = z.object({
  value: z.string().describe("The exact value to fill into the input field"),
});

/**
 * Fallback for native browser widget inputs (date, time, datetime-local) that
 * Stagehand's act() cannot reach due to shadow DOM internals.
 *
 * Called after stagehand.act() + evaluateActResult() returns "failed".
 * Finds the most relevant native input on the page, asks the LLM for an
 * appropriate value, and returns an executor that fills it via Playwright.
 *
 * Returns null if no native inputs are found on the page.
 */
export async function tryNativeInputFill(
  page: Page,
  stagehand: Stagehand,
  instruction: string,
): Promise<(() => Promise<void>) | null> {
  const nativeSelector = NATIVE_WIDGET_TYPES.map(t => `input[type="${t}"]`).join(", ");
  const inputs = await page.evaluate((sel) => {
    const els = document.querySelectorAll(sel) as NodeListOf<HTMLInputElement>;
    return Array.from(els).map(el => ({
      id: el.id,
      name: el.name,
      type: el.type,
      value: el.value,
    }));
  }, nativeSelector);

  if (inputs.length === 0) return null;

  // Pick the best matching input: check element id/name against position hints
  let target = inputs[0];
  for (const hint of POSITION_HINTS) {
    if (hint.keywords.test(instruction)) {
      target = hint.biasToward === "last" ? inputs[inputs.length - 1] : inputs[0];
      break;
    }
  }

  // Also try matching id/name directly
  const instructionLower = instruction.toLowerCase();
  const idMatch = inputs.find(el =>
    (el.id && instructionLower.includes(el.id.toLowerCase())) ||
    (el.name && instructionLower.includes(el.name.toLowerCase()))
  );
  if (idMatch) target = idMatch;

  const today = new Date().toISOString().split("T")[0];
  const prompt = `The goal is: "${instruction}".
There is an input[type="${target.type}"] field (id="${target.id || "unknown"}") on the page.
What value should be filled? Use YYYY-MM-DD format for dates.
Today is ${today}. Use a reasonable value (e.g., for a "start date" filter use 30 days ago; for "end date" use today).
Respond with only the value string, nothing else.`;

  const { value } = await (stagehand as any).extract(prompt, FILL_VALUE_SCHEMA);

  const selector = target.id
    ? `#${target.id}`
    : target.name
      ? `input[type="${target.type}"][name="${target.name}"]`
      : `input[type="${target.type}"]`;
  console.log(`[nativeInputFill] Filling "${selector}" with "${value}" for: "${instruction.slice(0, 60)}"`);

  return async () => {
    await page.locator(selector).fill(value);
    await page.locator(selector).dispatchEvent("change");
  };
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

// ============================================================================
// RESILIENCE HELPERS — v4 capabilities adapted for the v5 adaptive act loop
// ============================================================================

/**
 * Wrapper around stagehand.act() that retries on transient API errors
 * (ECONNRESET, schema validation failures, rate limits).
 *
 * Replaces v4's executeActWithRetry retry concern. Page-context enrichment
 * is handled separately by the adaptive loop's observe() on iteration 1+.
 */
export async function actWithRetry(
  stagehand: Stagehand,
  instruction: string,
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await stagehand.act(instruction);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRetryableError(msg) && attempt < maxAttempts - 1) {
        console.log(`[actWithRetry] Retrying (attempt ${attempt + 1}): ${msg.slice(0, 80)}`);
        await delay(RETRY_DELAY);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Pre-flight modal dismissal. Runs once at the START of executeAdaptiveAct
 * to clear any stale overlay left over from a previous step.
 *
 * Checks DOM for visible modal/dialog elements. If found, presses Escape and
 * waits 300ms. The adaptive loop's evaluator handles in-flow modal sequences
 * organically; this only handles stale artifacts.
 *
 * Returns true if a modal was detected and dismissed.
 */
export async function dismissStaleModal(page: Page): Promise<boolean> {
  const modalFound = await page.evaluate(() => {
    const selectors = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      'dialog[open]',
      '[class*="modal" i]',
      '[class*="dialog" i]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (
        rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      ) {
        return true;
      }
    }
    return false;
  });

  if (!modalFound) return false;

  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 300));
  console.log('[dismissStaleModal] Pressed Escape to clear stale modal');
  return true;
}

/**
 * DOM-based click fallback for elements outside Stagehand's accessibility tree
 * (NPS rating scales, custom-styled radio buttons, aria-label-only elements, etc.).
 *
 * Called in the "failed" branch of executeAdaptiveAct after tryNativeInputFill
 * returns null. Extracts the target text/number from the instruction and tries
 * 4 DOM strategies inside a single page.evaluate() call.
 *
 * Only activates for click/select/rate-type instructions. Returns true if
 * any strategy successfully interacted with an element.
 */
export async function tryDOMClick(page: Page, instruction: string): Promise<boolean> {
  if (!/\b(click|press|tap|select|choose|pick|rate|score)\b/i.test(instruction)) return false;

  const quotedMatch = instruction.match(/["']([^"']+)["']/);
  const numberMatch = instruction.match(/\b(\d{1,2})\b/);
  const target = quotedMatch?.[1] ?? numberMatch?.[1] ?? null;
  if (!target) return false;

  const clicked = await page.evaluate((tgt) => {
    // Strategy 1: exact text content match (leaf nodes first, then wrappers)
    const clickables = Array.from(document.querySelectorAll(
      'button, [role="button"], label, span, div, a, li, td',
    )) as HTMLElement[];
    const leaves = clickables.filter(el => el.children.length === 0 && el.textContent?.trim() === tgt);
    if (leaves.length > 0) { leaves[0].click(); return true; }
    const wrappers = clickables.filter(el => el.textContent?.trim() === tgt);
    if (wrappers.length > 0) { wrappers[0].click(); return true; }

    // Strategy 2: radio/checkbox by input value or label text
    const radios = Array.from(document.querySelectorAll(
      'input[type="radio"], input[type="checkbox"]',
    )) as HTMLInputElement[];
    const radio = radios.find(r =>
      r.value === tgt || r.labels?.[0]?.textContent?.trim() === tgt,
    );
    if (radio) { radio.click(); return true; }

    // Strategy 3: number/range input via native value setter
    const numVal = Number(tgt);
    if (!isNaN(numVal)) {
      const ranges = Array.from(document.querySelectorAll(
        'input[type="number"], input[type="range"]',
      )) as HTMLInputElement[];
      const range = ranges.find(r =>
        numVal >= Number(r.min || 0) && numVal <= Number(r.max || 100),
      );
      if (range) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(range, String(numVal));
        range.dispatchEvent(new Event('input', { bubbles: true }));
        range.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }

    // Strategy 4: aria-label or data-value attribute
    const ariaEl = document.querySelector(
      `[aria-label="${tgt}"], [data-value="${tgt}"]`,
    ) as HTMLElement | null;
    if (ariaEl) { ariaEl.click(); return true; }

    return false;
  }, target);

  if (clicked) {
    console.log(`[tryDOMClick] DOM interaction succeeded for target "${target}" in: "${instruction.slice(0, 60)}"`);
    await delay(500);
  }
  return clicked;
}

/**
 * Fills empty required form fields with sensible default values.
 *
 * Adapted from v4's fillEmptyRequiredFields. Called in the "failed" branch
 * of executeAdaptiveAct when the instruction is a submit/save action —
 * HTML5 required-field validation silently blocks submission (no DOM change),
 * so the evaluator returns "failed" and this auto-fills to unblock it.
 *
 * Uses React-compatible native value setters (same technique as clearFormFields
 * in session-management.ts) to trigger synthetic events.
 *
 * Returns the number of fields filled.
 */
export async function tryFillRequiredInputs(page: Page): Promise<number> {
  const filled = await page.evaluate((): number => {
    const selector = [
      'input[required]:not([type="hidden"]):not([type="submit"])',
      ':not([type="button"]):not([type="checkbox"]):not([type="radio"])',
      ', textarea[required]',
      ', select[required]',
    ].join('');

    const fields = Array.from(
      document.querySelectorAll(selector),
    ) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];

    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value',
    )?.set;

    let count = 0;

    for (const el of fields) {
      // Skip already-filled or invisible fields
      if ((el as HTMLInputElement).value?.trim()) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (
        rect.width === 0 ||
        style.display === 'none' ||
        style.visibility === 'hidden'
      ) continue;

      const tag = el.tagName.toLowerCase();
      const type = ((el as HTMLInputElement).type ?? '').toLowerCase();
      const hint = [
        ...(Array.from((el as HTMLInputElement).labels ?? []).map(l => l.textContent ?? '')),
        el.name,
        el.id,
        (el as HTMLInputElement).placeholder ?? '',
      ].join(' ').toLowerCase();

      // Select elements
      if (tag === 'select') {
        const firstOption = Array.from((el as HTMLSelectElement).options).find(o => o.value);
        if (firstOption) {
          (el as HTMLSelectElement).value = firstOption.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          count++;
        }
        continue;
      }

      // Determine fill value
      let value = 'Test input';
      if (type === 'email' || hint.includes('email')) {
        value = `test-${Date.now()}@example.com`;
      } else if (type === 'password' || hint.includes('password')) {
        value = 'TestPass123!';
      } else if (type === 'tel' || hint.includes('phone') || hint.includes('tel')) {
        value = '+1234567890';
      } else if (type === 'url' || hint.includes('url') || hint.includes('website')) {
        value = 'https://example.com';
      } else if (type === 'number') {
        value = '42';
      } else if (tag === 'textarea') {
        value = 'Test description content';
      } else if ((el as HTMLInputElement).placeholder) {
        value = (el as HTMLInputElement).placeholder;
      }

      nativeSetter?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      count++;
    }

    return count;
  });

  if (filled > 0) {
    console.log(`[tryFillRequiredInputs] Auto-filled ${filled} empty required field(s)`);
  }
  return filled;
}

/**
 * Returns true if the instruction is a submit/save-type action.
 * Used to gate tryFillRequiredInputs — only auto-fill before submit actions.
 */
export function isSubmitAction(instruction: string): boolean {
  return /Click\s+the\s+["']?(Submit|Save|Create|Add|Done|Finish|Complete|Confirm)["']?\s+button/i.test(instruction)
    || /\b(submit|save)\b/i.test(instruction);
}
