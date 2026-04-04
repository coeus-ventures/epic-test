#!/usr/bin/env bun
/**
 * Verification script for customer-feedback-app fixture.
 *
 * Usage:
 *   1. Start the app:  cd test-fixtures/customer-feedback-app && npm run dev
 *   2. Run verifier:   bun run src/spec-test/tests/verify-customer-feedback.ts
 */

import { SpecTestRunner, verifyAllBehaviors } from "../index";
import { resolveFixturePath, saveVerificationResults } from "../../shared/verify-utils";

const INSTRUCTION_PATH = resolveFixturePath("customer-feedback-app");
const BASE_URL = "http://localhost:3000";
const BEHAVIOR_TIMEOUT_MS = 120_000;

async function main() {
  console.log("Customer Feedback App — Spec-Test Verification");
  console.log(`Base URL:    ${BASE_URL}`);
  console.log(`Instruction: ${INSTRUCTION_PATH}`);
  console.log(`Timeout:     ${BEHAVIOR_TIMEOUT_MS / 1000}s per behavior\n`);

  const runner = new SpecTestRunner({ baseUrl: BASE_URL, headless: true });

  try {
    const summary = await verifyAllBehaviors(INSTRUCTION_PATH, runner, BEHAVIOR_TIMEOUT_MS);
    saveVerificationResults(summary, "spec", "customer-feedback");
    process.exit(summary.reward === 1 ? 0 : 1);
  } catch (err) {
    console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    await runner.close();
  }
}

main();
