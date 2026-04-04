/**
 * Claude-based verifier runner.
 *
 * Orchestrates: parse instruction → build plan → write files →
 * exec `claude --print` → parse results CSV → output reward + results.
 *
 * Ported from verifier-bench/verifiers/claude_base.py.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { parseHarborBehaviorsWithDependencies } from "../shared/index";
import { buildPlanFromBehaviors } from "./plan-builder";
import type { ClaudeVariantConfig, ClaudeVerifierOptions, VerificationSummary } from "./types";
import type { BehaviorContext } from "../shared/types";

const SYSTEM_PROMPT_PATH = "/tmp/system-prompt.md";
const VERIFICATION_PLAN_PATH = "/tmp/verification-plan.md";
const USER_PROMPT_PATH = "/tmp/prompt.txt";
const RESULTS_CSV_PATH = "/logs/agent/results.csv";
const OUTPUT_DIR = "/logs/verifier";

const DEFAULT_MAX_TURNS = 200;
const DEFAULT_MAX_BUDGET_USD = 5;
const DEFAULT_TIMEOUT_SEC = 3600;

// ─── System Prompt ───────────────────────────────────────────────────

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

// ─── File Writing (base64 to avoid shell escaping) ───────────────────

function writeToFile(path: string, content: string): void {
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, "utf-8");
}

// ─── Setup ───────────────────────────────────────────────────────────

function ensureClaudeCli(): void {
  try {
    execSync("which claude", { stdio: "ignore" });
  } catch {
    console.log("Claude CLI not found, installing...");
    execSync("curl -fsSL https://claude.ai/install.sh | sh", {
      stdio: "inherit",
    });
  }
}

function bypassOnboarding(): void {
  try {
    execSync('mkdir -p ~/.claude');
    writeFileSync(
      `${process.env.HOME || "/root"}/.claude.json`,
      JSON.stringify({ hasCompletedOnboarding: true }),
    );
  } catch {
    // Best effort
  }
}

function ensureAuth(): Record<string, string> {
  const env: Record<string, string> = {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;

  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;

  if (Object.keys(env).length === 0) {
    throw new Error(
      "No Claude authentication found. " +
      "Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN.",
    );
  }

  return env;
}

// ─── Command Building ────────────────────────────────────────────────

function buildClaudeCommand(
  config: ClaudeVariantConfig,
  options: Required<ClaudeVerifierOptions>,
): string {
  const parts = ["claude", "--print"];

  if (config.mcpConfigPath) {
    parts.push(`--mcp-config ${config.mcpConfigPath}`);
  }

  if (config.allowedTools) {
    parts.push(`--allowedTools ${config.allowedTools}`);
  }

  parts.push(`--append-system-prompt-file ${SYSTEM_PROMPT_PATH}`);
  parts.push(`--max-turns ${options.maxTurns}`);
  parts.push(`--max-budget-usd ${options.maxBudgetUsd}`);
  parts.push(`< ${USER_PROMPT_PATH}`);

  return parts.join(" ");
}

// ─── CSV Parsing ─────────────────────────────────────────────────────

interface CsvRow {
  behaviorId: string;
  result: "pass" | "fail";
  reason: string;
}

function parseResultsCsv(csvPath: string): CsvRow[] {
  if (!existsSync(csvPath)) return [];

  const content = readFileSync(csvPath, "utf-8").trim();
  const lines = content.split("\n").filter((l) => l.trim());

  // Skip header
  const dataLines = lines[0]?.toLowerCase().includes("behavior_id")
    ? lines.slice(1)
    : lines;

  return dataLines.map((line) => {
    // Handle CSV with quoted fields
    const match = line.match(/^([^,]+),\s*(pass|fail)\s*,\s*"?([^"]*)"?\s*$/i);
    if (match) {
      return {
        behaviorId: match[1].trim(),
        result: match[2].trim().toLowerCase() as "pass" | "fail",
        reason: match[3].trim(),
      };
    }
    // Fallback: simple split
    const parts = line.split(",").map((p) => p.trim());
    return {
      behaviorId: parts[0] ?? "unknown",
      result: (parts[1]?.toLowerCase() === "pass" ? "pass" : "fail") as "pass" | "fail",
      reason: parts.slice(2).join(",").replace(/^"|"$/g, "").trim(),
    };
  });
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
    passed,
    failed,
    dependency_failed: depFailed,
    total,
    reward,
    summary: `${passed}/${total} behaviors passed`,
    behaviors,
    duration,
  };
}

// ─── Main Entry Point ────────────────────────────────────────────────

/**
 * Run a Claude-based verifier against a Harbor task.
 *
 * @param instructionPath - Path to instruction.md inside the container
 * @param config - Variant configuration (mcp, agent-browser, or playwright-cli)
 * @param options - Optional overrides for turns, budget, timeout
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
  };

  const startTime = Date.now();

  // 1. Setup
  console.log(`Setting up ${config.name} verifier...`);
  ensureClaudeCli();
  bypassOnboarding();
  const claudeEnv = ensureAuth();

  // Install variant tool if needed
  if (config.installCommand) {
    console.log(`Installing browser tool: ${config.installCommand}`);
    execSync(config.installCommand, { stdio: "inherit", timeout: 120_000 });
  }

  // Run setup commands (e.g., write MCP config)
  if (config.setupCommands) {
    for (const cmd of config.setupCommands) {
      execSync(cmd, { stdio: "inherit" });
    }
  }

  // 2. Parse instruction and build plan
  console.log("Parsing instruction.md and building verification plan...");
  const instructionContent = readFileSync(instructionPath, "utf-8");
  const behaviorsMap = parseHarborBehaviorsWithDependencies(instructionContent);
  const behaviors = Array.from(behaviorsMap.values());
  const { plan, credCtx } = buildPlanFromBehaviors(behaviors);

  const allBehaviorIds = behaviors.map((b) => b.id);

  // 3. Write files
  const systemPrompt = buildSystemPrompt(config.toolPrompt);
  writeToFile(SYSTEM_PROMPT_PATH, systemPrompt);
  writeToFile(VERIFICATION_PLAN_PATH, plan);
  writeToFile(USER_PROMPT_PATH,
    "Read the verification plan at /tmp/verification-plan.md " +
    "and verify each behavior in order.\n\n" +
    "The app is running at http://localhost:3000.\n\n" +
    "Write results to /logs/agent/results.csv when done.",
  );

  // 4. Build and execute claude command
  mkdirSync("/logs/agent", { recursive: true });
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
    console.log(`Claude command exited with error: ${err instanceof Error ? err.message : err}`);
    // Non-fatal — Claude may have written results before erroring
  }

  // 5. Parse results
  const duration = Date.now() - startTime;
  const rows = parseResultsCsv(RESULTS_CSV_PATH);
  const summary = csvToSummary(rows, allBehaviorIds, duration);

  if (credCtx) {
    console.log(`Signup email used: ${credCtx.signupEmailUnique}`);
  }

  return summary;
}
