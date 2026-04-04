/**
 * Claude-based verifier runner.
 *
 * Orchestrates: parse instruction → build plan → write files →
 * exec `claude --print` → parse results CSV → output reward + results.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import path from "path";
import { parseHarborBehaviorsWithDependencies } from "../shared/index";
import { buildPlanFromBehaviors } from "./plan-builder";
import type { ClaudeVariantConfig, ClaudeVerifierOptions, VerificationSummary } from "./types";
import type { BehaviorContext } from "../shared/types";

const SYSTEM_PROMPT_PATH = "/tmp/system-prompt.md";
const VERIFICATION_PLAN_PATH = "/tmp/verification-plan.md";
const USER_PROMPT_PATH = "/tmp/prompt.txt";
// Docker uses /logs/agent; local runs use a temp dir to avoid permission errors
const RESULTS_DIR = process.env.CLAUDE_VERIFIER_RESULTS_DIR ?? path.join(tmpdir(), "claude-verifier");
const RESULTS_CSV_PATH = path.join(RESULTS_DIR, "results.csv");

const DEFAULT_MAX_TURNS = 200;
const DEFAULT_MAX_BUDGET_USD = 5;
const DEFAULT_TIMEOUT_SEC = 3600;

/**
 * Run a Claude-based verifier against a Harbor task.
 */
export async function runClaudeVerifier(
  instructionPath: string,
  config: ClaudeVariantConfig,
  options?: ClaudeVerifierOptions,
): Promise<VerificationSummary> {
  const opts: Required<ClaudeVerifierOptions> = {
    maxTurns: options?.maxTurns ?? DEFAULT_MAX_TURNS,
    maxBudgetUsd: options?.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
    timeoutSec: options?.timeoutSec ?? DEFAULT_TIMEOUT_SEC,
    verbose: options?.verbose ?? false,
  };

  const startTime = Date.now();

  const claudeEnv = setupClaudeEnvironment(config);
  const { allBehaviorIds, credCtx } = buildAndWriteVerificationFiles(instructionPath, config);
  executeClaudeCommand(config, opts, claudeEnv);

  const duration = Date.now() - startTime;
  const rows = parseResultsCsv(RESULTS_CSV_PATH);
  const summary = csvToSummary(rows, allBehaviorIds, duration);

  if (credCtx) console.log(`Signup email used: ${credCtx.signupEmailUnique}`);

  return summary;
}

function setupClaudeEnvironment(config: ClaudeVariantConfig): Record<string, string> {
  console.log(`Setting up ${config.name} verifier...`);
  ensureClaudeCli();
  bypassOnboarding();
  const claudeEnv = ensureAuth();

  if (config.installCommand) {
    console.log(`Installing browser tool: ${config.installCommand}`);
    execSync(config.installCommand, { stdio: "inherit", timeout: 120_000 });
  }

  if (config.setupCommands) {
    for (const cmd of config.setupCommands) {
      execSync(cmd, { stdio: "inherit" });
    }
  }

  return claudeEnv;
}

function buildAndWriteVerificationFiles(
  instructionPath: string, config: ClaudeVariantConfig,
): { allBehaviorIds: string[]; credCtx: ReturnType<typeof buildPlanFromBehaviors>["credCtx"] } {
  console.log("Parsing instruction.md and building verification plan...");
  const instructionContent = readFileSync(instructionPath, "utf-8");
  const behaviorsMap = parseHarborBehaviorsWithDependencies(instructionContent);
  const behaviors = Array.from(behaviorsMap.values());
  const { plan, credCtx } = buildPlanFromBehaviors(behaviors);

  writeToFile(SYSTEM_PROMPT_PATH, buildSystemPrompt(config.toolPrompt));
  writeToFile(VERIFICATION_PLAN_PATH, plan);
  writeToFile(USER_PROMPT_PATH,
    `Read the verification plan at ${VERIFICATION_PLAN_PATH} ` +
    "and verify each behavior in order.\n\n" +
    "The app is running at http://localhost:3000.\n\n" +
    `Write results to ${RESULTS_CSV_PATH} when done.`,
  );

  return { allBehaviorIds: behaviors.map((b) => b.id), credCtx };
}

function executeClaudeCommand(
  config: ClaudeVariantConfig,
  opts: Required<ClaudeVerifierOptions>,
  claudeEnv: Record<string, string>,
): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const command = buildClaudeCommand(config, opts);
  console.log(`Executing: ${command}`);

  try {
    execSync(command, {
      env: { ...process.env, ...claudeEnv },
      stdio: "inherit",
      timeout: opts.timeoutSec * 1000,
      shell: "/bin/bash",
    });
  } catch (err) {
    // Non-fatal — Claude may have written results before erroring
    console.log(`Claude command exited with error: ${err instanceof Error ? err.message : err}`);
  }
}

function ensureClaudeCli(): void {
  try {
    execSync("which claude", { stdio: "ignore" });
  } catch {
    console.log("Claude CLI not found, installing...");
    execSync("curl -fsSL https://claude.ai/install.sh | sh", { stdio: "inherit" });
  }
}

