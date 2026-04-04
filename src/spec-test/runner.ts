// ============================================================================
// SPEC TEST RUNNER — the main class for executing behavior specs
// ============================================================================

import { existsSync, rmSync } from "fs";
import path from "path";
import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { Tester } from "../b-test";

import type {
  SpecTestConfig,
  TestableSpec,
  SpecExample,
  SpecStep,
  SpecTestResult,
  ExampleResult,
  StepResult,
  StepContext,
  FailureContext,
} from "./types";
import type { ActContext, ActEvalResult } from "../shared/types";
import { evaluateActResult } from "./act-evaluator";
import { BaseStagehandRunner } from "../shared/base-runner";

import { parseSpecFile } from "./parsing";
import {
  isNavigationAction,
  isRefreshAction,
  generateFailureContext,
} from "./step-execution";
import {
  executePageAction,
  tryNativeInputFill,
  actWithRetry,
  dismissStaleModal,
  tryDOMClick,
  tryFillRequiredInputs,
  isSubmitAction,
} from "./act-helpers";
import { tryDeterministicCheck, executeCheckWithRetry } from "./check-helpers";

/** Maximum iterations for the adaptive act loop before giving up */
const MAX_ADAPTIVE_ITERATIONS = 5;

/**
 * Main class for parsing and executing behavior specifications against a running application.
 *
 * Mutable state threading:
 * - `this.page` and `this.preActUrl` are set by runExample/routeActStep
 *   and read by executeAdaptiveAct. Tests inject them via `(runner as any).page`.
 *
 * Snapshot lifecycle (for B-Test diff-based assertions):
 * 1. Before first step: take initial snapshot (first "before" baseline)
 * 2. Before each Act step: reset snapshots + take new snapshot (fresh "before")
 * 3. Execute Act step: page state changes
 * 4. Check step: takes "after" snapshot, then asserts diff
 */
export class SpecTestRunner extends BaseStagehandRunner {
  declare protected config: SpecTestConfig;
  private tester: Tester | null = null;
  private currentSpec: TestableSpec | null = null;
  private page: Page | null = null;
  private preActUrl: string | null = null;

  constructor(config: SpecTestConfig) {
    super(config);
  }

  // ── PUBLIC ENTRY POINTS ──────────────────────────────────────────────

  /** Run a specification from a markdown file. */
  async runFromFile(filePath: string, exampleName?: string): Promise<SpecTestResult> {
    const spec = await parseSpecFile(filePath);
    return this.runFromSpec(spec, exampleName);
  }

  /** Run a parsed specification. */
  async runFromSpec(spec: TestableSpec, exampleName?: string): Promise<SpecTestResult> {
    const startTime = Date.now();
    this.currentSpec = spec;

    const examplesToRun = exampleName
      ? spec.examples.filter(e => e.name === exampleName)
      : spec.examples;

    if (examplesToRun.length === 0) {
      const availableNames = spec.examples.map(e => e.name).join(", ");
      throw new Error(
        exampleName
          ? `Example "${exampleName}" not found. Available: ${availableNames}`
          : "No examples found in specification"
      );
    }

    const exampleResults: ExampleResult[] = [];
    for (const example of examplesToRun) {
      const result = await this.runExample(example);
      exampleResults.push(result);
    }

    const duration = Date.now() - startTime;
    const success = exampleResults.every(r => r.success);
    const firstResult = exampleResults[0];

    return {
      success,
      spec,
      exampleResults,
      duration,
      steps: firstResult?.steps ?? [],
      failedAt: firstResult?.failedAt,
    };
  }

  /** Clear the cache directory to force fresh LLM inference. */
  clearCache(): void {
    if (this.config.cacheDir && existsSync(this.config.cacheDir)) {
      rmSync(this.config.cacheDir, { recursive: true, force: true });
    }
  }

  /** Close browser and clean up resources. */
  async close(): Promise<void> {
    await super.close();
    if (this.tester) {
      this.tester.clearSnapshots();
      this.tester = null;
    }
  }

