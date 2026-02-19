import { describe, it, expect } from "vitest";
import type { HarborBehavior } from "../../spec-test/types";
import {
  topologicalSort,
  partitionBehaviors,
  buildTransitiveDependentsMap,
} from "../continuous-orchestrator";

// ============================================================================
// HELPERS — build test behavior graphs
// ============================================================================

function makeBehavior(
  id: string,
  deps: string[] = [],
  title?: string
): HarborBehavior {
  return {
    id,
    title: title ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    dependencies: deps.map((d) => ({ behaviorId: d })),
    examples: [{ name: `Execute ${id}`, steps: [] }],
  };
}

function toBehaviorMap(behaviors: HarborBehavior[]): Map<string, HarborBehavior> {
  return new Map(behaviors.map((b) => [b.id, b]));
}

// ============================================================================
// topologicalSort
// ============================================================================

describe("topologicalSort", () => {
  it("should return a single behavior with no dependencies", () => {
    const map = toBehaviorMap([makeBehavior("a")]);
    const sorted = topologicalSort(map);

    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe("a");
  });

  it("should order a linear chain correctly (A → B → C)", () => {
    const map = toBehaviorMap([
      makeBehavior("a"),
      makeBehavior("b", ["a"]),
      makeBehavior("c", ["b"]),
    ]);
    const sorted = topologicalSort(map);

    expect(sorted.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("should handle a diamond graph (A → B,C → D)", () => {
    const map = toBehaviorMap([
      makeBehavior("a"),
      makeBehavior("b", ["a"]),
      makeBehavior("c", ["a"]),
      makeBehavior("d", ["b", "c"]),
    ]);
    const sorted = topologicalSort(map);
    const ids = sorted.map((b) => b.id);

    // A must come first
    expect(ids[0]).toBe("a");
    // D must come last
    expect(ids[ids.length - 1]).toBe("d");
    // B and C must come before D
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("d"));
    expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("d"));
  });

  it("should detect cycles and throw", () => {
    const map = toBehaviorMap([
      makeBehavior("a", ["c"]),
      makeBehavior("b", ["a"]),
      makeBehavior("c", ["b"]),
    ]);

    expect(() => topologicalSort(map)).toThrow(/Cycle detected/);
  });

  it("should handle multiple roots", () => {
    const map = toBehaviorMap([
      makeBehavior("x"),
      makeBehavior("y"),
      makeBehavior("z", ["x", "y"]),
    ]);
    const sorted = topologicalSort(map);
    const ids = sorted.map((b) => b.id);

    // Both roots must appear before z
    expect(ids.indexOf("x")).toBeLessThan(ids.indexOf("z"));
    expect(ids.indexOf("y")).toBeLessThan(ids.indexOf("z"));
  });

  it("should sort the full customer-feedback-app graph correctly", () => {
    const map = toBehaviorMap([
      makeBehavior("sign-up"),
      makeBehavior("sign-in", ["sign-up"]),
      makeBehavior("invalid-sign-in", ["sign-up"]),
      makeBehavior("sign-out", ["sign-up"]),
      makeBehavior("create-survey", ["sign-up"]),
      makeBehavior("add-nps-question", ["create-survey"]),
      makeBehavior("add-text-question", ["create-survey"]),
      makeBehavior("add-multiple-choice-question", ["create-survey"]),
      makeBehavior("delete-survey", ["create-survey"]),
      makeBehavior("archive-survey", ["create-survey"]),
      makeBehavior("submit-survey-response", [
        "add-nps-question",
        "add-text-question",
        "add-multiple-choice-question",
      ]),
      makeBehavior("view-response-summary", ["submit-survey-response"]),
      makeBehavior("calculate-nps-score", ["submit-survey-response"]),
      makeBehavior("filter-responses", ["submit-survey-response"]),
      makeBehavior("export-responses", ["submit-survey-response"]),
    ]);

    const sorted = topologicalSort(map);
    const ids = sorted.map((b) => b.id);

    expect(sorted).toHaveLength(15);

    // Every behavior must appear after all its dependencies
    for (const [id, behavior] of map) {
      for (const dep of behavior.dependencies) {
        expect(ids.indexOf(dep.behaviorId)).toBeLessThan(
          ids.indexOf(id),
          `${dep.behaviorId} should come before ${id}`
        );
      }
    }

    // sign-up must be first (only root)
    expect(ids[0]).toBe("sign-up");
  });
});

// ============================================================================
// partitionBehaviors
// ============================================================================

describe("partitionBehaviors", () => {
  it("should separate auth from non-auth behaviors", () => {
    const sorted = [
      makeBehavior("sign-up"),
      makeBehavior("sign-in", ["sign-up"]),
      makeBehavior("invalid-sign-in", ["sign-up"]),
      makeBehavior("sign-out", ["sign-up"]),
      makeBehavior("create-survey", ["sign-up"]),
      makeBehavior("add-nps-question", ["create-survey"]),
    ];

    const { auth, nonAuth } = partitionBehaviors(sorted);

    expect(auth.map((b) => b.id)).toEqual([
      "sign-up",
      "sign-out",
      "invalid-sign-in",
      "sign-in",
    ]);
    expect(nonAuth.map((b) => b.id)).toEqual([
      "create-survey",
      "add-nps-question",
    ]);
  });

  it("should return auth in hardcoded order regardless of input order", () => {
    const sorted = [
      makeBehavior("sign-in", ["sign-up"]),
      makeBehavior("sign-up"),
      makeBehavior("sign-out", ["sign-up"]),
      makeBehavior("invalid-sign-in", ["sign-up"]),
    ];

    const { auth } = partitionBehaviors(sorted);

    expect(auth.map((b) => b.id)).toEqual([
      "sign-up",
      "sign-out",
      "invalid-sign-in",
      "sign-in",
    ]);
  });

  it("should handle specs with no auth behaviors", () => {
    const sorted = [
      makeBehavior("create-item"),
      makeBehavior("delete-item", ["create-item"]),
    ];

    const { auth, nonAuth } = partitionBehaviors(sorted);

    expect(auth).toHaveLength(0);
    expect(nonAuth).toHaveLength(2);
  });

  it("should preserve topological order for non-auth behaviors", () => {
    const sorted = [
      makeBehavior("sign-up"),
      makeBehavior("create-survey", ["sign-up"]),
      makeBehavior("add-question", ["create-survey"]),
      makeBehavior("submit-response", ["add-question"]),
    ];

    const { nonAuth } = partitionBehaviors(sorted);

    expect(nonAuth.map((b) => b.id)).toEqual([
      "create-survey",
      "add-question",
      "submit-response",
    ]);
  });
});

// ============================================================================
// buildTransitiveDependentsMap
// ============================================================================

describe("buildTransitiveDependentsMap", () => {
  it("should compute direct dependents for a simple chain", () => {
    const map = toBehaviorMap([
      makeBehavior("a"),
      makeBehavior("b", ["a"]),
      makeBehavior("c", ["b"]),
    ]);

    const transitiveMap = buildTransitiveDependentsMap(map);

    // a → {b, c} (c transitively depends on a via b)
    expect(transitiveMap.get("a")).toEqual(new Set(["b", "c"]));
    // b → {c}
    expect(transitiveMap.get("b")).toEqual(new Set(["c"]));
    // c → {} (nothing depends on c)
    expect(transitiveMap.get("c")).toEqual(new Set());
  });

  it("should cascade Create Survey failure to 10 behaviors", () => {
    const map = toBehaviorMap([
      makeBehavior("sign-up"),
      makeBehavior("create-survey", ["sign-up"]),
      makeBehavior("add-nps", ["create-survey"]),
      makeBehavior("add-text", ["create-survey"]),
      makeBehavior("add-mc", ["create-survey"]),
      makeBehavior("delete-survey", ["create-survey"]),
      makeBehavior("archive-survey", ["create-survey"]),
      makeBehavior("submit-response", ["add-nps", "add-text", "add-mc"]),
      makeBehavior("view-summary", ["submit-response"]),
      makeBehavior("calc-nps", ["submit-response"]),
      makeBehavior("filter", ["submit-response"]),
      makeBehavior("export", ["submit-response"]),
    ]);

    const transitiveMap = buildTransitiveDependentsMap(map);
    const createSurveyDependents = transitiveMap.get("create-survey")!;

    // Everything except sign-up and create-survey itself
    expect(createSurveyDependents.size).toBe(10);
    expect(createSurveyDependents.has("add-nps")).toBe(true);
    expect(createSurveyDependents.has("submit-response")).toBe(true);
    expect(createSurveyDependents.has("view-summary")).toBe(true);
    expect(createSurveyDependents.has("export")).toBe(true);
    expect(createSurveyDependents.has("sign-up")).toBe(false);
  });

  it("should cascade Sign Up failure to all other behaviors", () => {
    const map = toBehaviorMap([
      makeBehavior("sign-up"),
      makeBehavior("sign-in", ["sign-up"]),
      makeBehavior("create-survey", ["sign-up"]),
      makeBehavior("add-question", ["create-survey"]),
    ]);

    const transitiveMap = buildTransitiveDependentsMap(map);
    const signUpDependents = transitiveMap.get("sign-up")!;

    expect(signUpDependents.size).toBe(3);
    expect(signUpDependents.has("sign-in")).toBe(true);
    expect(signUpDependents.has("create-survey")).toBe(true);
    expect(signUpDependents.has("add-question")).toBe(true);
  });

  it("should handle behaviors with no dependents", () => {
    const map = toBehaviorMap([
      makeBehavior("a"),
      makeBehavior("b"),
    ]);

    const transitiveMap = buildTransitiveDependentsMap(map);

    expect(transitiveMap.get("a")).toEqual(new Set());
    expect(transitiveMap.get("b")).toEqual(new Set());
  });

  it("should handle diamond dependencies correctly", () => {
    const map = toBehaviorMap([
      makeBehavior("a"),
      makeBehavior("b", ["a"]),
      makeBehavior("c", ["a"]),
      makeBehavior("d", ["b", "c"]),
    ]);

    const transitiveMap = buildTransitiveDependentsMap(map);

    // a → {b, c, d}
    expect(transitiveMap.get("a")).toEqual(new Set(["b", "c", "d"]));
    // b → {d}
    expect(transitiveMap.get("b")).toEqual(new Set(["d"]));
    // c → {d}
    expect(transitiveMap.get("c")).toEqual(new Set(["d"]));
  });
});
