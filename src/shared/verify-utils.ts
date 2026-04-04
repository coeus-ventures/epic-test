import path from "path";
import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import type { VerificationSummary } from "./types";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..", "..");
const RESULTS_DIR = path.join(PROJECT_ROOT, "test-results");

/** Resolve path to a fixture app's instruction.md. */
export function resolveFixturePath(appName: string): string {
  return path.join(PROJECT_ROOT, "test-fixtures", appName, "instruction.md");
}

/** Save and print verification results. Returns the output file path. */
export function saveVerificationResults(
  summary: VerificationSummary, tester: string, app: string,
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${tester}_${app}_${timestamp}.json`;
  const outputPath = path.join(RESULTS_DIR, filename);

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    tester, app, timestamp: new Date().toISOString(),
    reward: summary.reward,
    passed: summary.passed,
    failed: summary.failed,
    dependency_failed: summary.dependency_failed,
    total: summary.total,
    duration: summary.duration,
    behaviors: summary.behaviors.map(b => ({
      id: b.behaviorId,
      name: b.behaviorName,
      status: b.status,
      duration: b.duration,
      error: b.error ?? null,
      failedDependency: b.failedDependency ?? null,
    })),
  }, null, 2), "utf-8");

  printVerificationResults(summary, `${tester} × ${app}`);
  console.log(`\n  Results saved to: ${outputPath}`);

  return outputPath;
}

/** Print verification results to terminal. */
export function printVerificationResults(summary: VerificationSummary, title: string): void {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));

  for (const behavior of summary.behaviors) {
    const icon = behavior.status === "pass" ? "PASS"
      : behavior.status === "fail" ? "FAIL"
      : "SKIP";

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
}
