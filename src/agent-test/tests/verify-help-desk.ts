#!/usr/bin/env bun
/**
 * Agent-based verification script for help-desk-app fixture.
 *
 * Usage:
 *   1. Start the app:  cd test-fixtures/help-desk-app && npm run dev
 *   2. Run verifier:   bun run src/agent-test/tests/verify-help-desk.ts
 */

import { AgentTestRunner, DEFAULT_MAX_STEPS, verifyAllBehaviorsContinuous } from "../index";
import { resolveFixturePath, saveVerificationResults } from "../../shared/verify-utils";

const INSTRUCTION_PATH = resolveFixturePath("help-desk-app");
const BASE_URL = "http://localhost:3000";
const BEHAVIOR_TIMEOUT_MS = 300_000;

async function main() {
  console.log("Help Desk App — Agent-Test Verification");
  console.log(`Base URL:    ${BASE_URL}`);
  console.log(`Instruction: ${INSTRUCTION_PATH}`);
  console.log(`Timeout:     ${BEHAVIOR_TIMEOUT_MS / 1000}s per behavior`);
  console.log(`Max Steps:   ${DEFAULT_MAX_STEPS}\n`);

  const runner = new AgentTestRunner({
    baseUrl: BASE_URL,
    headless: true,
    agentMode: "dom",
    agentModel: "openai/gpt-4o",
    maxSteps: DEFAULT_MAX_STEPS,
    stagehandOptions: { model: "openai/gpt-4o" },
  });

  try {
    const summary = await verifyAllBehaviorsContinuous(INSTRUCTION_PATH, runner, BEHAVIOR_TIMEOUT_MS);
    saveVerificationResults(summary, "agent", "help-desk");
    process.exit(summary.reward === 1 ? 0 : 1);
  } catch (err) {
    console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    await runner.close();
  }
}

main();
