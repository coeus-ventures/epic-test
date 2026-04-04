// ============================================================================
// BARREL RE-EXPORTS — shared public API
// ============================================================================

// --- Types ---
export type {
  SpecStep,
  SpecExample,
  BehaviorDependency,
  ChainStep,
  HarborBehavior,
  BehaviorContext,
  VerificationSummary,
  ActResult,
  CheckResult,
  FailureContext,
  StepResult,
  ExampleResult,
  ActContext,
  ActEvalResult,
  BehaviorRunner,
} from "./types";

// --- Credential Tracker ---
export { CredentialTracker, processStepsWithCredentials } from "./credential-tracker";

// --- Dependency Chain ---
export { buildDependencyChain } from "./dependency-chain";

// --- Verification Context ---
export { VerificationContext } from "./verification-context";

// --- Summary ---
export { calculateReward, aggregateResults, generateSummary, createVerificationSummary } from "./summary";

// --- Session Management ---
export { detectPort, resetSession, navigateToPagePath, clearFormFields, urlsMatch, isSignInRedirect, recoverAuth, safeWaitForLoadState } from "./session-management";

// --- Auth Orchestrator ---
export { isAuthBehavior, runAuthBehaviorsSequence, withTimeout, DEFAULT_BEHAVIOR_TIMEOUT_MS } from "./auth-orchestrator";

// --- Base Runner ---
export { BaseStagehandRunner } from "./base-runner";
export type { BaseRunnerConfig } from "./base-runner";

// --- Parsing (re-exported from spec-test — depends on classify which is spec-test-specific) ---
export { parseSteps, parseExamples, parseHarborBehaviorsWithDependencies, parseSpecFile } from "../spec-test/parsing";
