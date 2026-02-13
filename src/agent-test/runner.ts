// ============================================================================
// AGENT TEST RUNNER — goal-driven browser verification using Stagehand Agent API
// ============================================================================

import type { Page } from "playwright";
import type {
  Stagehand,
  AgentConfig,
  AgentExecuteOptions,
} from "@browserbasehq/stagehand";

import type {
  BehaviorRunner,
  SpecExample,
  ExampleResult,
  StepResult,
  FailureContext,
} from "../spec-test/types";
import {
  detectPort,
  resetSession,
  navigateToPagePath,
  clearFormFields,
} from "../spec-test/session-management";

import type { AgentTestConfig, AgentExecutionResult } from "./types";
import { DEFAULT_MAX_STEPS, CLOSE_TIMEOUT_MS } from "./types";
import { buildGoalPrompt } from "./goal-builder";
import { verifyOutcome } from "./verifier";

/**
 * Agent-based test runner that implements the BehaviorRunner interface.
 *
 * Instead of executing Act/Check steps one-by-one, it:
 * 1. Builds a goal prompt from the steps (adaptive hints)
 * 2. Sends the goal to stagehand.agent.execute() for autonomous execution
 * 3. Verifies outcomes using stagehand.extract() against Check steps
 * 4. Returns an ExampleResult with synthetic step results
 *
 * Plugs into the existing orchestration layer (verifyAllBehaviors,
 * runAuthBehaviorsSequence, verifyBehaviorWithDependencies) unchanged.
 */
export class AgentTestRunner implements BehaviorRunner {
  private config: AgentTestConfig;
  private stagehand: Stagehand | null = null;
  private portDetected = false;

  constructor(config: AgentTestConfig) {
    this.config = config;
  }

  /**
   * Initialize Stagehand browser instance (lazy, cached).
   * Same Docker-compatible logic as SpecTestRunner.
   */
  private async initialize(): Promise<Stagehand> {
    if (this.stagehand) return this.stagehand;

    const { Stagehand } = await import("@browserbasehq/stagehand");

    const isLocal = !this.config.browserbaseApiKey;

    const executablePath =
      process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    const isDocker = !!executablePath || process.getuid?.() === 0;

    const localBrowserOptions = isLocal
      ? {
          headless: this.config.headless ?? true,
          ...(executablePath && { executablePath }),
          chromiumSandbox: isDocker ? false : undefined,
          args: isDocker
            ? [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
              ]
            : undefined,
        }
      : undefined;

    this.stagehand = new Stagehand({
      env: isLocal ? "LOCAL" : "BROWSERBASE",
      apiKey: this.config.browserbaseApiKey,
      disablePino: true,
      localBrowserLaunchOptions: localBrowserOptions,
      ...this.config.stagehandOptions,
    });

    await this.stagehand.init();

    const page = this.stagehand.context.activePage();
    if (!page) {
      throw new Error("Failed to get active page from Stagehand");
    }

    return this.stagehand;
  }

  /**
   * Run a single example using the Stagehand Agent API.
   *
   * Session management strategy (identical to SpecTestRunner):
   * - clearSession=true: Hard reset via resetSession()
   * - clearSession=false + navigateToPath: Preserve session, navigate to page
   * - clearSession=false + no path: Keep everything as-is (auth flow continuation)
   */
  async runExample(
    example: SpecExample,
    options?: {
      clearSession?: boolean;
      navigateToPath?: string;
      credentials?: { email: string | null; password: string | null };
      reloadPage?: boolean;
    }
  ): Promise<ExampleResult> {
    const startTime = Date.now();

    try {
      const stagehand = await this.initialize();
      const page = stagehand.context.activePage() as unknown as Page;

      if (!page) {
        throw new Error("No active page available");
      }

      await this.manageSession(page, stagehand, options);

      const { goal, successCriteria } = buildGoalPrompt(example.steps);

      console.log(
        `[AgentTestRunner] Executing agent goal (${example.steps.length} steps → ${successCriteria.length} checks):\n${goal.slice(0, 200)}...`
      );

      const agentResult = await this.executeAgent(stagehand, goal);
      const agentStepResult = this.buildAgentStepResult(goal, agentResult);

      if (!agentResult.success) {
        return {
          example,
          success: false,
          steps: [agentStepResult],
          duration: Date.now() - startTime,
          failedAt: {
            stepIndex: 0,
            step: { type: "act", instruction: goal },
            context: await this.buildAgentFailureContext(
              page,
              goal,
              agentResult
            ),
          },
        };
      }

      const { stepResults, failedAt } = await this.verifyAndBuildStepResults(
        agentStepResult,
        successCriteria,
        stagehand,
        page
      );

      return {
        example,
        success: !failedAt,
        steps: stepResults,
        duration: Date.now() - startTime,
        failedAt,
      };
    } catch (error) {
      return this.buildInitFailureResult(example, error, startTime);
    }
  }