function bypassOnboarding(): void {
  try {
    execSync('mkdir -p ~/.claude');
    writeFileSync(
      `${process.env.HOME || "/root"}/.claude.json`,
      JSON.stringify({ hasCompletedOnboarding: true }),
    );
  } catch { /* best effort */ }
}

function ensureAuth(): Record<string, string> {
  const env: Record<string, string> = {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;

  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;

  if (Object.keys(env).length === 0) {
    throw new Error(
      "No Claude authentication found. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN.",
    );
  }

  return env;
}

function buildSystemPrompt(toolPrompt: string): string {
  return `# Web Application Verification Agent

You are a verification agent. A pre-built web application is running at http://localhost:3000.
Your job is to verify each behavior in the verification plan and determine if it passes or fails.

## Process

1. Read the verification plan at ${VERIFICATION_PLAN_PATH}
2. For each behavior in order:
   a. Navigate to the specified page
   b. Execute the Act steps (interact with the UI)
   c. Wait when you see Await steps — they indicate the preceding action is asynchronous
   d. Check the expected outcomes
   e. Record your judgment: pass or fail, with a brief reason
3. After verifying ALL behaviors, write results to ${RESULTS_CSV_PATH}

## Important Rules

- Verify behaviors in the exact order listed in the plan
- If a page doesn't load or a UI element is missing, that behavior FAILS
- If you can't complete a dependency behavior (e.g., Sign Up fails), downstream behaviors that depend on it also FAIL
- Adapt to the actual UI — button labels and field names may differ slightly from the plan
- Be thorough but efficient — don't spend excessive time on a single behavior

## Output Format

Write this CSV file to ${RESULTS_CSV_PATH}:

\`\`\`
behavior_id,result,reason
sign-up,pass,"Account created, redirected to dashboard"
edit-post,fail,"Edit button not found on post page"
\`\`\`

## Authentication

- The app may have a pre-seeded user account. Use the credentials in the plan.
- For Sign Up, use the EXACT email shown (it has been uniquified to avoid collisions).

## Browser Tools

${toolPrompt}`;
}

function writeToFile(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

function buildClaudeCommand(
  config: ClaudeVariantConfig,
  options: Required<ClaudeVerifierOptions>,
): string {
  const mode = options.verbose ? "--verbose" : "--print";
  const parts = ["claude", mode, "--dangerously-skip-permissions"];

  if (config.mcpConfigPath) parts.push(`--mcp-config ${config.mcpConfigPath}`);
  if (config.allowedTools) parts.push(`--allowedTools ${config.allowedTools}`);

  parts.push(`--append-system-prompt-file ${SYSTEM_PROMPT_PATH}`);
  parts.push(`--max-turns ${options.maxTurns}`);
  parts.push(`--max-budget-usd ${options.maxBudgetUsd}`);
  parts.push(`< ${USER_PROMPT_PATH}`);

  return parts.join(" ");
}

interface CsvRow {
  behaviorId: string;
  result: "pass" | "fail";
  reason: string;
}

function parseResultsCsv(csvPath: string): CsvRow[] {
  if (!existsSync(csvPath)) return [];

  const content = readFileSync(csvPath, "utf-8").trim();
  const lines = content.split("\n").filter((l) => l.trim());

  const dataLines = lines[0]?.toLowerCase().includes("behavior_id")
    ? lines.slice(1)
    : lines;

  return dataLines.map(parseCsvLine);
}

function parseCsvLine(line: string): CsvRow {
  const match = line.match(/^([^,]+),\s*(pass|fail)\s*,\s*"?([^"]*)"?\s*$/i);
  if (match) {
    return {
      behaviorId: match[1].trim(),
      result: match[2].trim().toLowerCase() as "pass" | "fail",
      reason: match[3].trim(),
    };
  }
  const parts = line.split(",").map((p) => p.trim());
  return {
    behaviorId: parts[0] ?? "unknown",
    result: (parts[1]?.toLowerCase() === "pass" ? "pass" : "fail") as "pass" | "fail",
    reason: parts.slice(2).join(",").replace(/^"|"$/g, "").trim(),
  };
}

function csvToSummary(
  rows: CsvRow[],
  allBehaviorIds: string[],
  duration: number,
): VerificationSummary {
  const csvById = new Map(rows.map((r) => [r.behaviorId, r]));

  const behaviors: BehaviorContext[] = allBehaviorIds.map((id) => {
    const row = csvById.get(id);
    return {
      behaviorId: id,
      behaviorName: id,
      status: row ? row.result : "fail",
      error: row ? (row.result === "fail" ? row.reason : undefined) : "Not reported by verifier",
      duration: 0,
    } as BehaviorContext;
  });

  const passed = behaviors.filter((b) => b.status === "pass").length;
  const failed = behaviors.filter((b) => b.status === "fail").length;
  const depFailed = behaviors.filter((b) => b.status === "dependency_failed").length;
  const total = behaviors.length;
  const reward = total > 0 ? passed / total : 0;

  return {
    passed, failed, dependency_failed: depFailed, total, reward,
    summary: `${passed}/${total} behaviors passed`,
    behaviors, duration,
  };
}