  // ── CORE EXECUTION ───────────────────────────────────────────────────

  /**
   * Run a single example (behavior scenario).
   *
   * Session management:
   * - clearSession=true: Hard reset — completely clean slate
   * - clearSession=false + navigateToPath: Preserve session, navigate to page
   * - clearSession=false + no path: Keep as-is (auth flow continuation)
   */
  async runExample(example: SpecExample, options?: {
    clearSession?: boolean;
    navigateToPath?: string;
    credentials?: { email: string | null; password: string | null };
    reloadPage?: boolean;
  }): Promise<ExampleResult> {
    const startTime = Date.now();

    try {
      const { stagehand, tester } = await this.initialize();
      const stagehandPage = stagehand.context.activePage();

      if (!stagehandPage) {
        throw new Error("No active page available");
      }

      const page = stagehandPage as unknown as Page;
      this.page = page;

      await this.manageSession(page, stagehand, options);
      await tester.snapshot(page);

      const stepResults: StepResult[] = [];
      let failedAt: ExampleResult["failedAt"] | undefined;

      for (let i = 0; i < example.steps.length; i++) {
        const step = example.steps[i];
        const context: StepContext = {
          stepIndex: i,
          totalSteps: example.steps.length,
          previousResults: stepResults,
          page,
          stagehand,
          tester,
          nextStep: example.steps[i + 1],
        };

        const stepResult = await this.runStep(step, context);
        stepResults.push(stepResult);

        if (!stepResult.success) {
          failedAt = await this.buildFailureResult(page, step, stepResult, i);
          break;
        }
      }

      return {
        example,
        success: !failedAt,
        steps: stepResults,
        duration: Date.now() - startTime,
        failedAt,
      };
    } catch (error) {
      return this.buildCrashResult(example, startTime, error instanceof Error ? error.message : String(error));
    }
  }

  /** Dispatch a step to the appropriate Act or Check handler. */
  async runStep(step: SpecStep, context: StepContext): Promise<StepResult> {
    if (step.type === "Act") return this.routeActStep(step, context);
    return this.routeCheckStep(step, context);
  }

  // ── STEP ROUTING ─────────────────────────────────────────────────────

  /** Route an Act step: direct navigation → direct refresh → adaptive loop. */
  private async routeActStep(step: SpecStep, context: StepContext): Promise<StepResult> {
    const { page } = context;
    const stepStart = Date.now();
    this.preActUrl = page.url();

    const navUrl = isNavigationAction(step.instruction);
    if (navUrl) {
      return executePageAction(step, page, stepStart, () => page.goto(navUrl).then(() => {}));
    }

    if (isRefreshAction(step.instruction)) {
      return executePageAction(step, page, stepStart, () => page.reload().then(() => {}));
    }

    try {
      await this.executeAdaptiveAct(step.instruction);
      const actResult = { success: true, duration: Date.now() - stepStart, pageUrl: page.url() };
      return { step, success: true, duration: Date.now() - stepStart, actResult };
    } catch (error) {
      const actResult = {
        success: false,
        duration: Date.now() - stepStart,
        error: error instanceof Error ? error.message : String(error),
      };
      return { step, success: false, duration: Date.now() - stepStart, actResult };
    }
  }

  /** Route a Check step: deterministic fast-path → semantic check with retry. */
  private async routeCheckStep(step: SpecStep, context: StepContext): Promise<StepResult> {
    const { page, tester, stagehand } = context;
    const stepStart = Date.now();

    const { stepResult: deterministicResult, failed: deterministicFailed } =
      await tryDeterministicCheck(page, step, stepStart);
    if (deterministicResult) return deterministicResult;

    const pageTransitioned = this.preActUrl !== null && page.url() !== this.preActUrl;
    const checkType = step.checkType ?? "semantic";
    const checkResult = await executeCheckWithRetry(
      step.instruction, checkType, page, tester, stagehand, pageTransitioned, deterministicFailed
    );

    return { step, success: checkResult.passed, duration: Date.now() - stepStart, checkResult };
  }