  /**
   * Handle session setup: clear/navigate/preserve based on options.
   */
  private async manageSession(
    page: Page,
    stagehand: Stagehand,
    options?: {
      clearSession?: boolean;
      navigateToPath?: string;
      credentials?: { email: string | null; password: string | null };
      reloadPage?: boolean;
    }
  ): Promise<void> {
    const shouldClearSession = options?.clearSession !== false;

    console.log(
      `[AgentTestRunner] clearSession=${shouldClearSession}, navigateToPath=${options?.navigateToPath ?? "(none)"}, currentUrl=${page.url()}`
    );

    if (shouldClearSession) {
      if (!this.portDetected) {
        this.config.baseUrl = await detectPort(page, this.config.baseUrl);
        this.portDetected = true;
      }
      await resetSession(page, this.config.baseUrl);
    } else if (options?.navigateToPath) {
      await navigateToPagePath(
        page,
        options.navigateToPath,
        this.config.baseUrl,
        stagehand,
        options?.credentials
      );
    } else {
      console.log(
        `[AgentTestRunner] Preserving session. Page URL: ${page.url()}`
      );
    }

    if (options?.reloadPage) {
      console.log(`[AgentTestRunner] Reloading page to clean form state`);
      await page.reload();
      await page.waitForLoadState("networkidle");
      await clearFormFields(page);
    }
  }

