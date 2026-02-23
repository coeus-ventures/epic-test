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
- Only pass if you can identify the SPECIFIC element or text that satisfies the condition. Do not infer or assume.`;

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
    if (passed) {
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
    }
    console.log(`[runStep] Deterministic text check failed for "${textCheck.text}" — falling through to semantic oracle`);
    return { stepResult: null, failed: true };
  } catch { /* fall through to semantic check */ }

  return { stepResult: null, failed: false };
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
        // Concordance gates — active when deterministic check already signalled failure
        if (deterministicFailed) {
          // Check if b-test also detected no page changes
          let noChangesDetected = false;
          try {
            const diffResult = await tester.diff();
            noChangesDetected = diffResult.summary.includes("No changes");
          } catch { /* tester may not have both snapshots yet — treat as unknown */ }

          if (noChangesDetected) {
            // Negative concordance: two oracles (deterministic + b-test) both signal failure.
            // Skip extract() — a single extract() pass cannot override two negative signals.
            console.log(`[executeCheckWithRetry] Negative concordance: b-test "No changes" + deterministic FAIL — skipping extract() rescue`);
          } else {
            // Evidence gate: deterministic failed, but page did change — require extract() to cite specific evidence
            if (await doubleCheckWithExtract(instruction, stagehand, true)) {
              return { passed: true, checkType: "semantic", expected: instruction, actual: "Confirmed by extract() with evidence (b-test false negative mitigated)" };
            }
          }
        } else {
          // No concordance constraint — use generous extract() rescue (original behavior)
          if (await doubleCheckWithExtract(instruction, stagehand)) {
            return { passed: true, checkType: "semantic", expected: instruction, actual: "Confirmed by extract() (b-test false negative mitigated)" };
          }
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
