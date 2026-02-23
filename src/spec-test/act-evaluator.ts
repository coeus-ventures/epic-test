// ============================================================================
// ACT EVALUATOR — post-act three-way judgment (issue 012)
// ============================================================================
//
// Determines whether an adaptive act loop iteration achieved its goal:
//   complete   — goal achieved, move to next step
//   incomplete — intermediate state (modal, form still open), loop again
//   failed     — act had no meaningful effect, surface error

import { z } from "zod";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { Tester } from "../b-test";
import type { ActContext, ActEvalResult } from "./types";

const EVAL_SCHEMA = z.object({
  status: z.enum(["complete", "incomplete", "failed"]).describe(
    "complete = goal fully achieved; incomplete = intermediate state reached, more actions needed; failed = act had no meaningful effect"
  ),
  reason: z.string().describe("Brief human-readable explanation of the judgment"),
  nextContext: z.string().optional().describe(
    "For incomplete only: what the next observe query should focus on (e.g. 'A modal with Confirm/Cancel buttons is visible')"
  ),
});

function buildEvalPrompt(actContext: ActContext, diffSummary: string): string {
  const { goal, lastAct, history } = actContext;
  const historyText = history.length > 0
    ? `Previous attempts: ${JSON.stringify(history)}`
    : "No previous attempts.";

  return `Goal: "${goal}"
Last action taken: "${lastAct ?? "none yet"}"
Page changes detected: "${diffSummary}"
${historyText}

Determine whether the goal has been achieved:
- "complete": goal fully achieved — no further action needed.
- "incomplete": an intermediate state was reached (modal appeared, form is open,
  redirected to a page where more actions are needed). Describe what to do next in nextContext.
- "failed": the action had no meaningful effect. The goal was not progressed.

IMPORTANT: "complete" can occur even when the UI flow differs from what the goal implied.
Focus on whether the GOAL was achieved, not whether a specific UI sequence occurred.
If the item is gone from the page, the deletion is complete — regardless of whether a
confirmation dialog appeared.`;
}

/**
 * Evaluate whether an act step achieved its goal.
 *
 * Uses b-test diff (what changed on the page) combined with LLM judgment
 * to produce a three-way result: complete / incomplete / failed.
 *
 * Called after each act() in the adaptive loop (issue 013).
 */
export async function evaluateActResult(
  tester: Tester,
  stagehand: Stagehand,
  actContext: ActContext,
): Promise<ActEvalResult> {
  let diffSummary = "No changes detected";
  try {
    const diffResult = await tester.diff();
    diffSummary = diffResult.summary;
  } catch {
    // No snapshots available yet — use default summary
  }

  const prompt = buildEvalPrompt(actContext, diffSummary);
  const result = await stagehand.extract(prompt, EVAL_SCHEMA);

  return {
    status: result.status,
    reason: result.reason,
    ...(result.nextContext && { nextContext: result.nextContext }),
  };
}
