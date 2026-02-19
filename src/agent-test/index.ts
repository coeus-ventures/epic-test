// ============================================================================
// BARREL RE-EXPORTS — agent-test public API
// ============================================================================

// --- Types ---
export type {
  AgentTestConfig,
  AgentExecutionResult,
  CheckVerification,
} from "./types";
export { DEFAULT_MAX_STEPS, CLOSE_TIMEOUT_MS } from "./types";

// --- Runner ---
export { AgentTestRunner } from "./runner";

// --- Goal Builder ---
export { buildGoalPrompt } from "./goal-builder";

// --- Verifier ---
export { verifyOutcome } from "./verifier";

// --- Continuous Orchestrator ---
export {
  verifyAllBehaviorsContinuous,
  topologicalSort,
  partitionBehaviors,
  buildTransitiveDependentsMap,
} from "./continuous-orchestrator";

// --- Re-exports from spec-test (orchestration layer) ---
export { verifyAllBehaviors } from "../spec-test/orchestrator";