  // ── ADAPTIVE ACT ENGINE ──────────────────────────────────────────────

  /**
   * Adaptive act loop: observe → enrich instruction → act → evaluate.
   * Repeats until the goal is confirmed complete, or throws on failure/timeout.
   */
  private async executeAdaptiveAct(goal: string): Promise<void> {
    const tester = this.tester!;
    const stagehand = this.stagehand!;
    const page = this.page!;

    await dismissStaleModal(page);

    const actContext: ActContext = { goal, lastAct: null, iteration: 0, history: [] };

    for (let iteration = 0; iteration < MAX_ADAPTIVE_ITERATIONS; iteration++) {
      actContext.iteration = iteration;

      const enrichedInstruction = await this.enrichInstruction(goal, actContext, stagehand);

      // Snapshot before → act → snapshot after
      tester.clearSnapshots();
      await tester.snapshot(page);
      await actWithRetry(stagehand, enrichedInstruction);
      await tester.snapshot(page);

      actContext.lastAct = enrichedInstruction;
      const result = await evaluateActResult(tester, stagehand, actContext);

      if (result.status === "complete") return;

      if (result.status === "failed") {
        const recovered = await this.tryFallbacks(enrichedInstruction, actContext);
        if (recovered === "complete") return;
        if (recovered === "incomplete") continue;
        throw new Error(`Act step failed: ${result.reason}`);
      }

      // incomplete: update context and loop to handle intermediate state
      actContext.history.push({ act: enrichedInstruction, outcome: result.reason });
      actContext.nextContext = result.nextContext;
    }

    throw new Error(
      `Act step did not complete after ${MAX_ADAPTIVE_ITERATIONS} iterations: "${goal}"`
    );
  }

  /**
   * Iteration 0: use the original goal directly (already precise).
   * Subsequent iterations: use observe() to locate the next concrete UI element.
   */
  private async enrichInstruction(
    goal: string, actContext: ActContext, stagehand: Stagehand
  ): Promise<string> {
    if (actContext.iteration === 0) return goal;

    const observeQuery = actContext.nextContext ?? goal;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidates = await (stagehand as any).observe({ instruction: observeQuery }) as Array<{ description: string }>;
    return candidates[0]?.description ?? goal;
  }

  /**
   * Try fallback strategies in priority order when the main act fails.
   * Returns "complete"/"incomplete" if a fallback recovers, or "failed" if none do.
   */
  private async tryFallbacks(
    instruction: string, actContext: ActContext
  ): Promise<"complete" | "incomplete" | "failed"> {
    const page = this.page!;
    const stagehand = this.stagehand!;

    // Fallback 1: native date/time shadow DOM inputs
    const nativeFill = await tryNativeInputFill(page, stagehand, instruction);
    const r1 = await this.attemptFallbackRecovery(
      nativeFill, `filled native input for: ${instruction}`, actContext, true,
    );
    if (r1?.status === "complete") return "complete";
    if (r1?.status === "incomplete") {
      actContext.history.push({ act: actContext.lastAct!, outcome: r1.reason });
      actContext.nextContext = r1.nextContext;
      return "incomplete";
    }

    // Fallback 2: DOM click for elements outside Stagehand's a11y tree
    const domClicked = await tryDOMClick(page, instruction);
    const r2 = domClicked
      ? await this.attemptFallbackRecovery(
          async () => {}, `DOM click for: ${instruction}`, actContext, false,
        )
      : null;
    if (r2?.status === "complete") return "complete";
    if (r2?.status === "incomplete") {
      actContext.history.push({ act: actContext.lastAct!, outcome: r2.reason });
      actContext.nextContext = r2.nextContext;
      return "incomplete";
    }

    // Fallback 3: fill empty required fields, then retry the submit
    if (isSubmitAction(instruction)) {
      const filledCount = await tryFillRequiredInputs(page);
      if (filledCount > 0) {
        const retryAction = async () => { await actWithRetry(stagehand, instruction); };
        const r3 = await this.attemptFallbackRecovery(
          retryAction, `retry submit after filling ${filledCount} required field(s)`, actContext, true,
        );
        if (r3?.status === "complete") return "complete";
        if (r3?.status === "incomplete") {
          actContext.history.push({ act: actContext.lastAct!, outcome: r3.reason });
          actContext.nextContext = r3.nextContext;
          return "incomplete";
        }
      }
    }

    return "failed";
  }

