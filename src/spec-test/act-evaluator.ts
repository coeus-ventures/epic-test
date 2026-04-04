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

IMPORTANT: Your job is ONLY to verify that the specified UI action was performed.
Whether the business outcome is correct (login succeeded, ticket was saved, etc.)
is verified by separate check steps — NOT here.

- "complete": the specified action was performed. Use this when ANY of the following:
    • A button/link was clicked and ANY change occurred (navigation, form opened, error shown,
      panel appeared, element disappeared) — the click worked, outcome is irrelevant here
    • A form field now contains the typed value
    • A dropdown/select interaction was performed — IMPORTANT: <select> value changes do NOT
      appear in the HTML diff. If the goal was to pick/select/choose an option and the
      dropdown/select element is present on the page, return "complete". The next Check step
      will verify whether the correct value was actually selected.
    • The diff shows any DOM change consistent with the action
- "incomplete": you could NOT perform the action because a BLOCKING intermediate UI state
    appeared that prevents the target from being reached (e.g. a required confirmation dialog
    appeared BEFORE the action could complete and needs to be resolved first).
    NOTE: a form or panel appearing AFTER a button click is NOT a blocker — that means the
    click succeeded ("complete"). Only use "incomplete" if the target was genuinely unreachable.
- "failed": the action had ZERO effect — page looks identical to before, element completely
    unchanged. ONLY use this when you are CERTAIN nothing happened at all.

IMPORTANT DEFAULT: When uncertain between "complete" and "failed", ALWAYS choose "complete".
The next Check step is responsible for verifying outcomes — do not second-guess it here.`;
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

  // Fast path: if the page changed at all, the action succeeded.
  // Do NOT call stagehand.extract() here — it reads the post-action page,
  // which is misleading after navigation (the LLM sees the NEW page and
  // can't find evidence of the action that happened on the OLD page).
  const noChange = /no changes/i.test(diffSummary);
  if (!noChange) {
    return { status: "complete", reason: `Action performed — page changed: ${diffSummary}` };
  }

  // Only when diff confirms zero change: ask the LLM whether the action had
  // a subtle effect or truly failed. The page is still in the same state so
  // stagehand.extract() can safely observe it.
  const prompt = buildEvalPrompt(actContext, diffSummary);
  const result = await stagehand.extract(prompt, EVAL_SCHEMA);

  return {
    status: result.status,
    reason: result.reason,
    ...(result.nextContext && { nextContext: result.nextContext }),
  };
}
