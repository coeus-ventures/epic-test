// ============================================================================
// AGENT TEST TYPES — configuration and result types for agent-based testing
// ============================================================================

import type { SpecTestConfig } from "../spec-test";
import type { AgentToolMode, AgentAction } from "@browserbasehq/stagehand";

/** Default max steps per agent.execute() call */
export const DEFAULT_MAX_STEPS = 30;

/** Timeout for browser close operations (ms) */
export const CLOSE_TIMEOUT_MS = 10_000;

/**
 * Configuration for AgentTestRunner.
 * Extends SpecTestConfig with agent-specific options.
 */
export interface AgentTestConfig extends SpecTestConfig {
  /** Agent mode (default: "cua" — Computer Use API) */
  agentMode?: AgentToolMode;
  /** Max steps per agent.execute() call (default: DEFAULT_MAX_STEPS) */
  maxSteps?: number;
  /** Stagehand agent model identifier override */
  agentModel?: string;
  /** Custom system prompt prepended to every agent.execute() call */
  agentSystemPrompt?: string;
}

/**
 * Result from a single agent.execute() call.
 */
export interface AgentExecutionResult {
  /** Whether the agent reported success */
  success: boolean;
  /** Human-readable message from the agent */
  message: string;
  /** Actions the agent took */
  actions: AgentAction[];
  /** Whether the agent completed the full task */
  completed: boolean;
}

/**
 * Result of verifying a single check criterion after agent execution.
 */
export interface CheckVerification {
  /** The check instruction from the spec */
  instruction: string;
  /** Whether the check passed */
  passed: boolean;
  /** What was actually found on the page */
  actual: string;
  /** LLM reasoning for the verification decision */
  reasoning?: string;
}