  /**
   * Execute a single fallback: snapshot → action → snapshot → re-evaluate.
   * Returns null if the fallback action is null (not applicable).
   *
   * @param freshBaseline - true: clear snapshots + take new before. false: reuse existing before snapshot.
   */
  private async attemptFallbackRecovery(
    action: (() => Promise<void>) | null,
    description: string,
    actContext: ActContext,
    freshBaseline: boolean,
  ): Promise<ActEvalResult | null> {
    if (!action) return null;

    const tester = this.tester!;
    const page = this.page!;

    if (freshBaseline) {
      tester.clearSnapshots();
      await tester.snapshot(page);
    }

    await action();
    await tester.snapshot(page);

    actContext.lastAct = description;
    return evaluateActResult(tester, this.stagehand!, actContext);
  }

  // ── LEAF HELPERS ─────────────────────────────────────────────────────

  /** Initialize Stagehand browser and B-Test tester (lazy, cached). */
  private async initialize(): Promise<{ stagehand: Stagehand; tester: Tester }> {
    if (this.stagehand && this.tester) {
      return { stagehand: this.stagehand, tester: this.tester };
    }

    const cacheDir = this.getCacheDir(this.currentSpec ?? undefined);
    const originalCacheDir = this.config.cacheDir;
    if (cacheDir) this.config.cacheDir = cacheDir;

    const stagehand = await this.initializeStagehand();

    if (cacheDir) this.config.cacheDir = originalCacheDir;

    const { Tester } = await import("../b-test");
    const page = stagehand.context.activePage();

    if (!page) {
      throw new Error("Failed to get active page from Stagehand");
    }

    this.tester = this.config.aiModel
      ? new Tester(page, this.config.aiModel)
      : new Tester(page);

    return { stagehand, tester: this.tester };
  }

  /** Get cache directory path, with optional per-spec subdirectory. */
  private getCacheDir(spec?: TestableSpec): string | undefined {
    if (!this.config.cacheDir) return undefined;
    if (this.config.cachePerSpec && spec) {
      const safeName = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return path.join(this.config.cacheDir, safeName);
    }
    return this.config.cacheDir;
  }

  /** Build failedAt context from a failed step result. */
  private async buildFailureResult(
    page: Page, step: SpecStep, stepResult: StepResult, stepIndex: number
  ): Promise<ExampleResult["failedAt"]> {
    const error = new Error(
      step.type === "Act"
        ? stepResult.actResult?.error ?? "Act step failed"
        : stepResult.checkResult?.actual ?? "Check step failed"
    );

    let failureContext: FailureContext;
    try {
      failureContext = await generateFailureContext(page, step, error);
    } catch {
      failureContext = {
        pageSnapshot: "",
        pageUrl: "",
        failedStep: step,
        error: error.message,
        availableElements: [],
        suggestions: ["Could not generate failure context - browser may have crashed"],
      };
    }

    return { stepIndex, step, context: failureContext };
  }

  /** Build a crash-safe ExampleResult when browser/page initialization fails. */
  private buildCrashResult(example: SpecExample, startTime: number, errorMessage: string): ExampleResult {
    const fallbackStep = example.steps[0] ?? { type: "Act" as const, instruction: "initialize" };
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
          suggestions: ["Browser or page initialization failed"],
        },
      },
    };
  }
}
