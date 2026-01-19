/**
 * Manual Spec Test Runner
 *
 * Run this script to test the spec-test library against a real running application.
 *
 * Usage:
 *   bun src/spec-test/tests/run-spec.ts [spec-file] [example-name]
 *
 * Environment Variables:
 *   BASE_URL     - Application URL (default: http://localhost:8080)
 *   CACHE_DIR    - Enable caching with specified directory (10-100x faster on subsequent runs)
 *   CLEAR_CACHE  - Set to "true" to clear cache before running
 *
 * Examples:
 *   bun src/spec-test/tests/run-spec.ts                                          # Run sample spec
 *   bun src/spec-test/tests/run-spec.ts docs/specs/login.md                      # Run all examples
 *   bun src/spec-test/tests/run-spec.ts docs/specs/login.md "Login with email"   # Run specific example
 *
 *   # With caching (10-100x faster on subsequent runs):
 *   CACHE_DIR=./cache bun src/spec-test/tests/run-spec.ts docs/specs/login.md
 *
 *   # Clear cache and re-run:
 *   CLEAR_CACHE=true CACHE_DIR=./cache bun src/spec-test/tests/run-spec.ts docs/specs/login.md
 *
 * Requirements:
 *   - App running on http://localhost:8080 (or set BASE_URL env)
 *   - OPENAI_API_KEY set for semantic checks
 */

import { SpecTestRunner, parseSpecFile } from "../index";
import path from "path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const SPEC_FILE = process.argv[2] ?? path.join(__dirname, "fixtures", "login-spec.md");
const EXAMPLE_NAME = process.argv[3]; // Optional: run specific example
const CACHE_DIR = process.env.CACHE_DIR;
const CLEAR_CACHE = process.env.CLEAR_CACHE === "true";

async function main() {
  console.log("=".repeat(60));
  console.log("Spec Test Runner");
  console.log("=".repeat(60));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Spec file: ${SPEC_FILE}`);
  if (EXAMPLE_NAME) {
    console.log(`Example: ${EXAMPLE_NAME}`);
  }
  if (CACHE_DIR) {
    console.log(`Cache: ${CACHE_DIR}${CLEAR_CACHE ? " (will be cleared)" : ""}`);
  }
  console.log();

  // Parse the spec file first to show what we're testing
  const spec = await parseSpecFile(SPEC_FILE);
  console.log(`Behavior: ${spec.name}`);
  if (spec.directory) {
    console.log(`Directory: ${spec.directory}`);
  }
  console.log(`Examples: ${spec.examples.length}`);
  console.log();

  // Show all examples and their steps
  spec.examples.forEach((example, exampleIndex) => {
    const willRun = !EXAMPLE_NAME || example.name === EXAMPLE_NAME;
    const marker = willRun ? ">>>" : "   ";
    console.log(`${marker} Example ${exampleIndex + 1}: ${example.name}`);

    example.steps.forEach((step, i) => {
      const prefix = step.type === "act" ? "->" : "ok";
      const checkType = step.checkType ? ` [${step.checkType}]` : "";
      console.log(`      ${i + 1}. ${prefix} ${step.type.toUpperCase()}: ${step.instruction}${checkType}`);
    });
    console.log();
  });

  // Create runner with caching support
  const runner = new SpecTestRunner({
    baseUrl: BASE_URL,
    headless: false, // Show browser for debugging
    cacheDir: CACHE_DIR,
  });

  // Clear cache if requested
  if (CLEAR_CACHE && CACHE_DIR) {
    console.log("Clearing cache...");
    runner.clearCache();
    console.log("Cache cleared.");
    console.log();
  }

  try {
    console.log("Starting browser...");
    if (CACHE_DIR) {
      console.log("(Using cached actions if available - first run will be slower)");
    }
    console.log();

    const result = await runner.runFromSpec(spec, EXAMPLE_NAME);

    console.log();
    console.log("=".repeat(60));
    console.log(result.success ? "PASSED" : "FAILED");
    console.log("=".repeat(60));
    console.log(`Total Duration: ${result.duration}ms`);
    console.log(`Examples Run: ${result.exampleResults.length}`);
    console.log();

    // Show results for each example
    result.exampleResults.forEach((exampleResult, exampleIndex) => {
      const status = exampleResult.success ? "[PASS]" : "[FAIL]";
      console.log(`${status} Example ${exampleIndex + 1}: ${exampleResult.example.name}`);
      console.log(`  Duration: ${exampleResult.duration}ms`);

      // Show step results
      exampleResult.steps.forEach((stepResult, i) => {
        const stepStatus = stepResult.success ? "+" : "x";
        const type = stepResult.step.type.toUpperCase();
        console.log(`  ${stepStatus} Step ${i + 1} (${type}): ${stepResult.step.instruction}`);

        if (stepResult.actResult && !stepResult.actResult.success) {
          console.log(`    Error: ${stepResult.actResult.error}`);
        }
        if (stepResult.checkResult && !stepResult.checkResult.passed) {
          console.log(`    Expected: ${stepResult.checkResult.expected}`);
          console.log(`    Actual: ${stepResult.checkResult.actual}`);
          if (stepResult.checkResult.reasoning) {
            console.log(`    Reasoning: ${stepResult.checkResult.reasoning}`);
          }
        }
      });

      // Show failure context if failed
      if (exampleResult.failedAt) {
        console.log();
        console.log("  Failure Context:");
        console.log(`    Step: ${exampleResult.failedAt.stepIndex + 1}`);
        console.log(`    URL: ${exampleResult.failedAt.context.pageUrl}`);
        console.log(`    Error: ${exampleResult.failedAt.context.error}`);
        console.log();
        console.log("    Suggestions:");
        exampleResult.failedAt.context.suggestions.forEach(s => {
          console.log(`      - ${s}`);
        });
        console.log();
        console.log("    Available Elements:");
        exampleResult.failedAt.context.availableElements.slice(0, 10).forEach(el => {
          console.log(`      - ${el.type}: ${el.text || el.selector}`);
        });
      }

      console.log();
    });

    // Summary
    const passed = result.exampleResults.filter(r => r.success).length;
    const failed = result.exampleResults.filter(r => !r.success).length;
    console.log("=".repeat(60));
    console.log(`Summary: ${passed} passed, ${failed} failed`);
    if (CACHE_DIR) {
      console.log(`Cache: ${CACHE_DIR} (subsequent runs will be faster)`);
    }
    console.log("=".repeat(60));

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error("Runner error:", error);
    process.exit(1);
  } finally {
    await runner.close();
  }
}

main();