  /**
   * Execute the Stagehand agent with the given goal.
   */
  private async executeAgent(
    stagehand: Stagehand,
    goal: string
  ): Promise<AgentExecutionResult> {
    try {
      const mode = this.config.agentMode ?? "cua";
      const maxSteps = this.config.maxSteps ?? DEFAULT_MAX_STEPS;

      const agentConfig: AgentConfig = { mode };
      if (this.config.agentModel) {
        agentConfig.model = this.config.agentModel;
      }
      if (this.config.agentSystemPrompt) {
        agentConfig.systemPrompt = this.config.agentSystemPrompt;
      }

      const agent = stagehand.agent(agentConfig);

      const executeOptions: AgentExecuteOptions = {
        instruction: goal,
        maxSteps,
      };

      const result = await agent.execute(executeOptions);

      console.log(
        `[AgentTestRunner] Agent result: success=${result.success}, completed=${result.completed}, actions=${result.actions?.length ?? 0}`
      );

      return {
        success: result.success ?? false,
        message: result.message ?? "",
        actions: result.actions ?? [],
        completed: result.completed ?? false,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.log(`[AgentTestRunner] Agent execution error: ${errorMessage}`);
      return {
        success: false,
        message: `Agent error: ${errorMessage}`,
        actions: [],
        completed: false,
      };
    }
  }

  /**
   * Verify outcomes and assemble step results after successful agent execution.
   */
  private async verifyAndBuildStepResults(
    agentStepResult: StepResult,
    successCriteria: string[],
    stagehand: Stagehand,
    page: Page
  ): Promise<{
    stepResults: StepResult[];
    failedAt?: ExampleResult["failedAt"];
  }> {
    const stepResults: StepResult[] = [agentStepResult];

    if (successCriteria.length > 0) {
      const { results: checkResults } = await verifyOutcome(
        successCriteria,
        stagehand,
        page
      );

      const checkStepResults = checkResults.map((check) => ({
        step: { type: "check" as const, instruction: check.instruction },
        success: check.passed,
        duration: 0,
        checkResult: {
          passed: check.passed,
          checkType: "semantic" as const,
          expected: check.instruction,
          actual: check.actual,
          reasoning: check.reasoning,
        },
      }));
      stepResults.push(...checkStepResults);
    }

    const firstFailedIndex = stepResults.findIndex((s) => !s.success);
    if (firstFailedIndex === -1) return { stepResults };

    const failedStep = stepResults[firstFailedIndex];
    return {
      stepResults,
      failedAt: {
        stepIndex: firstFailedIndex,
        step: failedStep.step,
        context: await this.buildCheckFailureContext(
          page,
          failedStep.step.instruction,
          failedStep.checkResult?.actual ?? "Check failed"
        ),
      },
    };
  }

  /**
   * Build a synthetic StepResult for the agent execution phase.
   */
  private buildAgentStepResult(
    goal: string,
    agentResult: AgentExecutionResult
  ): StepResult {
    return {
      step: { type: "act", instruction: goal },
      success: agentResult.success,
      duration: 0,
      actResult: {
        success: agentResult.success,
        duration: 0,
        error: agentResult.success ? undefined : agentResult.message,
      },
    };
  }

  /**
   * Safely capture current page URL and HTML content.
   */
  private async capturePageState(
    page: Page
  ): Promise<{ pageUrl: string; pageSnapshot: string }> {
    try {
      return { pageUrl: page.url(), pageSnapshot: await page.content() };
    } catch {
      return { pageUrl: "", pageSnapshot: "" };
    }
  }

  /**
   * Build a FailureContext for agent execution failures.
   */
  private async buildAgentFailureContext(
    page: Page,
    goal: string,
    agentResult: AgentExecutionResult
  ): Promise<FailureContext> {
    const { pageUrl, pageSnapshot } = await this.capturePageState(page);

    return {
      pageSnapshot,
      pageUrl,
      failedStep: { type: "act", instruction: goal },
      error: agentResult.message || "Agent failed to complete the task",
      availableElements: [],
      suggestions: [
        "The agent could not complete the goal autonomously",
        `Agent reported: ${agentResult.message}`,
        `Actions taken: ${agentResult.actions.length}`,
      ],
    };
  }

  /**
   * Build a FailureContext for post-agent verification failures.
   */
  private async buildCheckFailureContext(
    page: Page,
    instruction: string,
    actual: string
  ): Promise<FailureContext> {
    const { pageUrl, pageSnapshot } = await this.capturePageState(page);

    return {
      pageSnapshot,
      pageUrl,
      failedStep: { type: "check", instruction },
      error: `Verification failed: ${actual}`,
      availableElements: [],
      suggestions: [
        "The agent completed its task but the expected outcome was not found on the page",
        `Check: ${instruction}`,
        `Found: ${actual}`,
      ],
    };
  }

  /**
   * Build a failure ExampleResult for initialization/crash errors.
   */
  private buildInitFailureResult(
    example: SpecExample,
    error: unknown,
    startTime: number
  ): ExampleResult {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const fallbackStep = example.steps[0] ?? {
      type: "act" as const,
      instruction: "initialize",
    };

    return {
      example,
      success: false,
      steps: [],
      duration: Date.now() - startTime,
      failedAt: {
        stepIndex: 0,
        step: fallbackStep,
        context: {
          pageSnapshot: "",
          pageUrl: "",
          failedStep: fallbackStep,
          error: errorMessage,
          availableElements: [],
          suggestions: ["Browser or agent initialization failed"],
        },
      },
    };
  }

  /** Close browser and clean up resources. */
  async close(): Promise<void> {
    if (this.stagehand) {
      try {
        await Promise.race([
          this.stagehand.close(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Close timeout")),
              CLOSE_TIMEOUT_MS
            )
          ),
        ]);
      } catch {
        /* timeout or error, continue */
      }
      this.stagehand = null;
    }
  }
}
