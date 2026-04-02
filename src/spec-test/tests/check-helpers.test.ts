/**
 * Tests for check-helpers.ts — concordance gates (issue 015).
 *
 * Test-first: these tests define the expected behavior before the concordance
 * logic is added. Run them to see them fail, then implement to make them pass.
 *
 * Run: npx vitest run src/spec-test/tests/check-helpers.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EXTRACT_EVALUATION_PROMPT,
  doubleCheckWithExtract,
  tryDeterministicCheck,
  executeCheckWithRetry,
} from "../check-helpers";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStagehand(extractResult: Record<string, unknown>) {
  return {
    extract: vi.fn().mockResolvedValue(extractResult),
  };
}

/**
 * Make a tester mock with controllable assert() and diff() responses.
 * assert() is used by executeSemanticCheck (via executeCheckStep).
 * diff() is used by executeCheckWithRetry concordance gate.
 */
function makeTester(assertPassed: boolean, diffSummary = "Some content changed") {
  return {
    clearSnapshots: vi.fn(),
    snapshot: vi.fn().mockResolvedValue({ success: true, snapshotId: "snap_1" }),
    assert: vi.fn().mockResolvedValue(assertPassed),
    diff: vi.fn().mockResolvedValue({ summary: diffSummary, changes: [] }),
  };
}

function makePage(bodyText: string = "") {
  return {
    evaluate: vi.fn().mockImplementation(async (_fn: unknown, text: string) => {
      return bodyText.includes(text);
    }),
    accessibility: {
      snapshot: vi.fn().mockResolvedValue({ role: "WebArea", children: [] }),
    },
    url: vi.fn().mockReturnValue("http://localhost:3000/"),
  };
}

// ─── EXTRACT_EVALUATION_PROMPT ───────────────────────────────────────────────

describe("EXTRACT_EVALUATION_PROMPT", () => {
  it("does not contain 'Be generous'", () => {
    expect(EXTRACT_EVALUATION_PROMPT.toLowerCase()).not.toContain("be generous");
  });

  it("contains evidence-based instruction", () => {
    expect(EXTRACT_EVALUATION_PROMPT).toContain("SPECIFIC");
  });
});

// ─── doubleCheckWithExtract ───────────────────────────────────────────────────

describe("doubleCheckWithExtract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when extract passes (requireEvidence=false, default)", async () => {
    const stagehand = makeStagehand({ passed: true });
    const result = await doubleCheckWithExtract("ticket appears", stagehand as any);
    expect(result).toBe(true);
  });

  it("returns false when extract fails", async () => {
    const stagehand = makeStagehand({ passed: false });
    const result = await doubleCheckWithExtract("ticket appears", stagehand as any);
    expect(result).toBe(false);
  });

  it("returns true when extract passes WITH foundText and requireEvidence=true", async () => {
    const stagehand = makeStagehand({ passed: true, foundText: "Ticket A" });
    const result = await doubleCheckWithExtract("ticket appears", stagehand as any, true);
    expect(result).toBe(true);
  });

  it("returns false when extract passes WITHOUT foundText and requireEvidence=true (concordance gate)", async () => {
    const stagehand = makeStagehand({ passed: true });
    const result = await doubleCheckWithExtract("ticket appears", stagehand as any, true);
    expect(result).toBe(false);
  });

  it("returns false when extract fails even with requireEvidence=true", async () => {
    const stagehand = makeStagehand({ passed: false, foundText: "something" });
    const result = await doubleCheckWithExtract("ticket appears", stagehand as any, true);
    expect(result).toBe(false);
  });

  it("returns false on extract() exception", async () => {
    const stagehand = { extract: vi.fn().mockRejectedValue(new Error("Network error")) };
    const result = await doubleCheckWithExtract("ticket appears", stagehand as any);
    expect(result).toBe(false);
  });
});

// ─── tryDeterministicCheck ───────────────────────────────────────────────────

