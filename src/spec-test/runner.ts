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
  ActContext,
} from "./types";
import { evaluateActResult } from "./act-evaluator";

import { parseSpecFile } from "./parsing";
import {
  isNavigationAction,
  isRefreshAction,
  generateFailureContext,
} from "./step-execution";
import { detectPort, resetSession, navigateToPagePath, clearFormFields, safeWaitForLoadState } from "./session-management";
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

/**
 * Main class for parsing and executing behavior specifications against a running application.
 *
 * Snapshot Lifecycle Management (for B-Test diff-based assertions):
 * 1. Before first step: take initial snapshot (first "before" baseline)
 * 2. Before each Act step: reset snapshots + take new snapshot (fresh "before")
 * 3. Execute Act step: page state changes
 * 4. Check step: executeSemanticCheck takes "after" snapshot, then asserts diff
 *
 * Session Management:
 * - `clearSession: true` → navigate to about:blank, clear ALL storage/cookies,
 *   then navigate to baseUrl. Guarantees a completely clean slate.
 * - `clearSession: false` + `navigateToPath` → preserve session, navigate to the
 *   behavior's page path. localStorage persists across navigations.
 * - `clearSession: false` + no path → keep page as-is. For auth flow continuation.
 */
/** Maximum iterations for the adaptive act loop before giving up */
const MAX_ADAPTIVE_ITERATIONS = 5;

export class SpecTestRunner {
  private config: SpecTestConfig;
  private stagehand: Stagehand | null = null;
  private tester: Tester | null = null;
  private currentSpec: TestableSpec | null = null;
  /** Active page — set by runExample so executeAdaptiveAct can access it */
  private page: Page | null = null;
  /** URL captured before the most recent Act step, used to detect page transitions */
  private preActUrl: string | null = null;
  /** Whether port auto-detection has already run (only runs once per session) */
  private portDetected = false;

  constructor(config: SpecTestConfig) {
    this.config = config;
  }

  /** Get cache directory path for Stagehand. */
  private getCacheDir(spec?: TestableSpec): string | undefined {
    if (!this.config.cacheDir) return undefined;
    if (this.config.cachePerSpec && spec) {
      const safeName = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return path.join(this.config.cacheDir, safeName);
    }
    return this.config.cacheDir;
  }

  /** Clear the cache directory to force fresh LLM inference. */
  clearCache(): void {
    if (this.config.cacheDir && existsSync(this.config.cacheDir)) {
      rmSync(this.config.cacheDir, { recursive: true, force: true });
    }
  }

  /**
   * Initialize Stagehand browser and B-Test tester.
   * Includes Docker-compatible configuration.
   */
  private async initialize(): Promise<{ stagehand: Stagehand; tester: Tester }> {
    if (this.stagehand && this.tester) {
      return { stagehand: this.stagehand, tester: this.tester };
    }

    const { Stagehand } = await import("@browserbasehq/stagehand");
    const { Tester } = await import("../b-test");

    const isLocal = !this.config.browserbaseApiKey;
    const cacheDir = this.getCacheDir(this.currentSpec ?? undefined);

    const executablePath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    const isDocker = !!executablePath || process.getuid?.() === 0;

    const localBrowserOptions = isLocal ? {
      headless: this.config.headless ?? true,
      ...(executablePath && { executablePath }),
      chromiumSandbox: isDocker ? false : undefined,
      args: isDocker ? [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ] : undefined,
    } : undefined;

    this.stagehand = new Stagehand({
      env: isLocal ? "LOCAL" : "BROWSERBASE",
      apiKey: this.config.browserbaseApiKey,
      cacheDir,
      disablePino: true,
      localBrowserLaunchOptions: localBrowserOptions,
      ...this.config.stagehandOptions,
    });

    await this.stagehand.init();
    const page = this.stagehand.context.activePage();

    if (!page) {
      throw new Error("Failed to get active page from Stagehand");
    }

    this.tester = this.config.aiModel
      ? new Tester(page, this.config.aiModel)
      : new Tester(page);

    return { stagehand: this.stagehand, tester: this.tester };
  }

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

