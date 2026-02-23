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
  const inputs = await page.$$eval(
    nativeSelector,
    (els) => (els as HTMLInputElement[]).map(el => ({
      id: el.id,
      name: el.name,
      type: el.type,
      value: el.value,
    })),
  );

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
