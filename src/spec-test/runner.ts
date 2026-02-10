// ============================================================================
// SPEC TEST RUNNER — the main class for executing behavior specs
// ============================================================================

import { existsSync, rmSync } from "fs";
import path from "path";
import { z } from "zod";
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
  CheckResult,
  ActResult,
  FailureContext,
} from "./types";

import { parseSpecFile } from "./parsing";
import {
  executeActStep,
  executeCheckStep,
  generateFailureContext,
  isNavigationAction,
  isRefreshAction,
  extractExpectedText,
  extractNavigationTarget,
  getEnhancedErrorContext,
  getCheckErrorContext,
  MAX_RETRIES,
  RETRY_DELAY,
} from "./step-execution";

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
export class SpecTestRunner {
  private config: SpecTestConfig;
  private stagehand: Stagehand | null = null;
  private tester: Tester | null = null;
  private currentSpec: TestableSpec | null = null;
  /** URL captured before the most recent Act step, used to detect page transitions */
  private preActUrl: string | null = null;

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

  /**
   * Hard reset: navigate to about:blank → baseUrl → clear all storage/cookies → reload.
   * Guarantees a completely clean SPA state with zero auth tokens or user data.
   */
  private async resetSession(page: Page): Promise<void> {
    // 1. Navigate to about:blank to fully unload the SPA (destroys in-memory state).
    await page.goto('about:blank');

    // 2. Navigate to baseUrl to get back on the app's origin.
    await page.goto(this.config.baseUrl);

    // 3. Clear localStorage, sessionStorage, and non-HttpOnly cookies on the correct origin.
    await page.evaluate(() => {
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
      try {
        document.cookie.split(';').forEach(c => {
          const name = c.split('=')[0].trim();
          if (name) {
            document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
          }
        });
      } catch {}
    }).catch(() => {});

    // 4. Reload so the SPA re-initializes reading the now-empty storage.
    await page.reload();
    await page.waitForLoadState('networkidle');
    console.log(`[runExample] Hard reset complete. Page URL: ${page.url()}`);
  }

  /** Compare URLs ignoring trailing slashes. */
  private urlsMatch(a: string, b: string): boolean {
    return a.replace(/\/$/, '') === b.replace(/\/$/, '');
  }

  /** Detect if the page was redirected to a sign-in/login page. */
  private isSignInRedirect(currentUrl: string, targetUrl: string): boolean {
    if (this.urlsMatch(currentUrl, targetUrl)) return false;
    const path = new URL(currentUrl).pathname.toLowerCase();
    return /\/(sign[-_]?in|login|auth)/.test(path);
  }

