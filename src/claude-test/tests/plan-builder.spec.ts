import { describe, it, expect } from "vitest";
import { topologicalSort, buildVerificationPlan } from "../plan-builder";
import { extractCredentials } from "../credential-extractor";
import type { HarborBehavior } from "../../spec-test/types";

function makeBehavior(
  id: string,
  title: string,
  deps: string[] = [],
  steps: { type: "Act" | "Check" | "Await"; instruction: string }[] = [],
): HarborBehavior {
  return {
    id,
    title,
    dependencies: deps.map((d) => ({ behaviorId: d })),
    examples: [{ name: `Execute ${title}`, steps }],
  };
}

describe("topologicalSort", () => {
  it("puts auth behaviors first in canonical order", () => {
    const behaviors = [
      makeBehavior("view-tasks", "View Tasks", ["sign-up", "sign-in"]),
      makeBehavior("sign-out", "Sign Out", ["sign-up"]),
      makeBehavior("sign-in", "Sign In", ["sign-up"]),
      makeBehavior("sign-up", "Sign Up"),
    ];

    const sorted = topologicalSort(behaviors);
    const ids = sorted.map((b) => b.id);

    expect(ids.indexOf("sign-up")).toBeLessThan(ids.indexOf("sign-in"));
    expect(ids.indexOf("sign-in")).toBeLessThan(ids.indexOf("sign-out"));
    expect(ids.indexOf("sign-out")).toBeLessThan(ids.indexOf("view-tasks"));
  });

  it("sorts non-auth behaviors by dependency order", () => {
    const behaviors = [
      makeBehavior("sign-up", "Sign Up"),
      makeBehavior("delete-task", "Delete Task", ["add-task"]),
      makeBehavior("add-task", "Add Task"),
    ];

    const sorted = topologicalSort(behaviors);
    const ids = sorted.map((b) => b.id);

    expect(ids.indexOf("add-task")).toBeLessThan(ids.indexOf("delete-task"));
  });

  it("throws on cycle", () => {
    const behaviors = [
      makeBehavior("a", "A", ["b"]),
      makeBehavior("b", "B", ["a"]),
    ];

    expect(() => topologicalSort(behaviors)).toThrow("Cycle detected");
  });
});

describe("buildVerificationPlan", () => {
  it("generates markdown with ordered behaviors and CSV template", () => {
    const behaviors = [
      makeBehavior("sign-up", "Sign Up", [], [
        { type: "Act", instruction: 'Navigate to http://localhost:3000/sign-up' },
        { type: "Act", instruction: 'Type "alice@blog.com" into the email field' },
        { type: "Check", instruction: "The user is signed in" },
      ]),
      makeBehavior("add-task", "Add Task", ["sign-up"], [
        { type: "Act", instruction: 'Type "My task" into the input' },
        { type: "Await", instruction: "The task list updates" },
        { type: "Check", instruction: '"My task" is visible' },
      ]),
    ];

    const plan = buildVerificationPlan(behaviors);

    expect(plan).toContain("# Verification Plan");
    expect(plan).toContain("## Step 1: Sign Up");
    expect(plan).toContain("## Step 2: Add Task");
    expect(plan).toContain("* Act: Navigate to");
    expect(plan).toContain("* Await: The task list updates");
    expect(plan).toContain("* Check:");
    expect(plan).toContain("behavior_id,result,reason");
    expect(plan).toContain("sign-up,[pass or fail]");
    expect(plan).toContain("add-task,[pass or fail]");
  });

  it("rewrites signup email when credCtx is provided", () => {
    const behaviors = [
      makeBehavior("sign-up", "Sign Up", [], [
        { type: "Act", instruction: 'Type "alice@blog.com" into the email field' },
      ]),
    ];

    const credCtx = {
      runId: "test",
      signupEmail: "alice@blog.com",
      signupEmailUnique: "alice_test@blog.com",
      signupPassword: "password123",
      signinEmail: "",
      signinPassword: "demo123",
      invalidEmail: "wrong@email.com",
      invalidPassword: "wrongpassword",
    };

    const plan = buildVerificationPlan(behaviors, credCtx);

    expect(plan).toContain("alice_test@blog.com");
    expect(plan).not.toContain('"alice@blog.com"');
  });
});
