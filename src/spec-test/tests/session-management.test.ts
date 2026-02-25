/**
 * Tests for session-management.ts — safeWaitForLoadState (issue 011).
 *
 * Test-first: these tests define the expected behavior before the wrapper
 * is added. Run them first to see them fail, then implement to make them pass.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeWaitForLoadState } from "../session-management";

function makeMockPage(behavior: "success" | "timeout" | "other-error") {
  return {
    waitForLoadState: vi.fn().mockImplementation(async () => {
      if (behavior === "timeout") {
        const err = new Error("Timeout 5000ms exceeded");
        err.name = "TimeoutError";
        throw err;
      }
      if (behavior === "other-error") {
        throw new Error("Page crashed");
      }
    }),
  };
}

describe("safeWaitForLoadState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves normally when waitForLoadState succeeds", async () => {
    const page = makeMockPage("success");
    await expect(safeWaitForLoadState(page as any)).resolves.toBeUndefined();
    expect(page.waitForLoadState).toHaveBeenCalledWith("networkidle", { timeout: 5000 });
  });

  it("swallows TimeoutError and resolves without throwing", async () => {
    const page = makeMockPage("timeout");
    // Apps with persistent connections (HMR, WebSocket) never reach networkidle.
    // The wrapper must not throw — the page content is already loaded.
    await expect(safeWaitForLoadState(page as any)).resolves.toBeUndefined();
  });

  it("accepts a custom timeout", async () => {
    const page = makeMockPage("success");
    await safeWaitForLoadState(page as any, 3000);
    expect(page.waitForLoadState).toHaveBeenCalledWith("networkidle", { timeout: 3000 });
  });
});
