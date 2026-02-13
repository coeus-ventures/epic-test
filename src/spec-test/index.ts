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
export { isNavigationAction, isRefreshAction, isSaveAction, isModalTriggerAction, isModalDismissAction, extractExpectedText, extractSelectAction } from "./step-execution";
export { getEnhancedErrorContext, getCheckErrorContext, MAX_RETRIES, RETRY_DELAY } from "./step-execution";

// --- Form Filler ---
export { fillEmptyRequiredFields, generateFillValue } from "./form-filler";
export type { FormField } from "./form-filler";

// --- Session Management ---
export { detectPort, resetSession, navigateToPagePath, clearFormFields, urlsMatch, isSignInRedirect, recoverAuth } from "./session-management";

// --- Act Helpers ---
export { delay, isRetryableError, executePageAction, executeActWithRetry, executeSelectAction, trySelectFallback, tryDismissModalAndRetry, waitForFormDismissal, waitForModalAppearance, waitForModalDismissal } from "./act-helpers";

// --- Check Helpers ---
export { EXTRACT_EVALUATION_PROMPT, doubleCheckWithExtract, tryDeterministicCheck, executeCheckWithRetry } from "./check-helpers";

// --- Modal Handler ---
export { detectModalInDOM, autoConfirmModal, dismissLeftoverModal, shouldAutoConfirmModal } from "./modal-handler";
export type { ModalDetection } from "./modal-handler";

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
