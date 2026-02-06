import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { Tester } from "../b-test";
import type { LanguageModelV2 } from "@ai-sdk/provider";

/**
 * Configuration options for SpecTestRunner
 */
export interface SpecTestConfig {
  /** Base URL of the application under test */
  baseUrl: string;
  /** Stagehand configuration options */
  stagehandOptions?: Record<string, unknown>;
  /** B-Test AI model override (e.g., openai("gpt-4o"), anthropic("claude-3-5-sonnet")) */
  aiModel?: LanguageModelV2;
  /** Browserbase API key for cloud execution (optional) */
  browserbaseApiKey?: string;
  /** Use headless browser (default: true) */
  headless?: boolean;
  /**
   * Directory for Stagehand action cache.
   * When set, enables caching for 10-100x faster subsequent runs with zero token cost.
   * Stagehand auto-generates cache keys from instruction + URL.
   */
  cacheDir?: string;
  /**
   * Create subdirectory per spec name (default: false).
   * When true, cache path becomes: {cacheDir}/{spec-name}/
   */
  cachePerSpec?: boolean;
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
 * Parsed behavior specification ready for execution.
 *
 * Epic Specification Format:
 * - H1 = behavior name
 * - `Directory:` = optional directory path
 * - `## Examples` section contains named examples with `#### Steps`
 */
export interface TestableSpec {
  /** Behavior name from specification (H1) */
  name: string;
  /** Directory where behavior is implemented (optional) */
  directory?: string;
  /** Named examples from the Examples section */
  examples: SpecExample[];
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
 * A single step in a specification
 */
export interface SpecStep {
  /** Step type: act for actions, check for verifications */
  type: "act" | "check";
  /** Natural language instruction */
  instruction: string;
  /** For checks: deterministic or semantic */
  checkType?: "deterministic" | "semantic";
  /** Original line number in spec file (for error reporting) */
  lineNumber?: number;
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
 * Result of running a complete specification (all examples or specific one)
 */
export interface SpecTestResult {
  /** Overall success status (true if all executed examples passed) */
  success: boolean;
  /** Spec that was executed */
  spec: TestableSpec;
  /** Results for each example that was run */
  exampleResults: ExampleResult[];
  /** Total execution duration in ms */
  duration: number;
  /**
   * @deprecated Use exampleResults[n].steps instead
   * Kept for backwards compatibility with single-example specs
   */
  steps: StepResult[];
  /**
   * @deprecated Use exampleResults[n].failedAt instead
   * Kept for backwards compatibility with single-example specs
   */
  failedAt?: {
    stepIndex: number;
    step: SpecStep;
    context: FailureContext;
  };
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
 * Context passed to step execution
 */
export interface StepContext {
  /** Index of current step */
  stepIndex: number;
  /** Total number of steps */
  totalSteps: number;
  /** Results from previous steps */
  previousResults: StepResult[];
  /** Current page state */
  page: Page;
  /** Stagehand instance */
  stagehand: Stagehand;
  /** Tester instance */
  tester: Tester;
  /** Current behavior ID (for credential tracking) */
  currentBehaviorId?: string;
  /** Credential tracker (for Sign Up/Sign In) */
  credentialTracker?: import('./index').CredentialTracker;
}
