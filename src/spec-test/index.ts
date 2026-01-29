import { readFile } from "fs/promises";
import { existsSync, rmSync } from "fs";
import path from "path";
import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { Tester } from "../b-test";

// Re-export all types
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
} from "./types";

import type {
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
} from "./types";

/**
 * Regex pattern to match Act and Check step lines.
 * Captures: (1) step type (Act|Check), (2) instruction text
 */
const STEP_PATTERN = /^\s*\*\s*(Act|Check):\s*(.+)$/;

/**
 * Parses the Steps section from markdown content into an array of executable steps.
 *
 * @param content - Markdown content containing Steps section with Act/Check lines
 * @returns Array of SpecStep objects with type, instruction, and checkType
 */
export function parseSteps(content: string): SpecStep[] {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((line, index): SpecStep[] => {
      const match = line.match(STEP_PATTERN);
      if (!match) return [];

      const [, stepType, rawInstruction] = match;
      const instruction = rawInstruction.trim();
      const lineNumber = index + 1;

      if (stepType === "Act") {
        return [{ type: "act", instruction, lineNumber }];
      }

      return [{
        type: "check",
        instruction,
        checkType: classifyCheck(instruction),
        lineNumber,
      }];
    });
}

/** Regex pattern to extract behavior name from first H1 heading. */
const NAME_PATTERN = /^#\s+(.+)$/m;

/** Regex pattern to extract directory from Directory: line. */
const DIRECTORY_PATTERN = /^Directory:\s*`([^`]+)`/m;

/** Regex pattern to match example headings (H3 in Examples section). */
const EXAMPLE_HEADING_PATTERN = /^###\s+(.+)$/gm;

/**
 * Parses the Examples section from Epic Specification Format.
 *
 * Expected format:
 * ```markdown
 * ## Examples
 *
 * ### Example Name
 *
 * #### Steps
 * * Act: User action description
 * * Check: Expected outcome
 * ```
 *
 * @param content - Full markdown content
 * @returns Array of SpecExample objects with name and steps
 */
export function parseExamples(content: string): SpecExample[] {
  // Find the ## Examples section
  const examplesMatch = content.match(/^## Examples\s*$/m);
  if (!examplesMatch) {
    // Fallback: treat entire content as single unnamed example (legacy format)
    const steps = parseSteps(content);
    if (steps.length > 0) {
      return [{ name: "Default", steps }];
    }
    return [];
  }

  const examplesStart = examplesMatch.index! + examplesMatch[0].length;

  // Find where Examples section ends (next H2 or end of file)
  const nextH2Match = content.slice(examplesStart).match(/^## [^#]/m);
  const examplesEnd = nextH2Match
    ? examplesStart + nextH2Match.index!
    : content.length;

  const examplesContent = content.slice(examplesStart, examplesEnd);
  const lines = examplesContent.split("\n");

  const examples: SpecExample[] = [];
  let currentExample: SpecExample | null = null;
  let inSteps = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // New example: ### Example Name
    if (trimmedLine.startsWith("### ")) {
      // Save previous example if exists
      if (currentExample && currentExample.steps.length > 0) {
        examples.push(currentExample);
      }
      currentExample = {
        name: trimmedLine.slice(4).trim(),
        steps: [],
      };
      inSteps = false;
      continue;
    }

    // Steps section: #### Steps
    if (trimmedLine.toLowerCase() === "#### steps") {
      inSteps = true;
      continue;
    }

    // Another #### section ends steps
    if (trimmedLine.startsWith("#### ") && !trimmedLine.toLowerCase().includes("steps")) {
      inSteps = false;
      continue;
    }

    // Parse step lines: * Act: or * Check:
    if (inSteps && currentExample && trimmedLine.startsWith("* ")) {
      const match = trimmedLine.match(STEP_PATTERN);
      if (match) {
        const [, stepType, rawInstruction] = match;
        const instruction = rawInstruction.trim();

        if (stepType === "Act") {
          currentExample.steps.push({ type: "act", instruction });
        } else {
          currentExample.steps.push({
            type: "check",
            instruction,
            checkType: classifyCheck(instruction),
          });
        }
      }
    }
  }

  // Don't forget the last example
  if (currentExample && currentExample.steps.length > 0) {
    examples.push(currentExample);
  }

  return examples;
}

/**
 * Parses a behavior specification markdown file into a TestableSpec object.
 *
 * Epic Specification Format:
 * - H1 = behavior name
 * - `Directory:` = optional directory path
 * - `## Examples` section contains named examples with `#### Steps`
 *
 * Also supports legacy format with Steps directly in content.
 *
 * @param filePath - Path to a markdown file with behavior specification
 * @returns Promise resolving to TestableSpec with parsed name, directory, and examples
 */