  /**
   * Run a single example (behavior scenario).
   *
   * Session management strategy:
   * - clearSession=true: Hard reset via resetSession() — completely clean slate.
   * - clearSession=false + navigateToPath: Preserve session, navigate to behavior's page.
   * - clearSession=false + no path: Keep everything as-is (auth flow continuation).
   */
  async runExample(example: SpecExample, options?: {
    clearSession?: boolean;
    /** Navigate to this page path for non-first chain steps (e.g., "/candidates") */
    navigateToPath?: string;
    /** Credentials for auth recovery if navigation causes session loss. */
    credentials?: { email: string | null; password: string | null };
    /** Reload the page before running steps (cleans dirty form state). */
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
      const shouldClearSession = options?.clearSession !== false;

      console.log(`[runExample] clearSession=${shouldClearSession}, navigateToPath=${options?.navigateToPath ?? '(none)'}, currentUrl=${page.url()}`);

      if (shouldClearSession) {
        if (!this.portDetected) {
          this.config.baseUrl = await detectPort(page, this.config.baseUrl);
          this.portDetected = true;
        }
        await resetSession(page, this.config.baseUrl);
      } else if (options?.navigateToPath) {
        await navigateToPagePath(page, options.navigateToPath, this.config.baseUrl, stagehand, options?.credentials);
      } else {
        console.log(`[runExample] Preserving session. Page URL: ${page.url()}`);
      }

      if (options?.reloadPage) {
        console.log(`[runExample] Reloading page to clean form state`);
        await page.reload();
        await safeWaitForLoadState(page);
        await clearFormFields(page);
      }

      // Take initial snapshot for B-Test diff-based assertions
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

  /**
   * Execute a single step.
   *
   * Act steps: reset snapshots, take fresh baseline, then execute action.
   * Check steps: try direct text verification first, then semantic check.
   */
  async runStep(step: SpecStep, context: StepContext): Promise<StepResult> {
    const { page, stagehand, tester } = context;
    const stepStart = Date.now();

    if (step.type === "Act") {
      this.preActUrl = page.url();

      // Direct navigation (more reliable than Stagehand for URLs)
      const navUrl = isNavigationAction(step.instruction);
      if (navUrl) {
        return executePageAction(step, page, stepStart, () => page.goto(navUrl).then(() => {}));
      }

      // Direct page refresh
      if (isRefreshAction(step.instruction)) {
        return executePageAction(step, page, stepStart, () => page.reload().then(() => {}));
      }

      // Adaptive loop: observe → enrich instruction → act → evaluate
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

    // === CHECK STEP ===

    // Try deterministic text verification first (fast path)
    const { stepResult: deterministicResult, failed: deterministicFailed } =
      await tryDeterministicCheck(page, step, stepStart);
    if (deterministicResult) return deterministicResult;

    // Detect page transition for oracle selection strategy
    const currentUrl = page.url();
    const pageTransitioned = this.preActUrl !== null && currentUrl !== this.preActUrl;

    const checkType = step.checkType ?? "semantic";
    const checkResult = await executeCheckWithRetry(
      step.instruction, checkType, page, tester, stagehand, pageTransitioned, deterministicFailed
    );

    return { step, success: checkResult.passed, duration: Date.now() - stepStart, checkResult };
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

  /**
   * Adaptive act loop: observe → enrich instruction → act → evaluate.
   * Repeats until the step's goal is confirmed complete (or throws on failure/timeout).
   *
   * Uses stagehand.observe() to find the best matching element for the vague spec
   * instruction, enriches it with the concrete UI description, then evaluates whether
   * the goal was achieved via b-test diff + LLM judgment.
   */
  private async executeAdaptiveAct(goal: string): Promise<void> {
    const tester = this.tester!;
    const stagehand = this.stagehand!;
    const page = this.page!;

    // Pre-flight: dismiss any stale modal left from a previous step.
    await dismissStaleModal(page);

    const actContext: ActContext = {
      goal,
      lastAct: null,
      iteration: 0,
      history: [],
    };

    for (let iteration = 0; iteration < MAX_ADAPTIVE_ITERATIONS; iteration++) {
      actContext.iteration = iteration;

      // Iteration 0: use the original spec instruction directly — it's already precise
      // and observe() would strip the payload (e.g. "New Agent") from a type/fill goal.
      // Subsequent iterations: use observe() to locate the next concrete UI step when
      // handling intermediate states (modals, multi-step flows).
      let enrichedInstruction: string;
      if (iteration === 0) {
        enrichedInstruction = goal;
      } else {
        const observeQuery = actContext.nextContext ?? goal;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const candidates = await (stagehand as any).observe({ instruction: observeQuery }) as Array<{ description: string }>;
        enrichedInstruction = candidates[0]?.description ?? goal;
      }

      // SNAPSHOT: before (fresh baseline for evaluator diff)
      tester.clearSnapshots();
      await tester.snapshot(page);

      // ACT — with retry on transient API errors (ECONNRESET, schema, rate limit)
      await actWithRetry(stagehand, enrichedInstruction);

      // SNAPSHOT: after (evaluator uses before→after diff)
      await tester.snapshot(page);

      // Set lastAct before evaluate so the LLM knows what action was just taken
      actContext.lastAct = enrichedInstruction;

      // POST-ACT EVALUATE: three-way judgment
      const result = await evaluateActResult(tester, stagehand, actContext);

      if (result.status === "complete") return;
      if (result.status === "failed") {
        // Fallback 1: native date/time shadow DOM inputs
        const nativeFill = await tryNativeInputFill(page, stagehand, enrichedInstruction);
        if (nativeFill) {
          tester.clearSnapshots();
          await tester.snapshot(page);
          await nativeFill();
          await tester.snapshot(page);
          actContext.lastAct = `filled native input for: ${enrichedInstruction}`;
          const reEval = await evaluateActResult(tester, stagehand, actContext);
          if (reEval.status === "complete") return;
          if (reEval.status === "incomplete") {
            actContext.history.push({ act: actContext.lastAct, outcome: reEval.reason });
            actContext.nextContext = reEval.nextContext;
            continue;
          }
          // reEval also "failed" — fall through to next fallback
        }

        // Fallback 2: DOM-based click for elements outside Stagehand's a11y tree
        // (NPS scales, custom radio buttons, aria-label-only elements, etc.)
        // The "before" snapshot is already set — just add the "after" snapshot.
        const domClicked = await tryDOMClick(page, enrichedInstruction);
        if (domClicked) {
          await tester.snapshot(page);
          actContext.lastAct = `DOM click for: ${enrichedInstruction}`;
          const reEval = await evaluateActResult(tester, stagehand, actContext);
          if (reEval.status === "complete") return;
          if (reEval.status === "incomplete") {
            actContext.history.push({ act: actContext.lastAct, outcome: reEval.reason });
            actContext.nextContext = reEval.nextContext;
            continue;
          }
          // reEval also "failed" — fall through to next fallback
        }

        // Fallback 3: fill empty required fields, then retry the submit.
        // HTML5 required-field validation blocks submission without any DOM change,
        // causing the evaluator to return "failed" even though the button exists.
        if (isSubmitAction(enrichedInstruction)) {
          const filledCount = await tryFillRequiredInputs(page);
          if (filledCount > 0) {
            tester.clearSnapshots();
            await tester.snapshot(page);
            await actWithRetry(stagehand, enrichedInstruction);
            await tester.snapshot(page);
            actContext.lastAct = `retry submit after filling ${filledCount} required field(s)`;
            const reEval = await evaluateActResult(tester, stagehand, actContext);
            if (reEval.status === "complete") return;
            if (reEval.status === "incomplete") {
              actContext.history.push({ act: actContext.lastAct, outcome: reEval.reason });
              actContext.nextContext = reEval.nextContext;
              continue;
            }
            // still failed — fall through to throw
          }
        }

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

  /** Close browser and clean up resources. */
  async close(): Promise<void> {
    if (this.stagehand) {
      try {
        await Promise.race([
          this.stagehand.close(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 10000))
        ]);
      } catch { /* timeout or error, continue */ }
      this.stagehand = null;
    }
    if (this.tester) {
      this.tester.clearSnapshots();
      this.tester = null;
    }
  }
}
