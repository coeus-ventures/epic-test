import { describe, it, expect } from "vitest";
import { buildGoalPrompt } from "../goal-builder";
import type { SpecStep } from "../../spec-test";

describe("buildGoalPrompt", () => {
  it("should build a goal with numbered actions and success criteria", () => {
    const steps: SpecStep[] = [
      { type: "act", instruction: 'Click the "Create Survey" button' },
      {
        type: "act",
        instruction:
          'Type "Customer Satisfaction Q1 2024" into the survey title input field',
      },
      { type: "act", instruction: 'Click the "Save" button' },
      {
        type: "check",
        instruction:
          'The text "Customer Satisfaction Q1 2024" is visible on the page',
      },
    ];

    const { goal, successCriteria } = buildGoalPrompt(steps);

    // Actions appear as numbered list
    expect(goal).toContain('1. Click the "Create Survey" button');
    expect(goal).toContain(
      '2. Type "Customer Satisfaction Q1 2024" into the survey title input field'
    );
    expect(goal).toContain('3. Click the "Save" button');

    // Success criteria extracted
    expect(successCriteria).toEqual([
      'The text "Customer Satisfaction Q1 2024" is visible on the page',
    ]);

    // Success criteria appear in goal
    expect(goal).toContain(
      'The text "Customer Satisfaction Q1 2024" is visible on the page'
    );

    // Contains adaptive instruction
    expect(goal).toContain("adapt these to the actual UI");
  });

  it("should handle steps with only act steps (no checks)", () => {
    const steps: SpecStep[] = [
      {
        type: "act",
        instruction: "Navigate to http://localhost:3000/sign-up",
      },
      { type: "act", instruction: 'Type "test@example.com" into the email field' },
      { type: "act", instruction: 'Click the "Sign Up" button' },
    ];

    const { goal, successCriteria } = buildGoalPrompt(steps);

    expect(goal).toContain("1. Navigate to http://localhost:3000/sign-up");
    expect(goal).toContain('2. Type "test@example.com" into the email field');
    expect(goal).toContain('3. Click the "Sign Up" button');
    expect(successCriteria).toEqual([]);
    expect(goal).not.toContain("Success criteria");
  });

  it("should handle steps with only check steps (no actions)", () => {
    const steps: SpecStep[] = [
      {
        type: "check",
        instruction: "The dashboard is visible",
        checkType: "semantic",
      },
    ];

    const { goal, successCriteria } = buildGoalPrompt(steps);

    expect(goal).toContain("Observe the current page state");
    expect(successCriteria).toEqual(["The dashboard is visible"]);
  });

  it("should handle empty steps", () => {
    const { goal, successCriteria } = buildGoalPrompt([]);

    expect(goal).toContain("Observe the current page state");
    expect(successCriteria).toEqual([]);
  });

  it("should preserve credential-processed steps verbatim", () => {
    const steps: SpecStep[] = [
      {
        type: "act",
        instruction:
          'Type "newadmin_1@feedback.com" into the email input field',
      },
      {
        type: "act",
        instruction: 'Type "password123" into the password input field',
      },
      { type: "act", instruction: 'Click the "Sign Up" button' },
      {
        type: "check",
        instruction:
          "The page displays a button to create a survey or navigate the application",
      },
    ];

    const { goal, successCriteria } = buildGoalPrompt(steps);

    // Credentials preserved exactly
    expect(goal).toContain("newadmin_1@feedback.com");
    expect(goal).toContain("password123");

    expect(successCriteria).toEqual([
      "The page displays a button to create a survey or navigate the application",
    ]);
  });

  it("should include multiple check steps as separate criteria", () => {
    const steps: SpecStep[] = [
      { type: "act", instruction: 'Click the "Analytics" tab' },
      {
        type: "check",
        instruction: "The NPS score is displayed",
        checkType: "semantic",
      },
      {
        type: "check",
        instruction: "A chart showing response trends is visible",
        checkType: "semantic",
      },
    ];

    const { goal, successCriteria } = buildGoalPrompt(steps);

    expect(successCriteria).toHaveLength(2);
    expect(goal).toContain("- The NPS score is displayed");
    expect(goal).toContain(
      "- A chart showing response trends is visible"
    );
  });

  it("should handle interleaved act and check steps", () => {
    const steps: SpecStep[] = [
      { type: "act", instruction: 'Click "Create"' },
      { type: "check", instruction: "A form appears" },
      { type: "act", instruction: 'Type "Test" into title' },
      { type: "check", instruction: '"Test" is visible' },
    ];

    const { goal, successCriteria } = buildGoalPrompt(steps);

    // All act steps numbered sequentially
    expect(goal).toContain('1. Click "Create"');
    expect(goal).toContain('2. Type "Test" into title');

    // All check steps collected as criteria
    expect(successCriteria).toEqual(["A form appears", '"Test" is visible']);
  });
});
