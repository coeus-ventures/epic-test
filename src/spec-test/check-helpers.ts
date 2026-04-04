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
- Only pass if you can identify the SPECIFIC element or text that satisfies the condition. Do not infer or assume.`;

/**
 * Execute a Check step with retry logic.
 *
 * Oracle strategy depends on page transition:
 * - Same page: b-test (diff) primary → extract() rescue on failure
 * - Page transition: extract() primary → b-test rescue on failure
 *
 * Concordance gates (activated when deterministicFailed=true):
 * - Negative concordance: b-test "No changes" + deterministic failed → skip extract()
 * - Evidence gate: deterministic failed → extract() must return foundText to pass
 */
export async function executeCheckWithRetry(
  instruction: string,
  checkType: "deterministic" | "semantic",
  page: Page,
  tester: Tester,
  stagehand: Stagehand,
  pageTransitioned: boolean = false,
  deterministicFailed: boolean = false
): Promise<CheckResult> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = pageTransitioned
        ? await runPageTransitionOracle(instruction, stagehand, page, tester, checkType, attempt)
        : await runSamePageOracle(instruction, checkType, page, tester, stagehand, deterministicFailed);

      if (result.passed) return result;
      if (canRetry(checkType, attempt)) { await delay(RETRY_DELAY); continue; }

      return checkType === "semantic"
        ? { ...result, actual: await getCheckErrorContext(page, instruction, attempt) }
        : result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isRetryableError(msg) && attempt < MAX_RETRIES) { await delay(RETRY_DELAY); continue; }
      return { passed: false, checkType, expected: instruction, actual: await getCheckErrorContext(page, instruction, attempt) };
    }
  }

  return { passed: false, checkType, expected: instruction, actual: await getCheckErrorContext(page, instruction, MAX_RETRIES) };
}

async function runPageTransitionOracle(
  instruction: string, stagehand: Stagehand, page: Page, tester: Tester,
  checkType: "deterministic" | "semantic", attempt: number,
): Promise<CheckResult> {
  console.log(`Page transitioned (attempt ${attempt}/${MAX_RETRIES}) — extract() primary for: "${instruction.slice(0, 80)}..."`);

  if (await doubleCheckWithExtract(instruction, stagehand)) {
    return { passed: true, checkType: "semantic", expected: instruction, actual: "Confirmed by extract() (page transition)" };
  }

  const bTestResult = await executeCheckStep(instruction, checkType, page, tester);
  if (bTestResult.passed) {
    return { passed: true, checkType: "semantic", expected: instruction, actual: "Confirmed by b-test (extract false negative mitigated)" };
  }
  return bTestResult;
}

async function runSamePageOracle(
  instruction: string, checkType: "deterministic" | "semantic",
  page: Page, tester: Tester, stagehand: Stagehand, deterministicFailed: boolean,
): Promise<CheckResult> {
  const result = await executeCheckStep(instruction, checkType, page, tester);
  if (result.passed) return result;
  if (checkType !== "semantic") return result;

  const rescued = await applyConcordanceGate(instruction, stagehand, tester, deterministicFailed);
  if (rescued) return { passed: true, checkType: "semantic", expected: instruction, actual: rescued };

  return result;
}

async function applyConcordanceGate(
  instruction: string, stagehand: Stagehand, tester: Tester, deterministicFailed: boolean,
): Promise<string | null> {
  if (!deterministicFailed) {
    if (await doubleCheckWithExtract(instruction, stagehand)) return "Confirmed by extract() (b-test false negative mitigated)";
    return null;
  }

  if (await noChangesDetected(tester)) {
    // Two oracles (deterministic + b-test) both signal failure — single extract() cannot override
    console.log(`[executeCheckWithRetry] Negative concordance: b-test "No changes" + deterministic FAIL — skipping extract() rescue`);
    return null;
  }

  // Page did change — require extract() to cite specific evidence
  if (await doubleCheckWithExtract(instruction, stagehand, true)) {
    return "Confirmed by extract() with evidence (b-test false negative mitigated)";
  }
  return null;
}

async function noChangesDetected(tester: Tester): Promise<boolean> {
  try {
    const diffResult = await tester.diff();
    return diffResult.summary.includes("No changes");
  } catch { return false; }
}

function canRetry(checkType: "deterministic" | "semantic", attempt: number): boolean {
  return checkType === "semantic" && attempt < MAX_RETRIES;
}

/**
 * Double-check a semantic failure using stagehand.extract().
 * Returns true if the condition is actually satisfied (b-test false negative).
 *
 * @param requireEvidence - When true, extract() must return foundText to pass.
 *   Used as a concordance gate when the deterministic check already failed:
 *   extract() must cite specific evidence rather than relying on inference alone.
 */
export async function doubleCheckWithExtract(
  instruction: string,
  stagehand: Stagehand,
  requireEvidence = false
): Promise<boolean> {
  try {
    const passedDesc = "true if the condition is satisfied by ANY element currently visible on the page, false only if NO element matches";
    const schema = requireEvidence
      ? z.object({
          passed: z.boolean().describe(passedDesc),
          foundText: z.string().optional().describe(
            "The exact text or element found that satisfies the condition. Required when passing."
          ),
        })
      : z.object({ passed: z.boolean().describe(passedDesc) });

    const enhancedInstruction = EXTRACT_EVALUATION_PROMPT.replace('{instruction}', instruction);
    const result = await stagehand.extract(enhancedInstruction, schema);

    if (requireEvidence && result.passed && !(result as { foundText?: string }).foundText) {
      console.log(`extract() passed without evidence — treating as FAIL (concordance gate): "${instruction.slice(0, 80)}"`);
      return false;
    }

    console.log(`extract() double-check for "${instruction.slice(0, 80)}...": ${result.passed}`);
    return result.passed;
  } catch (error) {
    console.log(`extract() double-check threw: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Try deterministic text verification as a fast path for check steps.
 *
 * Returns:
 * - `{ stepResult: StepResult, failed: false }` when the text check passes (fast path)
 * - `{ stepResult: null, failed: true }` when a text check was found but failed
 * - `{ stepResult: null, failed: false }` when the instruction has no extractable text
 *
 * The `failed` flag lets the caller pass `deterministicFailed` to `executeCheckWithRetry`
 * to activate concordance gates that prevent extract() from overriding two negative signals.
 */
export async function tryDeterministicCheck(
  page: Page, step: SpecStep, stepStart: number
): Promise<{ stepResult: StepResult | null; failed: boolean }> {
  const textCheck = extractExpectedText(step.instruction);
  if (!textCheck) return { stepResult: null, failed: false };

  try {
    const exists = await page.evaluate((text: string) => {
      return document.body.innerText.includes(text);
    }, textCheck.text).catch(() => false);
    const passed = textCheck.shouldExist ? exists : !exists;

    if (!passed) {
      console.log(`[runStep] Deterministic text check failed for "${textCheck.text}" — falling through to semantic oracle`);
      return { stepResult: null, failed: true };
    }

    return {
      stepResult: {
        step,
        success: true,
        duration: Date.now() - stepStart,
        checkResult: {
          passed: true,
          checkType: "deterministic",
          expected: step.instruction,
          actual: exists ? `Found "${textCheck.text}" on page` : `Text "${textCheck.text}" not on page (expected absent)`,
        },
      },
      failed: false,
    };
  } catch { return { stepResult: null, failed: false }; }
}
