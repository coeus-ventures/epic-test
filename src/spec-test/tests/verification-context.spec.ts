/**
 * Characterization tests for VerificationContext.
 * Locks current behavior before the Phase 2 refactoring (move to shared/).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { VerificationContext } from "../verification-context";
import type { BehaviorContext } from "../types";

function makeResult(
  behaviorId: string,
  status: BehaviorContext["status"],
  overrides?: Partial<BehaviorContext>
): BehaviorContext {
  return {
    behaviorId,
    behaviorName: behaviorId.replace(/-/g, " "),
    status,
    duration: 100,
    ...overrides,
  };
}

describe("VerificationContext", () => {
  let ctx: VerificationContext;

  beforeEach(() => {
    ctx = new VerificationContext();
  });

  it("starts with zero results", () => {
    expect(ctx.getAllResults().size).toBe(0);
    expect(ctx.getStatusCounts()).toEqual({ pass: 0, fail: 0, dependency_failed: 0 });
  });

  describe("markResult + getResult", () => {
    it("stores and retrieves a result by behavior ID", () => {
      const result = makeResult("sign-up", "pass");
      ctx.markResult("sign-up", result);
      expect(ctx.getResult("sign-up")).toEqual(result);
    });

    it("returns undefined for unknown behavior", () => {
      expect(ctx.getResult("nonexistent")).toBeUndefined();
    });

    it("overwrites a previous result for the same ID", () => {
      ctx.markResult("sign-up", makeResult("sign-up", "pass"));
      ctx.markResult("sign-up", makeResult("sign-up", "fail"));
      expect(ctx.getResult("sign-up")?.status).toBe("fail");
    });
  });

  describe("shouldSkip", () => {
    it("returns skip=false when all dependencies passed", () => {
      ctx.markResult("sign-up", makeResult("sign-up", "pass"));
      ctx.markResult("sign-in", makeResult("sign-in", "pass"));
      expect(ctx.shouldSkip(["sign-up", "sign-in"])).toEqual({ skip: false });
    });

    it("returns skip=true with reason when a dependency failed", () => {
      ctx.markResult("sign-up", makeResult("sign-up", "fail"));
      const result = ctx.shouldSkip(["sign-up"]);
      expect(result.skip).toBe(true);
      expect(result.reason).toContain("sign up");
    });

    it("returns skip=true when a dependency has dependency_failed status", () => {
      ctx.markResult("sign-up", makeResult("sign-up", "dependency_failed"));
      const result = ctx.shouldSkip(["sign-up"]);
      expect(result.skip).toBe(true);
    });

    it("returns skip=false when dependency has not been executed yet", () => {
      expect(ctx.shouldSkip(["unknown-behavior"])).toEqual({ skip: false });
    });

    it("returns skip=false for empty dependency list", () => {
      expect(ctx.shouldSkip([])).toEqual({ skip: false });
    });
  });

  describe("hasPassed", () => {
    it("returns true for passed behaviors", () => {
      ctx.markResult("sign-up", makeResult("sign-up", "pass"));
      expect(ctx.hasPassed("sign-up")).toBe(true);
    });

    it("returns false for failed behaviors", () => {
      ctx.markResult("sign-up", makeResult("sign-up", "fail"));
      expect(ctx.hasPassed("sign-up")).toBe(false);
    });

    it("returns false for unknown behaviors", () => {
      expect(ctx.hasPassed("nonexistent")).toBe(false);
    });
  });

  describe("getStatusCounts", () => {
    it("counts all three statuses correctly", () => {
      ctx.markResult("a", makeResult("a", "pass"));
      ctx.markResult("b", makeResult("b", "pass"));
      ctx.markResult("c", makeResult("c", "fail"));
      ctx.markResult("d", makeResult("d", "dependency_failed"));
      expect(ctx.getStatusCounts()).toEqual({ pass: 2, fail: 1, dependency_failed: 1 });
    });
  });

  describe("getAllResults", () => {
    it("returns a copy (mutations don't affect internal state)", () => {
      ctx.markResult("a", makeResult("a", "pass"));
      const copy = ctx.getAllResults();
      copy.delete("a");
      expect(ctx.getResult("a")).toBeDefined();
    });
  });

  describe("clear", () => {
    it("removes all results", () => {
      ctx.markResult("a", makeResult("a", "pass"));
      ctx.markResult("b", makeResult("b", "fail"));
      ctx.clear();
      expect(ctx.getAllResults().size).toBe(0);
      expect(ctx.getStatusCounts()).toEqual({ pass: 0, fail: 0, dependency_failed: 0 });
    });
  });
});
