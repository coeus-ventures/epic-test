// ============================================================================
// CHECK HELPERS — retry orchestration, deterministic fast-path, extract double-check
// ============================================================================

import { z } from "zod";
import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { Tester } from "../b-test";
import type { CheckResult, SpecStep, StepResult } from "./types";

import {
  executeCheckStep,
  extractExpectedText,
  getCheckErrorContext,
  MAX_RETRIES,
  RETRY_DELAY,
} from "./step-execution";
import { delay, isRetryableError } from "./act-helpers";

/** Enhanced instruction template for stagehand.extract() double-check. */
export const EXTRACT_EVALUATION_PROMPT = `Look at ALL visible elements on the page (buttons, links, text, navigation items, headings, forms, badges, icons, labels, timestamps). Evaluate whether this condition is satisfied: "{instruction}".

IMPORTANT evaluation rules:
- If the condition uses "or", it passes if ANY part is true
- "navigate the application" means ANY button/link that takes you to different sections (e.g., "Jobs", "Candidates", "Dashboard", "Settings", "Home" are navigation)
- "button to create X" includes buttons like "Create X", "Add X", "New X", or a "+" button
- For visual state indicators (edited, pinned, starred, archived, resolved, etc.), look for ANY visual cue: small text labels like "(edited)", icons (pin, star, check), CSS classes, badges, status tags, tooltips, or color changes
- Be generous in interpretation - if the page has relevant interactive elements or visual cues, the condition is likely satisfied`;

/**
 * Double-check a semantic failure using stagehand.extract().
 * Returns true if the condition is actually satisfied (b-test false negative).
 */
export async function doubleCheckWithExtract(
  instruction: string,
  stagehand: Stagehand
): Promise<boolean> {
  try {
    const schema = z.object({
      passed: z.boolean().describe(
        "true if the condition is satisfied by ANY element currently visible on the page, false only if NO element matches"
      ),
    });
    const enhancedInstruction = EXTRACT_EVALUATION_PROMPT.replace('{instruction}', instruction);
    const result = await stagehand.extract(enhancedInstruction, schema);
    console.log(`extract() double-check for "${instruction.slice(0, 80)}...": ${result.passed}`);
    return result.passed;
  } catch (error) {
    console.log(`extract() double-check threw: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Try deterministic text verification as a fast path for check steps.
 * Returns a StepResult if the check passes deterministically, or null to fall through to semantic.
 */
export async function tryDeterministicCheck(
  page: Page, step: SpecStep, stepStart: number
): Promise<StepResult | null> {
  const textCheck = extractExpectedText(step.instruction);
  if (!textCheck) return null;

  try {
    const exists = await page.evaluate((text: string) => {
      return document.body.innerText.includes(text);
    }, textCheck.text).catch(() => false);
    const passed = textCheck.shouldExist ? exists : !exists;
    if (passed) {
      return {
        step,
        success: true,
        duration: Date.now() - stepStart,
        checkResult: {
          passed: true,
          checkType: "deterministic",
          expected: step.instruction,
          actual: exists ? `Found "${textCheck.text}" on page` : `Text "${textCheck.text}" not on page (expected absent)`,
        },
      };
    }
    console.log(`[runStep] Deterministic text check failed for "${textCheck.text}" — falling through to semantic oracle`);
  } catch { /* fall through to semantic check */ }

  return null;
}

/**
 * Execute a Check step with retry logic.
 *
 * Oracle strategy depends on page transition:
 * - Same page: b-test (diff) primary → extract() rescue on failure
 * - Page transition: extract() primary → b-test rescue on failure
 *
 * b-test diffs are unreliable after full page transitions because the entire
 * DOM changes. extract() evaluates current page state directly.
 */
export async function executeCheckWithRetry(
  instruction: string,
  checkType: "deterministic" | "semantic",
  page: Page,
  tester: Tester,
  stagehand: Stagehand,
  pageTransitioned: boolean = false
): Promise<CheckResult> {
  let lastAttempt = 1;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    lastAttempt = attempt;
    try {
      if (checkType === "semantic" && pageTransitioned) {
        // Page transition: extract() primary → b-test rescue
        console.log(`Page transitioned (attempt ${attempt}/${MAX_RETRIES}) — extract() primary for: "${instruction.slice(0, 80)}..."`);
        if (await doubleCheckWithExtract(instruction, stagehand)) {
          return { passed: true, checkType: "semantic", expected: instruction, actual: "Confirmed by extract() (page transition)" };
        }
        const bTestResult = await executeCheckStep(instruction, checkType, page, tester);
        if (bTestResult.passed) {
          return { passed: true, checkType: "semantic", expected: instruction, actual: "Confirmed by b-test (extract false negative mitigated)" };
        }
        if (attempt < MAX_RETRIES) { await delay(RETRY_DELAY); continue; }
        return { ...bTestResult, actual: await getCheckErrorContext(page, instruction, attempt) };
      }

      // Same page: b-test primary → extract() rescue
      const result = await executeCheckStep(instruction, checkType, page, tester);
      if (result.passed) return result;

      if (checkType === "semantic") {
        if (await doubleCheckWithExtract(instruction, stagehand)) {
          return { passed: true, checkType: "semantic", expected: instruction, actual: "Confirmed by extract() (b-test false negative mitigated)" };
        }
      }

      if (checkType === "semantic" && attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY);
        continue;
      }

      if (checkType === "semantic") {
        return { ...result, actual: await getCheckErrorContext(page, instruction, attempt) };
      }
      return result;
    } catch (error) {
      const rawError = error instanceof Error ? error : new Error(String(error));
      if (isRetryableError(rawError.message) && attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY);
        continue;
      }
      return {
        passed: false,
        checkType,
        expected: instruction,
        actual: await getCheckErrorContext(page, instruction, attempt),
      };
    }
  }

  return {
    passed: false,
    checkType,
    expected: instruction,
    actual: await getCheckErrorContext(page, instruction, lastAttempt),
  };
}
