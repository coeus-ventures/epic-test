// ============================================================================
// SHARED TYPES — cross-cutting type definitions used by all modules
// ============================================================================

/**
 * A single step in a specification
 */
export interface SpecStep {
  /** Step type: Act for actions, Check for verifications, Await for async operations */
  type: "Act" | "Check" | "Await";
  /** Natural language instruction */
  instruction: string;
  /** For checks: deterministic or semantic */
  checkType?: "deterministic" | "semantic";
  /** Original line number in spec file (for error reporting) */
  lineNumber?: number;
}

/**
 * A named example within a behavior specification
 */
export interface SpecExample {
  /** Example name (e.g., "Execute login behavior") */
  name: string;
  /** Steps to execute for this example */
  steps: SpecStep[];
}

/**
 * A dependency reference with optional scenario targeting.
 * When scenarioName is provided, the chain executor runs that specific
 * scenario instead of defaulting to examples[0].
 */
export interface BehaviorDependency {
  /** Slugified behavior ID (e.g., "sign-up") */
  behaviorId: string;
  /** Scenario name to run (e.g., "User creates a new account") */
  scenarioName?: string;
}

/**
 * A single step in the dependency chain with scenario info.
 */
export interface ChainStep {
  /** The behavior to execute */
  behavior: HarborBehavior;
  /** Scenario name to execute, if specified by the dependent behavior */
  scenarioName?: string;
}

/**
 * A complete behavior definition with dependencies (Harbor format)
 */
export interface HarborBehavior {
  /** Unique identifier (slugified title) */
  id: string;
  /** Display title */
  title: string;
  /** Behavior description */
  description?: string;
  /** Dependencies with optional scenario targeting */
  dependencies: BehaviorDependency[];
  /** Examples/scenarios with steps */
  examples: SpecExample[];
  /** Page path where this behavior lives (e.g., "/candidates") */
  pagePath?: string;
}

/**
 * Context for a single behavior verification result.
 * Used by VerificationContext to track pass/fail status.
 */
export interface BehaviorContext {
  /** Unique behavior ID (slugified title) */
  behaviorId: string;
  /** Display name of the behavior */
  behaviorName: string;
  /** Verification status */
  status: 'pass' | 'fail' | 'dependency_failed';
  /** Which dependency caused a skip (if status is dependency_failed) */
  failedDependency?: string;
  /** Error message if failed */
  error?: string;
  /** Execution duration in milliseconds */
  duration: number;
}

/**
 * Aggregated verification results for a set of behaviors.
 * Used to summarize overall verification status.
 */
export interface VerificationSummary {
  /** Number of behaviors that passed */
  passed: number;
  /** Number of behaviors that failed their own tests */
  failed: number;
  /** Number of behaviors skipped due to failed dependencies */
  dependency_failed: number;
  /** Total number of behaviors tested */
  total: number;
  /** Reward score (passed / total) */
  reward: number;
  /** Human-readable summary */
  summary: string;
  /** Individual behavior results */
  behaviors: BehaviorContext[];
  /** Total duration in milliseconds */
  duration: number;
}

/**
 * Result of executing an Act step
 */
export interface ActResult {
  /** Whether action succeeded */
  success: boolean;
  /** Execution duration in ms */
  duration: number;
  /** Current page URL after action */
  pageUrl?: string;
  /** Error message if failed */
  error?: string;
  /** Page snapshot if failed (for debugging) */
  pageSnapshot?: string;
  /** Available actions on page if failed (for suggestions) */
  availableActions?: string[];
}

/**
 * Result of executing a Check step
 */
export interface CheckResult {
  /** Whether check passed */
  passed: boolean;
  /** Type of check that was performed */
  checkType: "deterministic" | "semantic";
  /** Expected condition (from instruction) */
  expected: string;
  /** Actual value found */
  actual: string;
  /** LLM reasoning for semantic checks */
  reasoning?: string;
  /** Suggestion for fixing if failed */
  suggestion?: string;
}

/**
 * Rich context for debugging failures
 */
export interface FailureContext {
  /** Full page HTML snapshot */
  pageSnapshot: string;
  /** Current page URL */
  pageUrl: string;
  /** The step that failed */
  failedStep: SpecStep;
  /** Error message */
  error: string;
  /** Interactive elements available on page */
  availableElements: Array<{
    type: string;
    text?: string;
    selector: string;
    attributes?: Record<string, string>;
  }>;
  /** AI-generated suggestions for resolving the failure */
  suggestions: string[];
}

/**
 * Result of executing a single step
 */
export interface StepResult {
  /** Step that was executed */
  step: SpecStep;
  /** Whether step succeeded */
  success: boolean;
  /** Execution duration in ms */
  duration: number;
  /** For act steps */
  actResult?: ActResult;
  /** For check steps */
  checkResult?: CheckResult;
}

/**
 * Result of running a single example
 */
export interface ExampleResult {
  /** Example that was executed */
  example: SpecExample;
  /** Overall success status */
  success: boolean;
  /** Results for each step */
  steps: StepResult[];
  /** Execution duration in ms */
  duration: number;
  /** Details about failure if success is false */
  failedAt?: {
    stepIndex: number;
    step: SpecStep;
    context: FailureContext;
  };
}

/**
 * Context threaded through each iteration of the adaptive act loop.
 * Carries goal intent, last concrete action taken, and accumulated history
 * so the evaluator can make an informed judgment at each step.
 */
export interface ActContext {
  /** Original spec step instruction (the goal) */
  goal: string;
  /** Concrete action executed in the last iteration (null on first) */
  lastAct: string | null;
  /** Current iteration count (0-based) */
  iteration: number;
  /** History of all previous iterations in this loop */
  history: Array<{ act: string; outcome: string }>;
  /** Hint from previous evaluator to guide next pre-act observe */
  nextContext?: string;
}

/**
 * Result returned by evaluateActResult() after each act iteration.
 * Drives the loop decision: continue, stop, or surface an error.
 */
export interface ActEvalResult {
  /** complete = goal achieved; incomplete = intermediate state; failed = no progress */
  status: "complete" | "incomplete" | "failed";
  /** Human-readable explanation of the judgment */
  reason: string;
  /** For incomplete: what the next observe query should focus on */
  nextContext?: string;
}

/** Interface for runner objects used by orchestrators. */
export interface BehaviorRunner {
  runExample(example: SpecExample, options?: {
    clearSession?: boolean;
    navigateToPath?: string;
    /** Credentials for auth recovery if navigation causes session loss. */
    credentials?: { email: string | null; password: string | null };
    /** Reload the page before running steps (cleans dirty form state). */
    reloadPage?: boolean;
  }): Promise<ExampleResult>;
}
