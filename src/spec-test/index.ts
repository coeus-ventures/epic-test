// ============================================================================
// BARREL RE-EXPORTS — spec-test public API
// ============================================================================

// --- Types ---
export type {
  SpecTestConfig,
  TestableSpec,
  SpecExample,
  SpecStep,
  SpecTestResult,
  ExampleResult,
  StepResult,
  ActResult,
  CheckResult,
  FailureContext,
  StepContext,
  BehaviorContext,
  BehaviorDependency,
  BehaviorRunner,
  ChainStep,
  VerificationSummary,
} from "./types";

// --- Classify ---
export { classifyCheck, DETERMINISTIC_PATTERNS } from "./classify";

// --- Parsing ---
export { parseSteps, parseExamples, parseHarborBehaviorsWithDependencies, parseSpecFile } from "./parsing";

// --- Step Execution ---
export { executeActStep, executeCheckStep, generateFailureContext } from "./step-execution";
export { isNavigationAction, isRefreshAction, extractExpectedText, extractNavigationTarget } from "./step-execution";
export { getEnhancedErrorContext, getCheckErrorContext, MAX_RETRIES, RETRY_DELAY } from "./step-execution";

// --- Verification Context ---
export { VerificationContext } from "./verification-context";

// --- Credential Tracker ---
export { CredentialTracker, processStepsWithCredentials } from "./credential-tracker";

// --- Dependency Chain ---
export { buildDependencyChain } from "./dependency-chain";

// --- Summary ---
export { calculateReward, aggregateResults, generateSummary, createVerificationSummary } from "./summary";

// --- Verification Runner ---
export { verifyBehaviorWithDependencies } from "./verification-runner";

// --- Auth Orchestrator ---
export { isAuthBehavior, runAuthBehaviorsSequence, withTimeout, DEFAULT_BEHAVIOR_TIMEOUT_MS } from "./auth-orchestrator";

// --- Orchestrator ---
export { verifyAllBehaviors } from "./orchestrator";

// --- Runner ---
export { SpecTestRunner } from "./runner";
