#!/usr/bin/env bun
/**
 * Claude-based verification script for customer-feedback-app fixture.
 *
 * Usage:
 *   1. Start the app:  cd test-fixtures/customer-feedback-app && npm run dev
 *   2. Run verifier:   bun run src/claude-test/tests/verify-customer-feedback.ts [variant]
 *
 * Variants: mcp (default), agent-browser, playwright-cli
 */

import { runClaudeVerifier } from "../index";
import { mcp, agentBrowser, playwrightCli } from "../variants/index";
import { resolveFixturePath, saveVerificationResults } from "../../shared/verify-utils";
import type { ClaudeVariantConfig } from "../types";

const VARIANTS: Record<string, ClaudeVariantConfig> = {
  mcp, "agent-browser": agentBrowser, "playwright-cli": playwrightCli,
};

const variantName = process.argv[2] ?? "mcp";
const variant = VARIANTS[variantName];
if (!variant) {
  console.error(`Unknown variant: ${variantName}. Valid: ${Object.keys(VARIANTS).join(", ")}`);
  process.exit(1);
}

const INSTRUCTION_PATH = resolveFixturePath("customer-feedback-app");

async function main() {
  console.log("Customer Feedback App — Claude-Test Verification");
  console.log(`Instruction: ${INSTRUCTION_PATH}`);
  console.log(`Variant:     ${variant.name}\n`);

  try {
    const summary = await runClaudeVerifier(INSTRUCTION_PATH, variant, { verbose: true });
    saveVerificationResults(summary, "claude", "customer-feedback");
    process.exit(summary.reward === 1 ? 0 : 1);
  } catch (err) {
    console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