export async function parseSpecFile(filePath: string): Promise<TestableSpec> {
  const content = await readFile(filePath, "utf-8");

  // Extract behavior name from H1
  const nameMatch = content.match(NAME_PATTERN);
  const name = nameMatch?.[1]?.trim() ?? "Unnamed";

  // Extract optional directory
  const dirMatch = content.match(DIRECTORY_PATTERN);
  const directory = dirMatch?.[1]?.trim();

  // Parse examples from Examples section
  const examples = parseExamples(content);

  return { name, directory, examples };
}

/**
 * Deterministic patterns that can be verified with Playwright assertions.
 * Case-insensitive matching.
 */
const DETERMINISTIC_PATTERNS = [
  /^url\s+contains\s+/i,
  /^url\s+is\s+/i,
  /^page\s+title\s+is\s+/i,
  /^page\s+title\s+contains\s+/i,
  /^element\s+count\s+is\s+/i,
  /^input\s+value\s+is\s+/i,
  /^checkbox\s+is\s+checked/i,
];

/**
 * Determines whether a check can be verified deterministically or requires LLM.
 *
 * @param instruction - Natural language check instruction
 * @returns "deterministic" for URL/title/count checks, "semantic" otherwise
 */
export function classifyCheck(instruction: string): "deterministic" | "semantic" {
  const trimmed = instruction.trim();

  for (const pattern of DETERMINISTIC_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "deterministic";
    }
  }
  return "semantic";
}

/**
 * Executes an Act step using Stagehand natural language browser automation.
 *
 * @param instruction - Natural language action instruction
 * @param stagehand - Stagehand instance for browser automation
 * @returns Promise resolving to ActResult with success status, timing, and page state
 */
