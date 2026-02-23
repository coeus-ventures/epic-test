/**
 * Integration runner for the help-desk-app fixture.
 *
 * This is the automated debugger target for v5 adaptive pipeline development.
 * Set breakpoints anywhere in src/spec-test/ and launch via VS Code:
 *   "Debug: Help-desk App (starts app automatically)"
 *   "Debug: Help-desk App (app already running)"
 *
 * Run manually:
 *   npx vitest run --config vitest.app.config.ts --reporter=verbose
 *
 * Requires help-desk-app running on APP_URL (default: http://localhost:3000).
 * Tests skip automatically when the app is not reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { SpecTestRunner } from "../index";
import { verifyAllBehaviors } from "../orchestrator";
import type { VerificationSummary } from "../types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const INSTRUCTION_PATH = path.join(__dirname, "fixtures/help-desk-app/instruction.md");

// Top-level await so the flag is set before it.skipIf() evaluates at collection time.
const appRunning = await (async () => {
  try {
    const res = await fetch(APP_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
})();

if (!appRunning) {
  console.warn(`\n[SKIP] help-desk-app not reachable at ${APP_URL} — all tests will be skipped`);
}

function logSummary(summary: VerificationSummary): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Help Desk App — Verification Results`);
  console.log(`${"─".repeat(60)}`);

  for (const behavior of summary.behaviors) {
    const icon =
      behavior.status === "pass" ? "✓" :
      behavior.status === "fail" ? "✗" : "~";
    const label =
      behavior.status === "dependency_failed"
        ? `skipped (${behavior.failedDependency} failed)`
        : behavior.status;
    console.log(`  ${icon} ${behavior.behaviorName}: ${label}`);
    if (behavior.error) {
      console.log(`      ${behavior.error}`);
    }
  }

  console.log(`${"─".repeat(60)}`);
  console.log(`Passed: ${summary.passed}/${summary.total}  |  Reward: ${(summary.reward * 100).toFixed(0)}%  |  ${summary.duration}ms`);
  console.log(`${"─".repeat(60)}\n`);
}

describe("Help Desk App — Adaptive Loop Integration", () => {
  let runner: SpecTestRunner;

  beforeAll(async () => {
    if (!appRunning) return;
    runner = new SpecTestRunner({
      baseUrl: APP_URL,
      headless: true,
      // headless: false,  // uncomment to watch browser while debugging
    });
  });

  afterAll(async () => {
    if (runner) await runner.close();
  });

  it.skipIf(!appRunning)(
    "verifies all behaviors",
    async () => {
      const summary = await verifyAllBehaviors(INSTRUCTION_PATH, runner);
      logSummary(summary);

      // Auth behaviors must pass — they are the foundation of all chains
      const signUp = summary.behaviors.find(b => b.behaviorId === "sign-up");
      expect(signUp?.status, "sign-up must pass for any chain to work").toBe("pass");

      // At minimum, auth + create-ticket should work
      expect(summary.reward).toBeGreaterThan(0);
    },
    300_000,
  );

  it.skipIf(!appRunning)(
    "create-ticket completes with adaptive loop (form submission)",
    async () => {
      const summary = await verifyAllBehaviors(INSTRUCTION_PATH, runner);
      const createTicket = summary.behaviors.find(b => b.behaviorId === "create-ticket");

      // This behavior exercises: form opens (possibly modal), fields filled, submit, redirect
      // The adaptive loop should handle any form-open/submit variant the app implemented
      expect(createTicket?.status).toBe("pass");
    },
    300_000,
  );

  it.skipIf(!appRunning)(
    "assign-ticket-to-agent handles parameterized route navigation",
    async () => {
      const summary = await verifyAllBehaviors(INSTRUCTION_PATH, runner);
      const assign = summary.behaviors.find(b => b.behaviorId === "assign-ticket-to-agent");

      // This behavior lives on /tickets/:id — the loop must navigate to the entity
      // from the list page before the assign action can run
      expect(assign?.status).toBe("pass");
    },
    300_000,
  );

  it.skipIf(!appRunning)(
    "resolve-ticket works regardless of UI implementation (button vs dropdown)",
    async () => {
      const summary = await verifyAllBehaviors(INSTRUCTION_PATH, runner);
      const resolve = summary.behaviors.find(b => b.behaviorId === "resolve-ticket");

      // "Click the Resolve button" — the app may implement this as:
      //   a) direct Resolve button
      //   b) status dropdown → select Resolved
      //   c) Resolve button → confirmation modal
      // The adaptive loop should handle all variants
      expect(resolve?.status).toBe("pass");
    },
    300_000,
  );
});
