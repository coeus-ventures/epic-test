#!/usr/bin/env bun
/**
 * Verification script for customer-feedback-app fixture.
 *
 * Usage:
 *   1. Start the app:  cd src/spec-test/tests/fixtures/customer-feedback-app && npm run dev
 *   2. Run verifier:   bun run src/spec-test/tests/verify-customer-feedback.ts
 */

import { SpecTestRunner, verifyAllBehaviors } from "../index";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INSTRUCTION_PATH = path.join(__dirname, "fixtures", "customer-feedback-app", "instruction.md");
const BASE_URL = "http://localhost:3000";
const BEHAVIOR_TIMEOUT_MS = 120_000; // 2 minutes per behavior

async function main() {
  console.log("=".repeat(60));
  console.log("Customer Feedback App — Verification Runner");
  console.log("=".repeat(60));
  console.log(`Base URL:    ${BASE_URL}`);
  console.log(`Instruction: ${INSTRUCTION_PATH}`);
  console.log(`Timeout:     ${BEHAVIOR_TIMEOUT_MS / 1000}s per behavior\n`);

  const runner = new SpecTestRunner({
    baseUrl: BASE_URL,
    headless: true,
  });

  try {
    const summary = await verifyAllBehaviors(INSTRUCTION_PATH, runner, BEHAVIOR_TIMEOUT_MS);

    console.log("\n" + "=".repeat(60));
    console.log("Verification Results");
    console.log("=".repeat(60));

    for (const behavior of summary.behaviors) {
      const icon =
        behavior.status === "pass" ? "PASS" :
        behavior.status === "fail" ? "FAIL" :
        "SKIP";

      const duration = behavior.duration ? ` (${(behavior.duration / 1000).toFixed(1)}s)` : "";
      console.log(`  [${icon}] ${behavior.behaviorName}${duration}`);

      if (behavior.status === "fail" && behavior.error) {
        console.log(`         Error: ${behavior.error.slice(0, 200)}`);
      }
      if (behavior.status === "dependency_failed") {
        console.log(`         Skipped: dependency "${behavior.failedDependency}" failed`);
      }
    }

    console.log("\n" + "-".repeat(60));
    console.log(`  Passed:            ${summary.passed}`);
    console.log(`  Failed:            ${summary.failed}`);
    console.log(`  Dependency failed: ${summary.dependency_failed}`);
    console.log(`  Total:             ${summary.total}`);
    console.log(`  Reward:            ${summary.reward.toFixed(2)} (${(summary.reward * 100).toFixed(1)}%)`);
    console.log(`  Duration:          ${(summary.duration / 1000).toFixed(1)}s`);
    console.log("-".repeat(60));

    process.exit(summary.reward === 1 ? 0 : 1);
  } catch (err) {
    console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    await runner.close();
  }
}

main();
