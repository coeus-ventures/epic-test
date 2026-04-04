import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { Tester } from "../b-test";
import type { LanguageModelV2 } from "@ai-sdk/provider";

// Re-export all shared types for backwards compatibility
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
} from "../shared/types";

// Import shared types needed by spec-test-specific types
import type { SpecStep, StepResult, SpecExample, FailureContext } from "../shared/types";

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
 * Result of running a complete specification (all examples or specific one)
 */
export interface SpecTestResult {
  /** Overall success status (true if all executed examples passed) */
  success: boolean;
  /** Spec that was executed */
  spec: TestableSpec;
  /** Results for each example that was run */
  exampleResults: import("../shared/types").ExampleResult[];
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
  /** Next step in the sequence (for look-ahead decisions like modal auto-confirm) */
  nextStep?: SpecStep;
  /** Current behavior ID (for credential tracking) */
  currentBehaviorId?: string;
  /** Credential tracker (for Sign Up/Sign In) */
  credentialTracker?: import('../shared/credential-tracker').CredentialTracker;
}
