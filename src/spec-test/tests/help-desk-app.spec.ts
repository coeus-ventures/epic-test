// ============================================================================
// HELP-DESK-APP FIXTURE — comprehensive parsing + v4 helper integration tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import {
  parseHarborBehaviorsWithDependencies,
  buildDependencyChain,
  isSaveAction,
  isModalTriggerAction,
  isModalDismissAction,
  extractSelectAction,
  extractNavigationTarget,
  isNavigationAction,
  isRefreshAction,
  extractExpectedText,
  classifyCheck,
  processStepsWithCredentials,
  CredentialTracker,
} from "../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_PATH = path.join(__dirname, "fixtures", "help-desk-app", "instruction.md");

async function loadBehaviors() {
  const content = await readFile(FIXTURE_PATH, "utf-8");
  return parseHarborBehaviorsWithDependencies(content);
}

// ============================================================================
// 1. PARSING — All 13 behaviors parsed correctly
// ============================================================================

describe("help-desk-app — parsing", () => {
  it("should parse all 13 behaviors from instruction.md", async () => {
    const behaviors = await loadBehaviors();

    expect(behaviors.size).toBe(13);

    const expectedIds = [
      "sign-up", "sign-in", "invalid-sign-in", "sign-out",
      "create-ticket", "assign-ticket-to-agent", "add-reply-to-ticket",
      "change-ticket-status", "resolve-ticket", "filter-tickets-by-status",
      "filter-tickets-by-priority", "add-internal-note", "search-tickets",
    ];

    for (const id of expectedIds) {
      expect(behaviors.has(id), `Missing behavior: ${id}`).toBe(true);
    }
  });

  it("should parse behavior titles correctly", async () => {
    const behaviors = await loadBehaviors();

    expect(behaviors.get("sign-up")!.title).toBe("Sign Up");
    expect(behaviors.get("create-ticket")!.title).toBe("Create Ticket");
    expect(behaviors.get("assign-ticket-to-agent")!.title).toBe("Assign Ticket to Agent");
    expect(behaviors.get("filter-tickets-by-status")!.title).toBe("Filter Tickets by Status");
  });

  it("should parse descriptions", async () => {
    const behaviors = await loadBehaviors();

    expect(behaviors.get("sign-up")!.description).toContain("support agents");
    expect(behaviors.get("create-ticket")!.description).toContain("support tickets");
  });

  it("should parse each behavior with at least one example", async () => {
    const behaviors = await loadBehaviors();

    for (const [id, behavior] of behaviors) {
      expect(behavior.examples.length, `No examples for ${id}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("should parse Sign Up example steps correctly", async () => {
    const behaviors = await loadBehaviors();
    const signUp = behaviors.get("sign-up")!;
    const example = signUp.examples[0];

    expect(example.name).toBe("User creates a new account");
    expect(example.steps).toHaveLength(6);

    // 5 act steps + 1 check step
    const acts = example.steps.filter(s => s.type === "act");
    const checks = example.steps.filter(s => s.type === "check");
    expect(acts).toHaveLength(5);
    expect(checks).toHaveLength(1);

    // First step is navigation
    expect(example.steps[0].instruction).toContain("Navigate to http://localhost:3000/sign-up");
    // Last step is semantic check
    expect(checks[0].checkType).toBe("semantic");
  });

  it("should parse Create Ticket example with select action", async () => {
    const behaviors = await loadBehaviors();
    const createTicket = behaviors.get("create-ticket")!;
    const steps = createTicket.examples[0].steps;

    // Should have the "Select 'High' from the priority dropdown" step
    const selectStep = steps.find(s => s.instruction.includes("Select"));
    expect(selectStep).toBeDefined();
    expect(selectStep!.instruction).toContain("High");
    expect(selectStep!.instruction).toContain("priority");
  });

  it("should parse Invalid Sign In with two check steps", async () => {
    const behaviors = await loadBehaviors();
    const invalid = behaviors.get("invalid-sign-in")!;
    const checks = invalid.examples[0].steps.filter(s => s.type === "check");

    expect(checks).toHaveLength(2);
    expect(checks[0].instruction).toContain("error message");
    expect(checks[1].instruction).toContain("sign in form");
  });
});

// ============================================================================
// 2. PAGE PATHS — Behaviors mapped to correct routes
// ============================================================================

describe("help-desk-app — page paths", () => {
  it("should map auth behaviors to their page paths", async () => {
    const behaviors = await loadBehaviors();

    expect(behaviors.get("sign-up")!.pagePath).toBe("/sign-up");
    expect(behaviors.get("sign-in")!.pagePath).toBe("/sign-in");
    expect(behaviors.get("invalid-sign-in")!.pagePath).toBe("/sign-in");
  });

  it("should map ticket list behaviors to /tickets", async () => {
    const behaviors = await loadBehaviors();

    expect(behaviors.get("sign-out")!.pagePath).toBe("/tickets");
    expect(behaviors.get("create-ticket")!.pagePath).toBe("/tickets");
    expect(behaviors.get("filter-tickets-by-status")!.pagePath).toBe("/tickets");
    expect(behaviors.get("filter-tickets-by-priority")!.pagePath).toBe("/tickets");
    expect(behaviors.get("search-tickets")!.pagePath).toBe("/tickets");
  });

  it("should map ticket detail behaviors to /tickets/:id", async () => {
    const behaviors = await loadBehaviors();

    expect(behaviors.get("assign-ticket-to-agent")!.pagePath).toBe("/tickets/:id");
    expect(behaviors.get("add-reply-to-ticket")!.pagePath).toBe("/tickets/:id");
    expect(behaviors.get("change-ticket-status")!.pagePath).toBe("/tickets/:id");
    expect(behaviors.get("resolve-ticket")!.pagePath).toBe("/tickets/:id");
    expect(behaviors.get("add-internal-note")!.pagePath).toBe("/tickets/:id");
  });
});

// ============================================================================
// 3. DEPENDENCIES — Correct dependency declarations
// ============================================================================

describe("help-desk-app — dependencies", () => {
  it("should parse Sign Up with no dependencies", async () => {
    const behaviors = await loadBehaviors();
    expect(behaviors.get("sign-up")!.dependencies).toHaveLength(0);
  });

  it("should parse Sign In dependency on Sign Up with scenario name", async () => {
    const behaviors = await loadBehaviors();
    const signIn = behaviors.get("sign-in")!;

    expect(signIn.dependencies).toHaveLength(1);
    expect(signIn.dependencies[0].behaviorId).toBe("sign-up");
    expect(signIn.dependencies[0].scenarioName).toBe("User creates a new account");
  });

  it("should parse behaviors with single dependency (Sign Up)", async () => {
    const behaviors = await loadBehaviors();

    for (const id of ["sign-out", "create-ticket"]) {
      const behavior = behaviors.get(id)!;
      expect(behavior.dependencies).toHaveLength(1);
      expect(behavior.dependencies[0].behaviorId).toBe("sign-up");
    }
  });

  it("should parse behaviors with two dependencies (Sign Up + Create Ticket)", async () => {
    const behaviors = await loadBehaviors();

    const twoDepBehaviors = [
      "assign-ticket-to-agent", "add-reply-to-ticket",
      "change-ticket-status", "resolve-ticket",
      "filter-tickets-by-status", "filter-tickets-by-priority",
      "add-internal-note", "search-tickets",
    ];

    for (const id of twoDepBehaviors) {
      const behavior = behaviors.get(id)!;
      expect(behavior.dependencies, `Wrong deps for ${id}`).toHaveLength(2);
      expect(behavior.dependencies[0].behaviorId).toBe("sign-up");
      expect(behavior.dependencies[1].behaviorId).toBe("create-ticket");
    }
  });
});

// ============================================================================
// 4. DEPENDENCY CHAINS — buildDependencyChain produces correct execution order
// ============================================================================

describe("help-desk-app — dependency chains", () => {
  it("should build trivial chain for Sign Up (no deps)", async () => {
    const behaviors = await loadBehaviors();
    const chain = buildDependencyChain("sign-up", behaviors);

    expect(chain).toHaveLength(1);
    expect(chain[0].behavior.id).toBe("sign-up");
  });

  it("should build Sign In chain: Sign Up → Sign In", async () => {
    const behaviors = await loadBehaviors();
    const chain = buildDependencyChain("sign-in", behaviors);

    expect(chain).toHaveLength(2);
    expect(chain[0].behavior.id).toBe("sign-up");
    expect(chain[0].scenarioName).toBe("User creates a new account");
    expect(chain[1].behavior.id).toBe("sign-in");
  });

  it("should build Assign Ticket chain: Sign Up → Create Ticket → Assign Ticket", async () => {
    const behaviors = await loadBehaviors();
    const chain = buildDependencyChain("assign-ticket-to-agent", behaviors);

    expect(chain).toHaveLength(3);
    expect(chain[0].behavior.id).toBe("sign-up");
    expect(chain[1].behavior.id).toBe("create-ticket");
    expect(chain[2].behavior.id).toBe("assign-ticket-to-agent");
  });

  it("should deduplicate shared dependencies across chains", async () => {
    const behaviors = await loadBehaviors();

    // Filter Tickets by Status depends on Sign Up + Create Ticket
    // Create Ticket also depends on Sign Up
    // The chain should be: Sign Up → Create Ticket → Filter, NOT Sign Up → Sign Up → Create → Filter
    const chain = buildDependencyChain("filter-tickets-by-status", behaviors);

    const ids = chain.map(c => c.behavior.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size); // no duplicates
    expect(chain).toHaveLength(3);
    expect(ids).toEqual(["sign-up", "create-ticket", "filter-tickets-by-status"]);
  });
});

// ============================================================================
// 5. STEP CLASSIFICATION — Check steps classified correctly
// ============================================================================

describe("help-desk-app — check classification", () => {
  it("should classify text-visibility checks as semantic", async () => {
    const behaviors = await loadBehaviors();
    const createTicket = behaviors.get("create-ticket")!;
    const check = createTicket.examples[0].steps.find(s => s.type === "check")!;

    // 'The text "Cannot login to my account" is visible on the page' → semantic
    expect(check.checkType).toBe("semantic");
  });

  it("should classify all help-desk-app checks as semantic", async () => {
    const behaviors = await loadBehaviors();

    // All checks in this app are text-visibility or UI-state checks → semantic
    for (const [id, behavior] of behaviors) {
      for (const example of behavior.examples) {
        const checks = example.steps.filter(s => s.type === "check");
        for (const check of checks) {
          expect(check.checkType, `${id}: "${check.instruction}" should be semantic`).toBe("semantic");
        }
      }
    }
  });
});

// ============================================================================
// 6. V4 INSTRUCTION DETECTION — helpers match help-desk-app patterns
// ============================================================================

describe("help-desk-app — v4 instruction detection helpers", () => {
  it("should detect select actions in help-desk-app steps", async () => {
    const behaviors = await loadBehaviors();

    // Create Ticket: Select "High" from the priority dropdown
    const createTicket = behaviors.get("create-ticket")!;
    const selectStep = createTicket.examples[0].steps.find(
      s => s.instruction.includes("Select")
    )!;
    const result = extractSelectAction(selectStep.instruction);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("High");

    // Assign Ticket: Select "Agent Smith" from the assignee dropdown
    const assignTicket = behaviors.get("assign-ticket-to-agent")!;
    const assignSelect = assignTicket.examples[0].steps.find(
      s => s.instruction.includes("Select")
    )!;
    const assignResult = extractSelectAction(assignSelect.instruction);
    expect(assignResult).not.toBeNull();
    expect(assignResult!.value).toBe("Agent Smith");
  });

  it("should detect all select actions across behaviors", async () => {
    const behaviors = await loadBehaviors();

    const selectSteps: { behaviorId: string; instruction: string; value: string }[] = [];

    for (const [id, behavior] of behaviors) {
      for (const example of behavior.examples) {
        for (const step of example.steps) {
          const result = extractSelectAction(step.instruction);
          if (result) {
            selectSteps.push({ behaviorId: id, instruction: step.instruction, value: result.value });
          }
        }
      }
    }

    // Expected select actions:
    // create-ticket: "High" from priority dropdown
    // assign-ticket-to-agent: "Agent Smith" from assignee dropdown
    // change-ticket-status: "In Progress" from status dropdown
    // filter-tickets-by-status: "Resolved" from status dropdown, "Open" from status filter
    // filter-tickets-by-priority: "High" from priority dropdown, "Low" from priority dropdown, "High" from priority filter
    expect(selectSteps.length).toBeGreaterThanOrEqual(7);

    const values = selectSteps.map(s => s.value);
    expect(values).toContain("High");
    expect(values).toContain("Agent Smith");
    expect(values).toContain("In Progress");
    expect(values).toContain("Resolved");
    expect(values).toContain("Open");
    expect(values).toContain("Low");
  });

  it("should detect save actions in help-desk-app steps", async () => {
    const behaviors = await loadBehaviors();

    // Assign Ticket: Click the "Save" button → isSaveAction
    const assignTicket = behaviors.get("assign-ticket-to-agent")!;
    const saveStep = assignTicket.examples[0].steps.find(
      s => s.instruction.includes("Save")
    )!;
    expect(isSaveAction(saveStep.instruction)).toBe(true);

    // Create Ticket: Click the "Submit" button → isSaveAction
    const createTicket = behaviors.get("create-ticket")!;
    const submitStep = createTicket.examples[0].steps.find(
      s => s.instruction.includes("Submit")
    )!;
    expect(isSaveAction(submitStep.instruction)).toBe(true);
  });

  it("should detect navigation targets in help-desk-app steps", async () => {
    const behaviors = await loadBehaviors();

    // Filter by Status: Click the "Tickets" button in the navigation
    const filterStatus = behaviors.get("filter-tickets-by-status")!;
    const navStep = filterStatus.examples[0].steps.find(
      s => s.instruction.includes("navigation")
    )!;
    expect(navStep).toBeDefined();
    const target = extractNavigationTarget(navStep.instruction);
    expect(target).not.toBeNull();
    expect(target).toContain("tickets");
  });

  it("should detect navigate-to actions in Sign Up / Sign In", async () => {
    const behaviors = await loadBehaviors();

    const signUp = behaviors.get("sign-up")!;
    const navStep = signUp.examples[0].steps[0];
    const url = isNavigationAction(navStep.instruction);
    expect(url).not.toBeNull();
    expect(url).toContain("/sign-up");
  });

  it("should NOT detect modal triggers/dismiss in help-desk-app steps", async () => {
    const behaviors = await loadBehaviors();

    // Save buttons are NOT modal dismiss actions (no modal/dialog keyword)
    const assignTicket = behaviors.get("assign-ticket-to-agent")!;
    const saveStep = assignTicket.examples[0].steps.find(
      s => s.instruction.includes("Save")
    )!;
    expect(isModalDismissAction(saveStep.instruction)).toBe(false);
  });
});

// ============================================================================
// 7. CREDENTIAL TRACKING — Sign Up steps capture credentials
// ============================================================================

describe("help-desk-app — credential tracking", () => {
  it("should capture email and password from Sign Up steps", async () => {
    const behaviors = await loadBehaviors();
    const signUp = behaviors.get("sign-up")!;
    const steps = signUp.examples[0].steps;

    const tracker = new CredentialTracker();
    for (const step of steps) {
      if (step.type === "act") {
        tracker.captureFromStep(step.instruction);
      }
    }

    expect(tracker.hasCredentials()).toBe(true);
    const creds = tracker.getCredentials();
    expect(creds.email).toBe("newagent@company.com");
    expect(creds.password).toBe("password123");
  });

  it("should uniquify Sign Up email via processStepsWithCredentials", async () => {
    const behaviors = await loadBehaviors();
    const signUp = behaviors.get("sign-up")!;
    const steps = signUp.examples[0].steps;

    const tracker = new CredentialTracker();
    const processed = processStepsWithCredentials(signUp, steps, tracker);

    // Email should be uniquified with counter suffix
    const emailStep = processed.find(s => s.instruction.includes("email input"));
    expect(emailStep).toBeDefined();
    expect(emailStep!.instruction).toContain("_1@");
    expect(emailStep!.instruction).not.toContain("newagent@company.com");
  });

  it("should inject credentials into Sign In steps", async () => {
    const behaviors = await loadBehaviors();
    const signUp = behaviors.get("sign-up")!;
    const signIn = behaviors.get("sign-in")!;

    // First capture from Sign Up
    const tracker = new CredentialTracker();
    for (const step of signUp.examples[0].steps) {
      if (step.type === "act") tracker.captureFromStep(step.instruction);
    }

    // Then process Sign In — should inject captured credentials
    const processed = processStepsWithCredentials(
      signIn, signIn.examples[0].steps, tracker
    );

    const emailStep = processed.find(s => s.instruction.includes("email input"));
    expect(emailStep).toBeDefined();
    // Should have the captured email injected (not the original "agent@company.com")
    expect(emailStep!.instruction).toContain("newagent@company.com");
  });
});
