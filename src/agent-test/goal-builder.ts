// ============================================================================
// GOAL BUILDER — converts spec steps into agent goal prompts
// ============================================================================

import type { SpecStep } from "../spec-test";

/**
 * Build a goal prompt for the Stagehand agent from a list of spec steps.
 *
 * Act steps become a numbered action list framed as adaptive hints.
 * Check steps become success criteria for post-execution verification.
 * The agent adapts to whatever UI it encounters rather than requiring
 * exact element matches.
 */
export function buildGoalPrompt(steps: SpecStep[]): {
  goal: string;
  successCriteria: string[];
} {
  const actSteps = steps.filter((s) => s.type === "act");
  const checkSteps = steps.filter((s) => s.type === "check");

  const successCriteria = checkSteps.map((s) => s.instruction);

  if (actSteps.length === 0) {
    return {
      goal: "Observe the current page state.",
      successCriteria,
    };
  }

  const actionList = actSteps
    .map((s, i) => `${i + 1}. ${s.instruction}`)
    .join("\n");

  const parts: string[] = [
    "Complete the following task on this web application.",
    "",
    "Actions to perform (adapt these to the actual UI you see — buttons, fields, and labels may differ from what's described):",
    actionList,
    "",
    ADAPTIVE_INSTRUCTION,
  ];

  if (successCriteria.length > 0) {
    const criteriaList = successCriteria.map((c) => `- ${c}`).join("\n");
    parts.push(
      "",
      "Success criteria (these must be true when you're done):",
      criteriaList
    );
  }

  return {
    goal: parts.join("\n"),
    successCriteria,
  };
}

const ADAPTIVE_INSTRUCTION = `If a button has a different label than described (e.g., "New" instead of "Create", "+" instead of "Add"), click the closest match. If a form field is labeled differently, find the one that best matches the intent. The quoted values are exact — type them as-is.`;
