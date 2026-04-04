import type { VerificationSummary } from "../shared/types";

/**
 * Configuration for a Claude browser tool variant.
 * Each variant specifies how Claude interacts with the browser.
 */
export interface ClaudeVariantConfig {
  /** Display name: "claude-mcp" | "claude-agent-browser" | "claude-playwright-cli" */
  name: string;
  /** Value for --allowedTools flag */
  allowedTools: string;
  /** Path to MCP config JSON (MCP variant only) */
  mcpConfigPath?: string;
  /** npm install command for the browser tool (null if pre-installed) */
  installCommand?: string;
  /** Commands to run during setup (e.g., write MCP config to disk) */
  setupCommands?: string[];
  /** Browser tool documentation appended to system prompt */
  toolPrompt: string;
}

/**
 * Credentials extracted from instruction.md behaviors.
 */
export interface CredentialContext {
  /** Short run ID for email uniquification (e.g., "a3f7") */
  runId: string;
  /** Original signup email from instruction */
  signupEmail: string;
  /** Uniquified signup email (e.g., "alice_a3f7@blog.com") */
  signupEmailUnique: string;
  /** Signup password (extracted or default "password123") */
  signupPassword: string;
  /** Pre-seeded signin email (from valid Sign In scenario) */
  signinEmail: string;
  /** Pre-seeded signin password */
  signinPassword: string;
  /** Invalid email for negative test scenario */
  invalidEmail: string;
  /** Invalid password for negative test scenario */
  invalidPassword: string;
}

/**
 * Options for runClaudeVerifier.
 */
export interface ClaudeVerifierOptions {
  /** Max conversation turns (default: 200) */
  maxTurns?: number;
  /** Max budget in USD (default: 5) */
  maxBudgetUsd?: number;
  /** Timeout in seconds (default: 3600) */
  timeoutSec?: number;
}

export type { VerificationSummary };
