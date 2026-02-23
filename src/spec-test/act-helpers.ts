// ============================================================================
// ACT HELPERS — page action execution, delay, retry utilities
// ============================================================================

import type { Page } from "playwright";
import type { SpecStep, StepResult } from "./types";

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
