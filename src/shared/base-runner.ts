import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { SpecExample, ExampleResult, BehaviorRunner } from "./types";
import {
  detectPort,
  resetSession,
  navigateToPagePath,
  clearFormFields,
  safeWaitForLoadState,
} from "./session-management";

/** Timeout for browser close operations (ms) */
const CLOSE_TIMEOUT_MS = 10_000;

/**
 * Configuration required by BaseStagehandRunner.
 * Compatible with both SpecTestConfig and AgentTestConfig.
 */
export interface BaseRunnerConfig {
  baseUrl: string;
  stagehandOptions?: Record<string, unknown>;
  browserbaseApiKey?: string;
  headless?: boolean;
  cacheDir?: string;
}

/**
 * Abstract base class for Stagehand-powered test runners.
 *
 * Encapsulates shared concerns:
 * - Docker-compatible Stagehand initialization
 * - Port auto-detection
 * - Session management (clear/navigate/preserve)
 * - Graceful browser cleanup with timeout
 *
 * Subclasses implement `runExample()` with their specific execution strategy.
 */
export abstract class BaseStagehandRunner implements BehaviorRunner {
  protected config: BaseRunnerConfig;
  protected stagehand: Stagehand | null = null;
  protected portDetected = false;

  constructor(config: BaseRunnerConfig) {
    this.config = config;
  }

  /**
   * Initialize Stagehand browser instance (lazy, cached).
   * Includes Docker-compatible configuration (sandbox, executable path).
   */
  protected async initializeStagehand(): Promise<Stagehand> {
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
      cacheDir: this.config.cacheDir,
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
   * Handle session setup: clear/navigate/preserve based on options.
   *
   * - clearSession=true: Hard reset via resetSession()
   * - clearSession=false + navigateToPath: Preserve session, navigate to page
   * - clearSession=false + no path: Keep everything as-is (auth flow continuation)
   */
  protected async manageSession(
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
    const runnerName = this.constructor.name;

    console.log(
      `[${runnerName}] clearSession=${shouldClearSession}, navigateToPath=${options?.navigateToPath ?? "(none)"}, currentUrl=${page.url()}`
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
        `[${runnerName}] Preserving session. Page URL: ${page.url()}`
      );
    }

    if (options?.reloadPage) {
      console.log(`[${runnerName}] Reloading page to clean form state`);
      await page.reload();
      await safeWaitForLoadState(page);
      await clearFormFields(page);
    }
  }

  /** Each runner implements this with their specific execution strategy. */
  abstract runExample(
    example: SpecExample,
    options?: {
      clearSession?: boolean;
      navigateToPath?: string;
      credentials?: { email: string | null; password: string | null };
      reloadPage?: boolean;
    }
  ): Promise<ExampleResult>;

  /** Close browser and clean up resources with timeout. */
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
