/**
 * Unit tests for the adaptive act loop (issue 013).
 *
 * Test-first: these tests define the expected loop behavior before
 * executeAdaptiveAct() is implemented in runner.ts.
 * Tests will fail until issue 013 is complete.
 *
 * Run: npx vitest run src/spec-test/tests/adaptive-act-loop.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SpecTestRunner } from "../index";
import * as actEvaluator from "../act-evaluator";

vi.mock("../act-evaluator");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRunner() {
  const runner = new SpecTestRunner({ baseUrl: "http://localhost:3000" });

  // Bypass initialize() — inject mocks directly
  const mockStagehand = {
    observe: vi.fn().mockResolvedValue([
      { description: "Delete button", selector: "#delete-btn" },
    ]),
    act: vi.fn().mockResolvedValue(undefined),
  };
  const mockTester = {
    clearSnapshots: vi.fn(),
    snapshot: vi.fn(),
    diff: vi.fn().mockResolvedValue({ summary: "Changes detected", changes: [] }),
  };
  const mockPage = {
    url: vi.fn().mockReturnValue("http://localhost:3000/products"),
  };

  (runner as any).stagehand = mockStagehand;
  (runner as any).tester = mockTester;
  (runner as any).page = mockPage;

  return { runner, mockStagehand, mockTester, mockPage };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("executeAdaptiveAct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes in one iteration without calling observe (iteration 0 uses original goal)", async () => {
    const { runner, mockStagehand } = makeRunner();
    vi.mocked(actEvaluator.evaluateActResult).mockResolvedValue({
      status: "complete",
      reason: "Product deleted",
    });

    await (runner as any).executeAdaptiveAct("Delete the product");

    // observe() is skipped on iteration 0 — the spec instruction is already precise
    expect(mockStagehand.observe).not.toHaveBeenCalled();
    expect(mockStagehand.act).toHaveBeenCalledWith("Delete the product");
    expect(actEvaluator.evaluateActResult).toHaveBeenCalledTimes(1);
  });

  it("uses observe candidate description to enrich intermediate iterations", async () => {
    const { runner, mockStagehand } = makeRunner();
    mockStagehand.observe.mockResolvedValue([
      { description: "Confirm button in the delete modal", selector: "#confirm-btn" },
    ]);
    vi.mocked(actEvaluator.evaluateActResult)
      .mockResolvedValueOnce({
        status: "incomplete",
        reason: "Confirmation modal appeared",
        nextContext: "A modal with Confirm/Cancel buttons is visible",
      })
      .mockResolvedValueOnce({ status: "complete", reason: "Done" });

    await (runner as any).executeAdaptiveAct("Delete the product");

    // observe() is called on iteration 1 with nextContext, not iteration 0
    expect(mockStagehand.observe).toHaveBeenCalledTimes(1);
    // Second act() uses the enriched description from observe
    expect(mockStagehand.act).toHaveBeenLastCalledWith(
      expect.stringContaining("Confirm button"),
    );
  });

  it("falls back to original instruction when observe returns no candidates", async () => {
    const { runner, mockStagehand } = makeRunner();
    mockStagehand.observe.mockResolvedValue([]);
    vi.mocked(actEvaluator.evaluateActResult).mockResolvedValue({
      status: "complete",
      reason: "Done",
    });

    await (runner as any).executeAdaptiveAct("Delete the product");

    expect(mockStagehand.act).toHaveBeenCalledWith("Delete the product");
  });

  it("loops on incomplete: handles modal in two iterations", async () => {
    const { runner, mockStagehand } = makeRunner();
    vi.mocked(actEvaluator.evaluateActResult)
      .mockResolvedValueOnce({
        status: "incomplete",
        reason: "Confirmation modal appeared",
        nextContext: "A modal with Confirm/Cancel buttons is visible",
      })
      .mockResolvedValueOnce({
        status: "complete",
        reason: "Product deleted after confirmation",
      });

    await (runner as any).executeAdaptiveAct("Delete the product");

    // Iteration 0: no observe. Iteration 1: observe with nextContext.
    expect(mockStagehand.observe).toHaveBeenCalledTimes(1);
    expect(mockStagehand.act).toHaveBeenCalledTimes(2);

    // The single observe call must use nextContext to find the confirmation button
    expect(mockStagehand.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.stringContaining("Confirm/Cancel"),
      }),
    );
  });

  it("passes accumulated history to evaluator on subsequent iterations", async () => {
    const { runner } = makeRunner();
    vi.mocked(actEvaluator.evaluateActResult)
      .mockResolvedValueOnce({
        status: "incomplete",
        reason: "Modal appeared",
        nextContext: "Confirm button visible",
      })
      .mockResolvedValueOnce({
        status: "complete",
        reason: "Done",
      });

    await (runner as any).executeAdaptiveAct("Delete the product");

    // Second call to evaluateActResult should carry history from iteration 0
    const secondCall = vi.mocked(actEvaluator.evaluateActResult).mock.calls[1][2];
    expect(secondCall.history).toHaveLength(1);
    expect(secondCall.iteration).toBe(1);
  });

  it("throws immediately on failed status — does not retry", async () => {
    const { runner, mockStagehand } = makeRunner();
    vi.mocked(actEvaluator.evaluateActResult).mockResolvedValue({
      status: "failed",
      reason: "No delete button found — page may have changed",
    });

    await expect(
      (runner as any).executeAdaptiveAct("Delete the product"),
    ).rejects.toThrow();

    // Must not retry after a hard failure
    expect(mockStagehand.act).toHaveBeenCalledTimes(1);
  });

  it("throws after MAX_ITERATIONS when always incomplete", async () => {
    const { runner, mockStagehand } = makeRunner();
    vi.mocked(actEvaluator.evaluateActResult).mockResolvedValue({
      status: "incomplete",
      reason: "Still stuck",
    });

    await expect(
      (runner as any).executeAdaptiveAct("Delete the product"),
    ).rejects.toThrow(/iterations|max/i);

    // Should have tried MAX_ITERATIONS times (expected: 5)
    expect(mockStagehand.act.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("takes before+after snapshots per iteration for evaluator diff", async () => {
    const { runner, mockTester } = makeRunner();
    vi.mocked(actEvaluator.evaluateActResult)
      .mockResolvedValueOnce({ status: "incomplete", reason: "Modal", nextContext: "Confirm" })
      .mockResolvedValueOnce({ status: "complete", reason: "Done" });

    await (runner as any).executeAdaptiveAct("Delete the product");

    // 2 iterations × 1 clearSnapshots + 2 snapshots each
    expect(mockTester.clearSnapshots).toHaveBeenCalledTimes(2);
    expect(mockTester.snapshot).toHaveBeenCalledTimes(4); // before + after × 2
  });
});
