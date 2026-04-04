/**
 * Characterization tests for session-management.ts.
 * Locks current behavior before the Phase 2 refactoring (move to shared/).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  safeWaitForLoadState,
  urlsMatch,
  isSignInRedirect,
  detectPort,
  resetSession,
  navigateToPagePath,
  clearFormFields,
} from "../session-management";

// ─── safeWaitForLoadState ────────────────────────────────────────────────

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
    await expect(safeWaitForLoadState(page as any)).resolves.toBeUndefined();
  });

  it("accepts a custom timeout", async () => {
    const page = makeMockPage("success");
    await safeWaitForLoadState(page as any, 3000);
    expect(page.waitForLoadState).toHaveBeenCalledWith("networkidle", { timeout: 3000 });
  });
});

// ─── urlsMatch ───────────────────────────────────────────────────────────

describe("urlsMatch", () => {
  it("matches identical URLs", () => {
    expect(urlsMatch("http://localhost:3000", "http://localhost:3000")).toBe(true);
  });

  it("matches URLs differing only by trailing slash", () => {
    expect(urlsMatch("http://localhost:3000/", "http://localhost:3000")).toBe(true);
    expect(urlsMatch("http://localhost:3000", "http://localhost:3000/")).toBe(true);
  });

  it("does not match different paths", () => {
    expect(urlsMatch("http://localhost:3000/a", "http://localhost:3000/b")).toBe(false);
  });

  it("does not match different ports", () => {
    expect(urlsMatch("http://localhost:3000", "http://localhost:5173")).toBe(false);
  });
});

// ─── isSignInRedirect ────────────────────────────────────────────────────

describe("isSignInRedirect", () => {
  it("returns true for /sign-in redirect", () => {
    expect(isSignInRedirect("http://localhost:3000/sign-in", "http://localhost:3000/dashboard")).toBe(true);
  });

  it("returns true for /login redirect", () => {
    expect(isSignInRedirect("http://localhost:3000/login", "http://localhost:3000/dashboard")).toBe(true);
  });

  it("returns true for /auth redirect", () => {
    expect(isSignInRedirect("http://localhost:3000/auth", "http://localhost:3000/dashboard")).toBe(true);
  });

  it("returns true for /signin (no hyphen) redirect", () => {
    expect(isSignInRedirect("http://localhost:3000/signin", "http://localhost:3000/dashboard")).toBe(true);
  });

  it("returns false when current URL matches target", () => {
    expect(isSignInRedirect("http://localhost:3000/dashboard", "http://localhost:3000/dashboard")).toBe(false);
  });

  it("returns false for non-auth redirect", () => {
    expect(isSignInRedirect("http://localhost:3000/settings", "http://localhost:3000/dashboard")).toBe(false);
  });
});

// ─── detectPort ──────────────────────────────────────────────────────────

describe("detectPort", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns original baseUrl when configured port responds", async () => {
    const page = {
      goto: vi.fn().mockResolvedValue({ ok: () => true }),
    };
    const result = await detectPort(page as any, "http://localhost:3000");
    expect(result).toBe("http://localhost:3000");
  });

  it("returns alternative port URL when configured port fails", async () => {
    let callCount = 0;
    const page = {
      goto: vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        // First call (configured port 3000) fails
        if (callCount === 1) throw new Error("Connection refused");
        // Second call: port 3000 again (in alternatives) — skip
        // but alternatives start after configured, so next is 5173
        if (url.includes("5173")) return { ok: () => true };
        throw new Error("Connection refused");
      }),
    };
    const result = await detectPort(page as any, "http://localhost:3000");
    expect(result).toBe("http://localhost:5173");
  });

  it("returns original baseUrl when no port responds", async () => {
    const page = {
      goto: vi.fn().mockRejectedValue(new Error("Connection refused")),
    };
    const result = await detectPort(page as any, "http://localhost:3000");
    expect(result).toBe("http://localhost:3000");
  });
});

// ─── resetSession ────────────────────────────────────────────────────────

describe("resetSession", () => {
  it("navigates to about:blank, then baseUrl, clears storage, and reloads", async () => {
    const calls: string[] = [];
    const page = {
      goto: vi.fn().mockImplementation(async (url: string) => { calls.push(`goto:${url}`); }),
      evaluate: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockImplementation(async () => { calls.push("reload"); }),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("http://localhost:3000"),
    };

    await resetSession(page as any, "http://localhost:3000");

    expect(calls[0]).toBe("goto:about:blank");
    expect(calls[1]).toBe("goto:http://localhost:3000");
    expect(page.evaluate).toHaveBeenCalled();
    expect(calls[2]).toBe("reload");
  });
});

// ─── navigateToPagePath ──────────────────────────────────────────────────

describe("navigateToPagePath", () => {
  it("skips navigation when already on target URL", async () => {
    const page = {
      url: vi.fn().mockReturnValue("http://localhost:3000/candidates"),
      evaluate: vi.fn(),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
    };

    await navigateToPagePath(page as any, "/candidates", "http://localhost:3000");
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("soft-navigates to target path", async () => {
    const page = {
      url: vi.fn()
        .mockReturnValueOnce("http://localhost:3000/")
        .mockReturnValueOnce("http://localhost:3000/candidates"),
      evaluate: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
    };

    await navigateToPagePath(page as any, "/candidates", "http://localhost:3000");
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), "http://localhost:3000/candidates");
  });

  it("resolves parameterized routes to parent path", async () => {
    const page = {
      url: vi.fn()
        .mockReturnValueOnce("http://localhost:3000/")
        .mockReturnValueOnce("http://localhost:3000/products"),
      evaluate: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
    };

    await navigateToPagePath(page as any, "/products/:id", "http://localhost:3000");
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), "http://localhost:3000/products");
  });

  it("skips navigation when parameterized route resolves to root", async () => {
    const page = {
      url: vi.fn().mockReturnValue("http://localhost:3000/"),
      evaluate: vi.fn(),
    };

    await navigateToPagePath(page as any, "/:id", "http://localhost:3000");
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("attempts auth recovery when redirected to sign-in", async () => {
    const page = {
      url: vi.fn()
        .mockReturnValueOnce("http://localhost:3000/")
        .mockReturnValueOnce("http://localhost:3000/sign-in"),
      evaluate: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
    };
    const stagehand = {
      act: vi.fn().mockResolvedValue(undefined),
    };
    const credentials = { email: "test@test.com", password: "pass123" };

    await navigateToPagePath(
      page as any,
      "/dashboard",
      "http://localhost:3000",
      stagehand as any,
      credentials
    );

    // Should have called stagehand.act for email, password, and sign in
    expect(stagehand.act).toHaveBeenCalledTimes(3);
  });
});

// ─── clearFormFields ─────────────────────────────────────────────────────

describe("clearFormFields", () => {
  it("calls page.evaluate to clear fields programmatically", async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue(false),
    };

    await clearFormFields(page as any);
    expect(page.evaluate).toHaveBeenCalled();
  });
});
