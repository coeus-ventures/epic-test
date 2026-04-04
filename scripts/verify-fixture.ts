#!/usr/bin/env bun
/**
 * Unified fixture verification runner.
 *
 * Usage:
 *   bun run scripts/verify-fixture.ts --tester spec --app help-desk
 *   bun run scripts/verify-fixture.ts --tester agent --app customer-feedback
 *   bun run scripts/verify-fixture.ts --tester claude --app help-desk
 *   bun run scripts/verify-fixture.ts --app help-desk          # all testers
 *   bun run scripts/verify-fixture.ts --all                     # all testers × all apps
 *
 * Requires the fixture app running on http://localhost:3000 before execution.
 */

import { execSync } from "child_process";
import path from "path";

const TESTERS = ["spec", "agent", "claude"] as const;
const APPS = ["help-desk", "customer-feedback"] as const;

type Tester = typeof TESTERS[number];
type App = typeof APPS[number];

const SCRIPT_MAP: Record<Tester, Record<App, string>> = {
  spec: {
    "help-desk": "src/spec-test/tests/verify-help-desk.ts",
    "customer-feedback": "src/spec-test/tests/verify-customer-feedback.ts",
  },
  agent: {
    "help-desk": "src/agent-test/tests/verify-help-desk.ts",
    "customer-feedback": "src/agent-test/tests/verify-customer-feedback.ts",
  },
  claude: {
    "help-desk": "src/claude-test/tests/verify-help-desk.ts",
    "customer-feedback": "src/claude-test/tests/verify-customer-feedback.ts",
  },
};

function parseArgs(): { testers: Tester[]; apps: App[] } {
  const args = process.argv.slice(2);

  if (args.includes("--all")) {
    return { testers: [...TESTERS], apps: [...APPS] };
  }

  const testerIdx = args.indexOf("--tester");
  const appIdx = args.indexOf("--app");

  const testers: Tester[] = testerIdx >= 0 && args[testerIdx + 1]
    ? [args[testerIdx + 1] as Tester]
    : [...TESTERS];

  const apps: App[] = appIdx >= 0 && args[appIdx + 1]
    ? [args[appIdx + 1] as App]
    : [...APPS];

  for (const t of testers) {
    if (!TESTERS.includes(t)) {
      console.error(`Unknown tester: ${t}. Valid: ${TESTERS.join(", ")}`);
      process.exit(1);
    }
  }
  for (const a of apps) {
    if (!APPS.includes(a)) {
      console.error(`Unknown app: ${a}. Valid: ${APPS.join(", ")}`);
      process.exit(1);
    }
  }

  return { testers, apps };
}

function run(tester: Tester, app: App): boolean {
  const script = SCRIPT_MAP[tester][app];
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Running: ${tester} × ${app}`);
  console.log(`Script:  ${script}`);
  console.log("=".repeat(60));

  try {
    execSync(`bun run ${script}`, { stdio: "inherit", cwd: path.resolve(import.meta.dir, "..") });
    return true;
  } catch {
    return false;
  }
}

const { testers, apps } = parseArgs();
const results: Array<{ tester: Tester; app: App; passed: boolean }> = [];

for (const app of apps) {
  for (const tester of testers) {
    const passed = run(tester, app);
    results.push({ tester, app, passed });
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log("Summary");
console.log("=".repeat(60));

for (const r of results) {
  console.log(`  [${r.passed ? "PASS" : "FAIL"}] ${r.tester} × ${r.app}`);
}

const allPassed = results.every((r) => r.passed);
console.log(`\n${allPassed ? "All passed" : "Some failed"}`);
process.exit(allPassed ? 0 : 1);
