// ============================================================================
// VERIFIER — post-agent outcome verification using stagehand.extract()
// ============================================================================

import { z } from "zod";
import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { CheckVerification } from "./types";
import {
  EXTRACT_EVALUATION_PROMPT,
  extractExpectedText,
} from "../spec-test";

const verificationSchema = z.object({
  passed: z
    .boolean()
    .describe(
      "true if the condition is satisfied by ANY element currently visible on the page, false only if NO element matches"
    ),
  actual: z
    .string()
    .describe("Brief description of what was actually found on the page"),
  reasoning: z
    .string()
    .describe("Brief explanation of why the condition passed or failed"),
});

/**
 * Try a fast deterministic text check before falling back to LLM verification.
 * Supports both presence ("X" is visible) and absence ("X" is no longer visible) checks.
 * Delegates pattern matching to spec-test's extractExpectedText().
 */
async function tryDeterministicCheck(
  instruction: string,
  page: Page
): Promise<{ matched: boolean; actual: string } | null> {
  const textCheck = extractExpectedText(instruction);
  if (!textCheck) return null;

  try {
    const exists = await page.evaluate(
      (text: string) => document.body.innerText.includes(text),
      textCheck.text
    );
    const passed = textCheck.shouldExist ? exists : !exists;
    if (passed) {
      return {
        matched: true,
        actual: exists
          ? `Found "${textCheck.text}" on page`
          : `Text "${textCheck.text}" not on page (expected absent)`,
      };
    }
  } catch {
    // Fall through to LLM verification
  }
  return null;
}

/**
 * Verify a single criterion against the current page state.
 * Tries deterministic text match first, then falls back to LLM extract().
 */
async function verifySingleCriterion(
  instruction: string,
  stagehand: Stagehand,
  page: Page
): Promise<CheckVerification> {
  const deterministicResult = await tryDeterministicCheck(instruction, page);
  if (deterministicResult?.matched) {
    console.log(
      `[verifier] PASS (deterministic): "${instruction.slice(0, 80)}..."`
    );
    return { instruction, passed: true, actual: deterministicResult.actual };
  }

  try {
    const prompt = EXTRACT_EVALUATION_PROMPT.replace(
      "{instruction}",
      instruction
    );
    const result = await stagehand.extract(prompt, verificationSchema);

    console.log(
      `[verifier] ${result.passed ? "PASS" : "FAIL"} (semantic): "${instruction.slice(0, 80)}..." — ${result.actual}`
    );
    return {
      instruction,
      passed: result.passed,
      actual: result.actual,
      reasoning: result.reasoning,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.log(
      `[verifier] ERROR: "${instruction.slice(0, 80)}..." — ${errorMessage}`
    );
    return {
      instruction,
      passed: false,
      actual: `Verification error: ${errorMessage}`,
    };
  }
}

/**
 * Verify outcomes after agent execution by checking each success criterion
 * against the current page state.
 *
 * For each criterion:
 * 1. Try deterministic text match first (fast path, no LLM cost)
 * 2. Fall back to stagehand.extract() with LLM evaluation
 *
 * Criteria are verified sequentially (shared page state between checks).
 */
export async function verifyOutcome(
  successCriteria: string[],
  stagehand: Stagehand,
  page: Page
): Promise<{ allPassed: boolean; results: CheckVerification[] }> {
  const results: CheckVerification[] = [];

  for (const instruction of successCriteria) {
    results.push(await verifySingleCriterion(instruction, stagehand, page));
  }

  return {
    allPassed: results.every((r) => r.passed),
    results,
  };
}