  /** Attempt to re-authenticate by filling the sign-in form. */
  private async recoverAuth(
    page: Page,
    credentials: { email: string | null; password: string | null },
    targetUrl: string
  ): Promise<void> {
    const { stagehand } = await this.initialize();
    try {
      await stagehand.act(`Type "${credentials.email}" into the email field`);
      await stagehand.act(`Type "${credentials.password}" into the password field`);
      await stagehand.act('Click the sign in button');
      await page.waitForLoadState('networkidle');

      // Navigate to the original target after re-auth
      const afterAuth = page.url();
      if (!this.urlsMatch(afterAuth, targetUrl)) {
        await page.evaluate((url: string) => { window.location.href = url; }, targetUrl);
        await page.waitForLoadState('networkidle');
      }
      console.log(`[navigateToPagePath] Auth recovery succeeded. Page URL: ${page.url()}`);
    } catch (error) {
      console.log(`[navigateToPagePath] Auth recovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Navigate to a page path while preserving the current session.
   * Uses soft navigation (window.location.href) instead of page.goto() to avoid
   * destroying SPA in-memory auth state. Includes auth recovery if session is lost.
   */
  private async navigateToPagePath(
    page: Page,
    pagePath: string,
    credentials?: { email: string | null; password: string | null }
  ): Promise<void> {
    const targetUrl = `${this.config.baseUrl.replace(/\/$/, '')}${pagePath}`;
    const currentUrl = page.url();

    // Skip if already on the target URL
    if (this.urlsMatch(currentUrl, targetUrl)) {
      console.log(`[navigateToPagePath] Already on ${pagePath}, skipping navigation`);
      return;
    }

    // Skip parameterized routes (e.g., /products/:id) — trust dependency chain navigation
    if (/:\w+/.test(pagePath)) {
      console.log(`[navigateToPagePath] Parameterized route "${pagePath}", skipping navigation (trusting dependency chain)`);
      return;
    }

    // Soft navigation (avoids full reload, preserves SPA state)
    console.log(`[navigateToPagePath] Soft-navigating to ${targetUrl}`);
    await page.evaluate((url: string) => { window.location.href = url; }, targetUrl);
    await page.waitForLoadState('networkidle');

    // Auth recovery — detect redirect to sign-in page
    const afterUrl = page.url();
    if (this.isSignInRedirect(afterUrl, targetUrl) && credentials?.email && credentials?.password) {
      console.log(`[navigateToPagePath] Auth lost — detected redirect to ${afterUrl}. Attempting recovery...`);
      await this.recoverAuth(page, credentials, targetUrl);
    } else {
      console.log(`[navigateToPagePath] Page URL after navigation: ${afterUrl}`);
    }
  }

  /** Build failedAt context from a failed step result. */
  private async buildFailureResult(
    page: Page, step: SpecStep, stepResult: StepResult, stepIndex: number
  ): Promise<ExampleResult["failedAt"]> {
    const error = new Error(
      step.type === "act"
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
      const shouldClearSession = options?.clearSession !== false;

      console.log(`[runExample] clearSession=${shouldClearSession}, navigateToPath=${options?.navigateToPath ?? '(none)'}, currentUrl=${page.url()}`);

      if (shouldClearSession) {
        await this.resetSession(page);
      } else if (options?.navigateToPath) {
        await this.navigateToPagePath(page, options.navigateToPath, options?.credentials);
      } else {
        console.log(`[runExample] Preserving session. Page URL: ${page.url()}`);
      }

      // Reload page to clean dirty form state (e.g., after Invalid Sign In)
      if (options?.reloadPage) {
        console.log(`[runExample] Reloading page to clean form state`);
        await page.reload();
        await page.waitForLoadState('networkidle');
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      const fallbackStep = example.steps[0] ?? { type: "act" as const, instruction: "initialize" };

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

  /**
   * Execute a page action (navigation or refresh) with shared try/catch pattern.
   * Returns a StepResult for the action.
   */
  private async executePageAction(
    step: SpecStep, page: Page, stepStart: number,
    action: () => Promise<void>
  ): Promise<StepResult> {
    try {
      await action();
      await page.waitForLoadState('networkidle');
      const duration = Date.now() - stepStart;
      return { step, success: true, duration, actResult: { success: true, duration, pageUrl: page.url() } };
    } catch (error) {
      const duration = Date.now() - stepStart;
      return { step, success: false, duration, actResult: { success: false, duration, error: error instanceof Error ? error.message : String(error) } };
    }
  }

  /**
   * Try deterministic text verification as a fast path for check steps.
   * Returns a StepResult if the check passes deterministically, or null to fall through to semantic.
   */
  private async tryDeterministicCheck(
    page: Page, step: SpecStep, stepStart: number
  ): Promise<StepResult | null> {
    const textCheck = extractExpectedText(step.instruction);
    if (!textCheck) return null;

    try {
      const exists = await page.evaluate((text: string) => {
        return document.body.innerText.includes(text);
      }, textCheck.text).catch(() => false);
      const passed = textCheck.shouldExist ? exists : !exists;
      if (passed) {
        return {
          step,
          success: true,
          duration: Date.now() - stepStart,
          checkResult: {
            passed: true,
            checkType: "deterministic",
            expected: step.instruction,
            actual: exists ? `Found "${textCheck.text}" on page` : `Text "${textCheck.text}" not on page (expected absent)`,
          },
        };
      }
      console.log(`[runStep] Deterministic text check failed for "${textCheck.text}" — falling through to semantic oracle`);
    } catch { /* fall through to semantic check */ }

    return null;
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

    if (step.type === "act") {
      this.preActUrl = page.url();

      // Fresh "before" baseline for upcoming Check steps
      tester.clearSnapshots();
      await tester.snapshot(page);

      // Direct navigation (more reliable than Stagehand for URLs)
      const navUrl = isNavigationAction(step.instruction);
      if (navUrl) {
        return this.executePageAction(step, page, stepStart, () => page.goto(navUrl).then(() => {}));
      }

      // Direct page refresh
      if (isRefreshAction(step.instruction)) {
        return this.executePageAction(step, page, stepStart, () => page.reload().then(() => {}));
      }

      // Stagehand AI action with retry logic
      const actResult = await this.executeActWithRetry(step.instruction, stagehand, page);

      // Redundant navigation fallback: if act failed and it's a UI navigation action
      // (e.g., "Click Contacts in the navigation") and the URL already matches, treat as no-op
      if (!actResult.success) {
        const navTarget = extractNavigationTarget(step.instruction);
        if (navTarget) {
          const currentPath = new URL(page.url()).pathname.toLowerCase();
          if (currentPath.includes(navTarget)) {
            console.log(`[runStep] Act failed but URL "${currentPath}" already contains "${navTarget}" — treating as successful no-op`);
            return { step, success: true, duration: Date.now() - stepStart, actResult: { success: true, duration: Date.now() - stepStart, pageUrl: page.url() } };
          }
        }
      }

      return { step, success: actResult.success, duration: Date.now() - stepStart, actResult };
    }

    // === CHECK STEP ===

    // Try deterministic text verification first (fast path)
    const deterministicResult = await this.tryDeterministicCheck(page, step, stepStart);
    if (deterministicResult) return deterministicResult;

    // Detect page transition for oracle selection strategy
    const currentUrl = page.url();
    const pageTransitioned = this.preActUrl !== null && currentUrl !== this.preActUrl;

    const checkType = step.checkType ?? "semantic";
    const checkResult = await this.executeCheckWithRetry(
      step.instruction, checkType, page, tester, stagehand, pageTransitioned
    );

    return { step, success: checkResult.passed, duration: Date.now() - stepStart, checkResult };
  }

  /**
   * Try to dismiss a blocking modal/overlay by pressing Escape, then retry the action.
   * Returns the result of the retry, or null if no modal was detected/dismissed.
   */
  private async tryDismissModalAndRetry(
    instruction: string,
    stagehand: Stagehand,
    page: Page
  ): Promise<ActResult | null> {
    try {
      // Press Escape to dismiss any overlay/modal
      await page.keyboard.press('Escape');
      await this.delay(500);

      // Retry the action after dismissal
      const retryResult = await executeActStep(instruction, stagehand);
      if (retryResult.success) {
        console.log(`[executeActWithRetry] Modal dismissed (Escape), retry succeeded for: "${instruction.slice(0, 60)}..."`);
        return retryResult;
      }
    } catch { /* modal dismissal didn't help */ }
    return null;
  }

  /**
   * Execute an Act step with retry logic for transient errors.
   * On final failure, attempts modal dismissal (Escape) before giving up.
   */
  private async executeActWithRetry(
    instruction: string,
    stagehand: Stagehand,
    page: Page
  ): Promise<ActResult> {
    let lastAttempt = 1;
    let lastFailedResult: ActResult | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      lastAttempt = attempt;
      try {
        const result = await executeActStep(instruction, stagehand);
        if (result.success) return result;

        lastFailedResult = result;

        if (result.error && this.isRetryableError(result.error) && attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY);
          continue;
        }

        // Enhance schema/object errors with page context
        if (result.error && /schema|No object generated/i.test(result.error)) {
          lastFailedResult = { ...result, error: await getEnhancedErrorContext(page, instruction, attempt) };
        }
        break; // exit loop → try modal dismissal as last resort
      } catch (error) {
        const rawError = error instanceof Error ? error : new Error(String(error));
        if (this.isRetryableError(rawError.message) && attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY);
          continue;
        }
        let errorMsg: string;
        try { errorMsg = await getEnhancedErrorContext(page, instruction, attempt); }
        catch { errorMsg = rawError.message; }
        lastFailedResult = { success: false, duration: 0, error: errorMsg };
        break; // exit loop → try modal dismissal as last resort
      }
    }

    // All retries exhausted — try dismissing a modal/overlay and retry once
    const modalRetry = await this.tryDismissModalAndRetry(instruction, stagehand, page);
    if (modalRetry) return modalRetry;

    return lastFailedResult ?? {
      success: false,
      duration: 0,
      error: await getEnhancedErrorContext(page, instruction, lastAttempt),
    };
  }

  /**
   * Double-check a semantic failure using stagehand.extract().
   * Returns true if the condition is actually satisfied (b-test false negative).
   */
  private async doubleCheckWithExtract(
    instruction: string,
    stagehand: Stagehand
  ): Promise<boolean> {
    try {
      const schema = z.object({
        passed: z.boolean().describe(
          "true if the condition is satisfied by ANY element currently visible on the page, false only if NO element matches"
        ),
      });
      const enhancedInstruction = `Look at ALL visible elements on the page (buttons, links, text, navigation items, headings, forms). Evaluate whether this condition is satisfied: "${instruction}".

IMPORTANT evaluation rules:
- If the condition uses "or", it passes if ANY part is true
- "navigate the application" means ANY button/link that takes you to different sections (e.g., "Jobs", "Candidates", "Dashboard", "Settings", "Home" are navigation)
- "button to create X" includes buttons like "Create X", "Add X", "New X", or a "+" button
- Be generous in interpretation - if the page has relevant interactive elements, the condition is likely satisfied`;
      const result = await stagehand.extract(enhancedInstruction, schema);
      console.log(`extract() double-check for "${instruction.slice(0, 80)}...": ${result.passed}`);
      return result.passed;
    } catch (error) {
      console.log(`extract() double-check threw: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Execute a Check step with retry logic.
   *
   * Oracle strategy depends on page transition:
   * - Same page: b-test (diff) primary → extract() rescue on failure
   * - Page transition: extract() primary → b-test rescue on failure
   *
   * b-test diffs are unreliable after full page transitions because the entire
   * DOM changes. extract() evaluates current page state directly.
   */
  private async executeCheckWithRetry(
    instruction: string,
    checkType: "deterministic" | "semantic",
    page: Page,
    tester: Tester,
    stagehand: Stagehand,
    pageTransitioned: boolean = false
  ): Promise<CheckResult> {
    let lastAttempt = 1;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      lastAttempt = attempt;
      try {
        if (checkType === "semantic" && pageTransitioned) {
          // Page transition: extract() primary → b-test rescue
          console.log(`Page transitioned (attempt ${attempt}/${MAX_RETRIES}) — extract() primary for: "${instruction.slice(0, 80)}..."`);
          if (await this.doubleCheckWithExtract(instruction, stagehand)) {
            return { passed: true, checkType: "semantic", expected: instruction, actual: "Confirmed by extract() (page transition)" };
          }
          const bTestResult = await executeCheckStep(instruction, checkType, page, tester);
          if (bTestResult.passed) {
            return { passed: true, checkType: "semantic", expected: instruction, actual: "Confirmed by b-test (extract false negative mitigated)" };
          }
          if (attempt < MAX_RETRIES) { await this.delay(RETRY_DELAY); continue; }
          return { ...bTestResult, actual: await getCheckErrorContext(page, instruction, attempt) };
        }

        // Same page: b-test primary → extract() rescue
        const result = await executeCheckStep(instruction, checkType, page, tester);
        if (result.passed) return result;

        if (checkType === "semantic") {
          if (await this.doubleCheckWithExtract(instruction, stagehand)) {
            return { passed: true, checkType: "semantic", expected: instruction, actual: "Confirmed by extract() (b-test false negative mitigated)" };
          }
        }

        if (checkType === "semantic" && attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY);
          continue;
        }

        if (checkType === "semantic") {
          return { ...result, actual: await getCheckErrorContext(page, instruction, attempt) };
        }
        return result;
      } catch (error) {
        const rawError = error instanceof Error ? error : new Error(String(error));
        if (this.isRetryableError(rawError.message) && attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY);
          continue;
        }
        return {
          passed: false,
          checkType,
          expected: instruction,
          actual: await getCheckErrorContext(page, instruction, attempt),
        };
      }
    }

    return {
      passed: false,
      checkType,
      expected: instruction,
      actual: await getCheckErrorContext(page, instruction, lastAttempt),
    };
  }

  /** Check if an error is retryable (transient API errors). */
  private isRetryableError(message: string): boolean {
    return /schema|No object generated|rate|timeout|ECONNRESET|ETIMEDOUT/i.test(message);
  }

  /** Delay helper for retry logic. */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
