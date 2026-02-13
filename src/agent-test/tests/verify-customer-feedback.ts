#!/usr/bin/env bun
/**
 * Agent-based verification script for customer-feedback-app fixture.
 *
 * Uses Stagehand Agent API (CUA mode) for autonomous goal-driven execution
 * instead of step-by-step Act/Check replay.
 *
 * Usage:
 *   1. Start the app:  cd src/spec-test/tests/fixtures/customer-feedback-app && npm run dev
 *   2. Run verifier:   bun run src/agent-test/tests/verify-customer-feedback.ts
 */

import { AgentTestRunner, DEFAULT_MAX_STEPS } from "../index";
import { verifyAllBehaviors } from "../../spec-test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INSTRUCTION_PATH = path.join(
  __dirname,
  "..",
  "..",
  "spec-test",
  "tests",
  "fixtures",
  "customer-feedback-app",
  "instruction.md"
);
const BASE_URL = "http://localhost:3000";
const BEHAVIOR_TIMEOUT_MS = 180_000; // 3 minutes per behavior (agent needs more time)

async function main() {
  console.log("=".repeat(60));
  console.log("Customer Feedback App — Agent Verification Runner");
  console.log("=".repeat(60));
  console.log(`Base URL:    ${BASE_URL}`);
  console.log(`Instruction: ${INSTRUCTION_PATH}`);
  console.log(`Timeout:     ${BEHAVIOR_TIMEOUT_MS / 1000}s per behavior`);
  console.log(`Agent Mode:  cua`);
  console.log(`Max Steps:   ${DEFAULT_MAX_STEPS}\n`);

  const runner = new AgentTestRunner({
    baseUrl: BASE_URL,
    headless: true,
    agentMode: "cua",
    maxSteps: DEFAULT_MAX_STEPS,
  });

  try {
    const summary = await verifyAllBehaviors(
      INSTRUCTION_PATH,
      runner,
      BEHAVIOR_TIMEOUT_MS
    );

    console.log("\n" + "=".repeat(60));
    console.log("Verification Results (Agent Mode)");
    console.log("=".repeat(60));

    summary.behaviors.forEach((behavior) => {
      const icon =
        behavior.status === "pass"
          ? "PASS"
          : behavior.status === "fail"
            ? "FAIL"
            : "SKIP";

      const duration = behavior.duration
        ? ` (${(behavior.duration / 1000).toFixed(1)}s)`
        : "";
      console.log(`  [${icon}] ${behavior.behaviorName}${duration}`);

      if (behavior.status === "fail" && behavior.error) {
        console.log(`         Error: ${behavior.error.slice(0, 200)}`);
      }
      if (behavior.status === "dependency_failed") {
        console.log(
          `         Skipped: dependency "${behavior.failedDependency}" failed`
        );
      }
    });

    console.log("\n" + "-".repeat(60));
    console.log(`  Passed:            ${summary.passed}`);
    console.log(`  Failed:            ${summary.failed}`);
    console.log(`  Dependency failed: ${summary.dependency_failed}`);
    console.log(`  Total:             ${summary.total}`);
    console.log(
      `  Reward:            ${summary.reward.toFixed(2)} (${(summary.reward * 100).toFixed(1)}%)`
    );
    console.log(`  Duration:          ${(summary.duration / 1000).toFixed(1)}s`);
    console.log("-".repeat(60));

    process.exit(summary.reward === 1 ? 0 : 1);
  } catch (err) {
    console.error(
      `Fatal error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  } finally {
    await runner.close();
  }
}

main();