describe("tryDeterministicCheck", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns {stepResult: null, failed: false} when instruction has no extractable text", async () => {
    const page = makePage();
    const step = { type: "Check" as const, instruction: "The list updates correctly" };
    const result = await tryDeterministicCheck(page as any, step, Date.now());
    expect(result.stepResult).toBeNull();
    expect(result.failed).toBe(false);
  });

  it("returns {stepResult: passing, failed: false} when text is found on page", async () => {
    const page = makePage("Ticket A has been created successfully");
    const step = { type: "Check" as const, instruction: '"Ticket A" appears' };
    const result = await tryDeterministicCheck(page as any, step, Date.now());
    expect(result.stepResult?.success).toBe(true);
    expect(result.failed).toBe(false);
  });

  it("returns {stepResult: null, failed: true} when text check fails (text not found)", async () => {
    const page = makePage("Welcome to the app");
    const step = { type: "Check" as const, instruction: '"Ticket A" appears' };
    const result = await tryDeterministicCheck(page as any, step, Date.now());
    expect(result.stepResult).toBeNull();
    expect(result.failed).toBe(true);
  });
});

// ─── executeCheckWithRetry concordance gates ──────────────────────────────────

describe("executeCheckWithRetry concordance gates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts deterministicFailed param without throwing", async () => {
    const stagehand = makeStagehand({ passed: false });
    const page = makePage("");
    const tester = makeTester(true); // b-test passes

    // Should not throw — verifies the function signature accepts the new param
    await expect(
      executeCheckWithRetry(
        "The ticket appears", "semantic", page as any, tester as any, stagehand as any, false, true
      )
    ).resolves.toBeDefined();
  });

  it("skips extract() when b-test 'No changes' AND deterministicFailed=true", async () => {
    const stagehand = makeStagehand({ passed: true, foundText: "Ticket" });
    const page = makePage("");
    const tester = makeTester(false, "No changes detected");

    await executeCheckWithRetry(
      "The ticket appears", "semantic", page as any, tester as any, stagehand as any,
      false, // pageTransitioned
      true   // deterministicFailed
    );

    // Negative concordance gate: extract() must NOT be called
    expect(stagehand.extract).not.toHaveBeenCalled();
  });

  it("calls extract with requireEvidence=true when deterministicFailed=true and b-test has changes", async () => {
    const stagehand = makeStagehand({ passed: true, foundText: "Ticket A" });
    const page = makePage("");
    const tester = makeTester(false, "Some content changed");

    await executeCheckWithRetry(
      "The ticket appears", "semantic", page as any, tester as any, stagehand as any,
      false, // pageTransitioned
      true   // deterministicFailed
    );

    // Extract must be called — and the schema should request foundText
    expect(stagehand.extract).toHaveBeenCalledTimes(1);
  });

  it("does not change behavior when deterministicFailed=false and b-test passes", async () => {
    const stagehand = makeStagehand({ passed: true });
    const page = makePage("");
    const tester = makeTester(true); // b-test passes

    const result = await executeCheckWithRetry(
      "The ticket appears", "semantic", page as any, tester as any, stagehand as any,
      false, // pageTransitioned
      false  // deterministicFailed
    );

    expect(result.passed).toBe(true);
    // b-test passed → extract should not be called
    expect(stagehand.extract).not.toHaveBeenCalled();
  });

  it("returns failed when b-test 'No changes' + deterministicFailed + extract would pass", async () => {
    // Two negative signals should override one positive signal from extract
    const stagehand = makeStagehand({ passed: true, foundText: "Ticket" });
    const page = makePage("");
    const tester = makeTester(false, "No changes detected");

    const result = await executeCheckWithRetry(
      "The ticket appears", "semantic", page as any, tester as any, stagehand as any,
      false, // pageTransitioned
      true   // deterministicFailed
    );

    expect(result.passed).toBe(false);
  });
});
