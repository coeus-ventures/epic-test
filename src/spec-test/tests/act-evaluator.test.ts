/**
 * Unit tests for act-evaluator (issue 012).
 *
 * Test-first: these tests define the expected API and behavior of
 * evaluateActResult() before the implementation exists.
 * All tests will fail until src/spec-test/act-evaluator.ts is created.
 *
 * Run: npx vitest run src/spec-test/tests/act-evaluator.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// This import will fail until issue 012 is implemented
import { evaluateActResult } from "../act-evaluator";
import type { ActContext } from "../types";

// ─── Minimal mocks ────────────────────────────────────────────────────────────

function makeMockTester(diffSummary = "No changes detected") {
  return {
    diff: vi.fn().mockResolvedValue({ summary: diffSummary, changes: [] }),
  };
}

function makeMockStagehand(response: { status: string; reason: string; nextContext?: string }) {
  return {
    extract: vi.fn().mockResolvedValue(response),
  };
}

function makeCtx(overrides: Partial<ActContext> = {}): ActContext {
  return {
    goal: "Delete the product",
    lastAct: "clicked the delete button",
    iteration: 0,
    history: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("evaluateActResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns complete when diff shows change and LLM confirms goal achieved", async () => {
    const tester = makeMockTester("Product removed from list");
    const stagehand = makeMockStagehand({ status: "complete", reason: "Product is no longer visible" });

    const result = await evaluateActResult(tester as any, stagehand as any, makeCtx());

    expect(result.status).toBe("complete");
    expect(result.reason).toBeTruthy();
  });

  it("returns complete even when UI flow differed from spec (direct delete, no modal)", async () => {
    const tester = makeMockTester("Item removed from list without any dialog");
    const stagehand = makeMockStagehand({
      status: "complete",
      reason: "Product deleted directly — no confirmation dialog was needed",
    });

    const result = await evaluateActResult(tester as any, stagehand as any, makeCtx());

    // This is the 'different pass' case: the UI skipped the expected modal
    // but the goal (deletion) was still achieved — must be complete, not failed
    expect(result.status).toBe("complete");
  });

  it("returns incomplete when a modal appeared after the act", async () => {
    const tester = makeMockTester("Confirmation dialog appeared");
    const stagehand = makeMockStagehand({
      status: "incomplete",
      reason: "A confirmation dialog is now blocking completion",
      nextContext: "A modal with Confirm and Cancel buttons is visible",
    });

    const result = await evaluateActResult(tester as any, stagehand as any, makeCtx());

    expect(result.status).toBe("incomplete");
    expect(result.nextContext).toContain("modal");
  });

  it("returns incomplete when form is still open after submit attempt", async () => {
    const tester = makeMockTester("Form still visible, no redirect");
    const stagehand = makeMockStagehand({
      status: "incomplete",
      reason: "The form is still open — submission may have failed due to validation",
      nextContext: "Form with required fields is still visible",
    });

    const result = await evaluateActResult(
      tester as any,
      stagehand as any,
      makeCtx({ goal: "Click the Submit button", lastAct: "clicked #submit-btn" }),
    );

    expect(result.status).toBe("incomplete");
    expect(result.nextContext).toBeTruthy();
  });

  it("returns failed when act had no meaningful effect", async () => {
    const tester = makeMockTester("No changes detected");
    const stagehand = makeMockStagehand({
      status: "failed",
      reason: "Nothing changed after clicking — button may not have responded",
    });

    const result = await evaluateActResult(tester as any, stagehand as any, makeCtx());

    expect(result.status).toBe("failed");
  });

  it("passes history to the LLM so previous attempts inform the judgment", async () => {
    const tester = makeMockTester("Modal still visible");
    const stagehand = makeMockStagehand({ status: "incomplete", reason: "Still in modal" });

    const ctx = makeCtx({
      iteration: 2,
      history: [
        { act: "clicked delete button", outcome: "modal appeared" },
        { act: "clicked confirm in modal", outcome: "modal still visible" },
      ],
    });

    await evaluateActResult(tester as any, stagehand as any, ctx);

    // The extract call should have received context that includes history
    const callArg = stagehand.extract.mock.calls[0][0];
    const instruction = typeof callArg === "string" ? callArg : callArg?.instruction ?? "";
    expect(instruction).toMatch(/history|previous|attempt/i);
  });

  it("includes the lastAct in the LLM prompt for accurate judgment", async () => {
    const tester = makeMockTester("Changes detected");
    const stagehand = makeMockStagehand({ status: "complete", reason: "Done" });

    const ctx = makeCtx({ lastAct: "clicked #resolve-dropdown-option-resolved" });
    await evaluateActResult(tester as any, stagehand as any, ctx);

    const callArg = stagehand.extract.mock.calls[0][0];
    const instruction = typeof callArg === "string" ? callArg : callArg?.instruction ?? "";
    expect(instruction).toContain("resolve-dropdown-option-resolved");
  });

  it("includes the diff summary in the LLM prompt", async () => {
    const tester = makeMockTester("Agent Smith now appears in assignee field");
    const stagehand = makeMockStagehand({ status: "complete", reason: "Done" });

    await evaluateActResult(tester as any, stagehand as any, makeCtx());

    const callArg = stagehand.extract.mock.calls[0][0];
    const instruction = typeof callArg === "string" ? callArg : callArg?.instruction ?? "";
    expect(instruction).toContain("Agent Smith now appears in assignee field");
  });
});