export async function executeActStep(
  instruction: string,
  stagehand: Stagehand
): Promise<ActResult> {
  const startTime = Date.now();

  try {
    await stagehand.act(instruction);
    const duration = Date.now() - startTime;
    const page = stagehand.context.activePage();
    const pageUrl = page?.url() ?? "";

    return {
      success: true,
      duration,
      pageUrl,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    const page = stagehand.context.activePage();
    const pageSnapshot = page
      ? await page.evaluate(() => document.documentElement.outerHTML)
      : "";
    const observations = await stagehand.observe();
    const availableActions = observations.map((obs) => obs.description);

    return {
      success: false,
      duration,
      error: errorMessage,
      pageSnapshot,
      availableActions,
    };
  }
}

/** Pattern handlers for deterministic checks */
const DETERMINISTIC_HANDLERS: Array<{
  pattern: RegExp;
  getActual: (page: Page) => string | Promise<string>;
  compare: (actual: string, expected: string) => boolean;
}> = [
  {
    pattern: /^url\s+contains\s+(.+)$/i,
    getActual: (page) => page.url(),
    compare: (actual, expected) => actual.includes(expected),
  },
  {
    pattern: /^url\s+is\s+(.+)$/i,
    getActual: (page) => page.url(),
    compare: (actual, expected) => actual === expected,
  },
  {
    pattern: /^page\s+title\s+is\s+(.+)$/i,
    getActual: (page) => page.title(),
    compare: (actual, expected) => actual === expected,
  },
  {
    pattern: /^page\s+title\s+contains\s+(.+)$/i,
    getActual: (page) => page.title(),
    compare: (actual, expected) => actual.includes(expected),
  },
];

/**
 * Executes a Check step using either deterministic Playwright assertions or LLM-powered B-Test.
 *
 * @param instruction - Check instruction to verify
 * @param checkType - "deterministic" or "semantic"
 * @param page - Playwright page instance
 * @param tester - B-Test Tester instance
 * @returns Promise resolving to CheckResult with pass/fail, expected, actual, and reasoning
 */
export async function executeCheckStep(
  instruction: string,
  checkType: "deterministic" | "semantic",
  page: Page,
  tester: Tester
): Promise<CheckResult> {
  if (checkType === "deterministic") {
    return executeDeterministicCheck(instruction, page);
  }
  return executeSemanticCheck(instruction, page, tester);
}

/**
 * Executes a deterministic check using direct page state comparison.
 */
async function executeDeterministicCheck(
  instruction: string,
  page: Page
): Promise<CheckResult> {
  const trimmed = instruction.trim();

  for (const handler of DETERMINISTIC_HANDLERS) {
    const match = trimmed.match(handler.pattern);
    if (match) {
      const expected = match[1].trim();
      const actual = await handler.getActual(page);
      const passed = handler.compare(actual, expected);
      return { passed, checkType: "deterministic", expected, actual };
    }
  }

  return {
    passed: false,
    checkType: "deterministic",
    expected: instruction,
    actual: "Unrecognized check pattern",
    suggestion: "Use patterns like 'URL contains X' or 'Page title is Y'",
  };
}

/**
 * Executes a semantic check using B-Test's LLM-powered assertions.
 *
 * IMPORTANT: Snapshot Lifecycle
 * -----------------------------
 * B-Test's assert() compares a DIFF between "before" and "after" snapshots.
 * This function takes the "after" snapshot and expects that a "before" snapshot
 * already exists from a previous step.
 *
 * The SpecTestRunner manages this lifecycle:
 * 1. Initial snapshot before any steps (becomes first "before")
 * 2. Before each Act step: reset + snapshot (new "before" baseline)
 * 3. Check steps: this function takes "after" snapshot, then asserts
 *
 * Example flow:
 *   Initial: snapshot()       → before = page0
 *   Act: reset + snapshot()   → before = page0 (refreshed baseline)
 *   Act: execute action       → page changes to page1
 *   Check: snapshot()         → after = page1
 *   Check: assert()           → compares page0 vs page1
 *
 * @param instruction - Natural language condition to verify
 * @param page - Playwright page instance
 * @param tester - B-Test Tester instance (must have "before" snapshot set)
 * @returns Promise resolving to CheckResult
 */
async function executeSemanticCheck(
  instruction: string,
  page: Page,
  tester: Tester
): Promise<CheckResult> {
  // Take "after" snapshot - "before" must already exist from SpecTestRunner
  await tester.snapshot(page);
  const passed = await tester.assert(instruction);

  return {
    passed,
    checkType: "semantic",
    expected: instruction,
    actual: passed ? "Condition met" : "Condition not met",
    reasoning: passed
      ? `LLM confirmed: "${instruction}"`
      : `LLM could not confirm: "${instruction}"`,
  };
}

/**
 * Generates rich failure context for agent self-correction.
 *
 * @param page - Current Playwright page state
 * @param step - The step that failed
 * @param error - The error that occurred
 * @returns Promise resolving to FailureContext with snapshot, available actions, and suggestions
 */
export async function generateFailureContext(
  page: Page,
  step: SpecStep,
  error: Error
): Promise<FailureContext> {
  const pageUrl = page.url();
  const pageSnapshot = await page.evaluate(() => document.documentElement.outerHTML);
  const availableElements = await extractInteractiveElements(page);
  const suggestions = generateSuggestions(error, step, availableElements);

  return {
    pageSnapshot,
    pageUrl,
    failedStep: step,
    error: error.message,
    availableElements,
    suggestions,
  };
}

/**
 * Extracts interactive elements from the page for debugging context.
 */
async function extractInteractiveElements(
  page: Page
): Promise<FailureContext["availableElements"]> {
  return page.evaluate(() => {
    const selectors = "button, a, input, select, textarea";
    const elements = document.querySelectorAll(selectors);

    return Array.from(elements).slice(0, 20).map((el) => {
      const tagName = el.tagName.toLowerCase();
      const type = tagName === "a" ? "link" : tagName;
      const text = el.textContent?.trim().slice(0, 50) || "";

      // Build selector
      let selector = tagName;
      if (el.id) {
        selector += `#${el.id}`;
      } else if (el.className && typeof el.className === "string") {
        selector += `.${el.className.split(" ")[0]}`;
      } else if (el.getAttribute("name")) {
        selector += `[name='${el.getAttribute("name")}']`;
      }

      // Extract relevant attributes
      const attributes: Record<string, string> = {};
      for (const attr of ["type", "name", "placeholder", "href", "value"]) {
        const value = el.getAttribute(attr);
        if (value) attributes[attr] = value;
      }

      return {
        type,
        text: text || undefined,
        selector,
        ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
      };
    });
  });
}

/**
 * Generates helpful suggestions based on error type and available elements.
 */
function generateSuggestions(
  error: Error,
  step: SpecStep,
  elements: FailureContext["availableElements"]
): string[] {
  const suggestions: string[] = [];
  const errorLower = error.message.toLowerCase();

  if (errorLower.includes("not found") || errorLower.includes("no element")) {
    suggestions.push(`Element not found for: "${step.instruction}"`);

    const relevantElements = elements.filter((el) =>
      el.type === "button" || el.type === "link"
    );
    if (relevantElements.length > 0) {
      const names = relevantElements.map((el) => el.text || el.selector).slice(0, 5);
      suggestions.push(`Available clickable elements: ${names.join(", ")}`);
    }

    suggestions.push("Try using more specific text or check if element exists");
  }

  if (errorLower.includes("timeout")) {
    suggestions.push("Operation timed out - the element may not be visible or page is still loading");
    suggestions.push("Consider adding a wait step before this action");
    suggestions.push("Check if the page has fully loaded or if there are async operations");
  }

  if (step.type === "check" || errorLower.includes("check") || errorLower.includes("expected")) {
    suggestions.push(`Check failed for: "${step.instruction}"`);
    suggestions.push("Verify the expected condition matches the current page state");
    suggestions.push("Consider rewording the check or using a different assertion");
  }

  if (suggestions.length === 0) {
    suggestions.push(`Step failed: "${step.instruction}"`);
    suggestions.push(`Error: ${error.message}`);
    suggestions.push("Review the page state and try a different approach");
  }

  return suggestions;
}

/**
 * Main class for parsing and executing behavior specifications against a running application.
 *
 * Snapshot Lifecycle Management
 * -----------------------------
 * This runner manages B-Test's snapshot lifecycle to ensure correct diff-based assertions:
 *
 * 1. Before first step: Take initial snapshot (establishes first "before" baseline)
 * 2. Before each Act step: Reset snapshots + take new snapshot (fresh "before" baseline)
 * 3. Execute Act step: Page state changes
 * 4. Check step: executeSemanticCheck takes "after" snapshot, then asserts diff
 *
 * This ensures that semantic checks always compare "state before action" vs "state at check time".
 */
export class SpecTestRunner {
  private config: SpecTestConfig;
  private stagehand: Stagehand | null = null;
  private tester: Tester | null = null;
  private currentSpec: TestableSpec | null = null;

  constructor(config: SpecTestConfig) {
    this.config = config;
  }

  /**
   * Get the cache directory path for Stagehand.
   * Returns undefined if caching is not enabled.
   *
   * @param spec - Optional spec to use for per-spec cache directories
   * @returns Cache directory path or undefined
   */
  private getCacheDir(spec?: TestableSpec): string | undefined {
    if (!this.config.cacheDir) {
      return undefined;
    }

    if (this.config.cachePerSpec && spec) {
      // Sanitize spec name for filesystem: lowercase, replace non-alphanumeric with dash
      const safeName = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return path.join(this.config.cacheDir, safeName);
    }

    return this.config.cacheDir;
  }

  /**
   * Clear the cache directory to force fresh LLM inference.
   * Useful when page structure has changed significantly.
   */
  clearCache(): void {
    if (!this.config.cacheDir) {
      return;
    }

    if (existsSync(this.config.cacheDir)) {
      rmSync(this.config.cacheDir, { recursive: true, force: true });
    }
  }

  /**
   * Initialize Stagehand browser and B-Test tester.
   */
  private async initialize(): Promise<{ stagehand: Stagehand; tester: Tester }> {
    if (this.stagehand && this.tester) {
      return { stagehand: this.stagehand, tester: this.tester };
    }

    // Dynamic import to avoid loading Stagehand at module level
    const { Stagehand } = await import("@browserbasehq/stagehand");
    const { Tester } = await import("../b-test");

    const isLocal = !this.config.browserbaseApiKey;
    const cacheDir = this.getCacheDir(this.currentSpec ?? undefined);

    this.stagehand = new Stagehand({
      env: isLocal ? "LOCAL" : "BROWSERBASE",
      apiKey: this.config.browserbaseApiKey,
      cacheDir, // Pass cache directory for action caching
      localBrowserLaunchOptions: isLocal
        ? { headless: this.config.headless ?? true }
        : undefined,
      ...this.config.stagehandOptions,
    });

    await this.stagehand.init();
    const page = this.stagehand.context.activePage();

    if (!page) {
      throw new Error("Failed to get active page from Stagehand");
    }

    // Tester accepts both Playwright and Stagehand pages via GenericPage interface
    // Only pass aiModel if defined, otherwise let Tester use its default
    this.tester = this.config.aiModel
      ? new Tester(page, this.config.aiModel)
      : new Tester(page);

    return { stagehand: this.stagehand, tester: this.tester };
  }

  /**
   * Run a specification from a markdown file.
   *
   * @param filePath - Path to markdown spec file
   * @param exampleName - Optional example name to run (runs all if not specified)
   */
  async runFromFile(filePath: string, exampleName?: string): Promise<SpecTestResult> {
    const spec = await parseSpecFile(filePath);
    return this.runFromSpec(spec, exampleName);
  }

  /**
   * Run a parsed specification.
   *
   * Runs all examples or a specific example by name.
   *
   * @param spec - Parsed TestableSpec
   * @param exampleName - Optional example name to run (runs all if not specified)
   */
  async runFromSpec(spec: TestableSpec, exampleName?: string): Promise<SpecTestResult> {
    const startTime = Date.now();

    // Set current spec for cache directory resolution before initialize
    this.currentSpec = spec;

    // Filter examples to run
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

    // For backwards compatibility, expose first example's results at top level
    const firstResult = exampleResults[0];

    return {
      success,
      spec,
      exampleResults,
      duration,
      // Deprecated fields for backwards compatibility
      steps: firstResult?.steps ?? [],
      failedAt: firstResult?.failedAt,
    };
  }

  /**
   * Run a single example.
   *
   * Manages the snapshot lifecycle for correct diff-based semantic assertions:
   * - Initial snapshot before any steps
   * - Reset + snapshot before each Act (new baseline)
   * - Check steps take "after" snapshot and assert
   */
  async runExample(example: SpecExample): Promise<ExampleResult> {
    const startTime = Date.now();
    const { stagehand, tester } = await this.initialize();
    const stagehandPage = stagehand.context.activePage();

    if (!stagehandPage) {
      throw new Error("No active page available");
    }

    // Cast Stagehand's Page to Playwright's Page for type compatibility
    const page = stagehandPage as unknown as Page;

    // Navigate to base URL (fresh start for each example)
    await page.goto(this.config.baseUrl);

    // Take initial snapshot - establishes first "before" baseline
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
        const error = new Error(
          step.type === "act"
            ? stepResult.actResult?.error ?? "Act step failed"
            : stepResult.checkResult?.actual ?? "Check step failed"
        );
        const failureContext = await generateFailureContext(page, step, error);

        failedAt = {
          stepIndex: i,
          step,
          context: failureContext,
        };
        break;
      }
    }

    const duration = Date.now() - startTime;

    return {
      example,
      success: !failedAt,
      steps: stepResults,
      duration,
      failedAt,
    };
  }

  /**
   * Execute a single step with context.
   *
   * For Act steps: Resets snapshots and takes a fresh "before" baseline,
   * then executes the action.
   *
   * For Check steps: Delegates to executeCheckStep which takes the "after"
   * snapshot and performs the assertion.
   */
  async runStep(step: SpecStep, context: StepContext): Promise<StepResult> {
    const { page, stagehand, tester } = context;
    const stepStart = Date.now();

    if (step.type === "act") {
      // Before executing Act: reset snapshots and take fresh "before" baseline
      // This ensures the upcoming Check steps compare against pre-action state
      tester.clearSnapshots();
      await tester.snapshot(page);

      const actResult = await executeActStep(step.instruction, stagehand);
      const duration = Date.now() - stepStart;

      return {
        step,
        success: actResult.success,
        duration,
        actResult,
      };
    }

    // Check step: executeCheckStep will take "after" snapshot and assert
    const checkType = step.checkType ?? "semantic";
    const checkResult = await executeCheckStep(
      step.instruction,
      checkType,
      page,
      tester
    );
    const duration = Date.now() - stepStart;

    return {
      step,
      success: checkResult.passed,
      duration,
      checkResult,
    };
  }

  /**
   * Close browser and clean up resources.
   */
  async close(): Promise<void> {
    if (this.stagehand) {
      await this.stagehand.close();
      this.stagehand = null;
    }
    if (this.tester) {
      this.tester.clearSnapshots();
      this.tester = null;
    }
  }
}
