import { readFile } from "fs/promises";
import { existsSync, rmSync } from "fs";
import path from "path";
import { z } from "zod";
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
  BehaviorContext,
  BehaviorDependency,
  ChainStep,
  VerificationSummary,
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
  ChainStep,
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

/** Regex pattern to match example/scenario headings (H3 in Examples/Scenarios section). */
const EXAMPLE_HEADING_PATTERN = /^###\s+(.+)$/gm;

/**
 * Parses examples from markdown content.
 *
 * Supports two formats:
 *
 * 1. Epic Format (## Scenarios / ## Examples):
 * ```markdown
 * ## Scenarios
 * ### Scenario Name
 * #### Steps
 * * Act: User action
 * * Check: Expected outcome
 * ```
 *
 * 2. Harbor Format (## Behaviors):
 * ```markdown
 * ## Behaviors
 * ### Behavior Name
 * #### Steps
 * * Act: User action
 * * Check: Expected outcome
 * ```
 * Or with nested scenarios:
 * ```markdown
 * ## Behaviors
 * ### Behavior Name
 * #### Scenarios
 * ##### Scenario Name
 * ###### Steps
 * * Act: User action
 * * Check: Expected outcome
 * ```
 *
 * @param content - Full markdown content
 * @returns Array of SpecExample objects with name and steps
 */
export function parseExamples(content: string): SpecExample[] {
  // Try Epic format first: ## Scenarios or ## Examples
  const examplesMatch = content.match(/^## (?:Scenarios|Examples)\s*$/m);
  if (examplesMatch) {
    return parseEpicExamples(content, examplesMatch);
  }

  // Try Harbor format: ## Behaviors
  const behaviorsMatch = content.match(/^## Behaviors\s*$/m);
  if (behaviorsMatch) {
    return parseHarborBehaviors(content, behaviorsMatch);
  }

  // Fallback: treat entire content as single unnamed example (legacy format)
  const steps = parseSteps(content);
  if (steps.length > 0) {
    return [{ name: "Default", steps }];
  }
  return [];
}

/**
 * Parse Epic format: ## Scenarios/Examples -> ### Scenario -> #### Steps
 */
function parseEpicExamples(content: string, match: RegExpMatchArray): SpecExample[] {
  const examplesStart = match.index! + match[0].length;
  const nextH2Match = content.slice(examplesStart).match(/^## [^#]/m);
  const examplesEnd = nextH2Match
    ? examplesStart + nextH2Match.index!
    : content.length;

  const examplesContent = content.slice(examplesStart, examplesEnd);
  // Calculate line offset: count newlines before examplesStart
  const lineOffset = content.slice(0, examplesStart).split('\n').length;
  return parseExamplesSection(examplesContent, "###", "####", lineOffset);
}

/**
 * Parse Harbor format: ## Behaviors -> ### Behavior -> #### Steps or #### Examples
 */
function parseHarborBehaviors(content: string, match: RegExpMatchArray): SpecExample[] {
  const behaviorsStart = match.index! + match[0].length;
  const nextH2Match = content.slice(behaviorsStart).match(/^## [^#]/m);
  const behaviorsEnd = nextH2Match
    ? behaviorsStart + nextH2Match.index!
    : content.length;

  const behaviorsContent = content.slice(behaviorsStart, behaviorsEnd);
  const lines = behaviorsContent.split("\n");

  // Calculate line offset: count newlines before behaviorsStart
  const lineOffset = content.slice(0, behaviorsStart).split('\n').length;

  const examples: SpecExample[] = [];
  let currentBehavior: string | null = null;
  let currentExample: SpecExample | null = null;
  let collectingSteps = false;
  let inExamplesSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    const lineNumber = lineOffset + i + 1;

    // New behavior: ### Behavior Name
    if (trimmedLine.startsWith("### ") && !trimmedLine.startsWith("#### ")) {
      // Save previous example
      if (currentExample && currentExample.steps.length > 0) {
        examples.push(currentExample);
      }
      currentBehavior = trimmedLine.slice(4).trim();
      currentExample = null;
      collectingSteps = false;
      inExamplesSection = false;
      continue;
    }

    if (!currentBehavior) continue;

    // #### Steps (simple format - behavior has direct steps)
    if (/^#### Steps/i.test(trimmedLine) && !trimmedLine.startsWith("#####")) {
      if (currentExample && currentExample.steps.length > 0) {
        examples.push(currentExample);
      }
      // Extract example name from "#### Steps (Name)" or use behavior name
      const nameMatch = trimmedLine.match(/^#### Steps\s*(?:\(([^)]+)\))?/i);
      const exampleName = nameMatch?.[1]?.trim() || currentBehavior;
      currentExample = { name: exampleName, steps: [] };
      collectingSteps = true;
      inExamplesSection = false;
      continue;
    }

    // #### Scenarios or #### Examples (full format - behavior has nested scenarios)
    if (/^#### (?:Scenarios|Examples)/i.test(trimmedLine)) {
      inExamplesSection = true;
      collectingSteps = false;
      continue;
    }

    // Other #### sections end step collection
    if (trimmedLine.startsWith("#### ") && !trimmedLine.startsWith("#####")) {
      if (currentExample && currentExample.steps.length > 0) {
        examples.push(currentExample);
        currentExample = null;
      }
      collectingSteps = false;
      inExamplesSection = false;
      continue;
    }

    // ##### Example Name (inside #### Examples section)
    if (inExamplesSection && trimmedLine.startsWith("##### ") && !trimmedLine.startsWith("######")) {
      if (currentExample && currentExample.steps.length > 0) {
        examples.push(currentExample);
      }
      currentExample = { name: trimmedLine.slice(6).trim(), steps: [] };
      collectingSteps = false;
      continue;
    }

    // ###### Steps (inside example)
    if (/^###### Steps/i.test(trimmedLine)) {
      collectingSteps = true;
      continue;
    }

    // Parse step lines
    if (collectingSteps && currentExample && trimmedLine.startsWith("* ")) {
      const stepMatch = trimmedLine.match(STEP_PATTERN);
      if (stepMatch) {
        const [, stepType, rawInstruction] = stepMatch;
        const instruction = rawInstruction.trim();

        if (stepType === "Act") {
          currentExample.steps.push({ type: "act", instruction, lineNumber });
        } else {
          currentExample.steps.push({
            type: "check",
            instruction,
            checkType: classifyCheck(instruction),
            lineNumber,
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
 * Helper function to convert title to slug (same as Python slugify)
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parse the ## Pages section to extract page paths for each behavior.
 * Returns a Map of behavior ID (slugified) to page path.
 */
function parsePagePaths(content: string): Map<string, string> {
  const pagePaths = new Map<string, string>();

  const pagesMatch = content.match(/^## Pages/im);
  if (!pagesMatch) {
    return pagePaths;
  }

  const pagesStart = pagesMatch.index! + pagesMatch[0].length;
  const nextH2Match = content.slice(pagesStart).match(/^## [^#]/m);
  const pagesEnd = nextH2Match ? pagesStart + nextH2Match.index! : content.length;
  const pagesContent = content.slice(pagesStart, pagesEnd);

  const lines = pagesContent.split('\n');
  let currentPagePath: string | null = null;
  let inBehaviorsSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Page heading: ### Page Name
    if (trimmed.startsWith('### ') && !trimmed.startsWith('#### ')) {
      currentPagePath = null;
      inBehaviorsSection = false;
      continue;
    }

    // Path line: **Path:** `/route`
    const pathMatch = trimmed.match(/\*\*Path:\*\*\s*`([^`]+)`/);
    if (pathMatch) {
      currentPagePath = pathMatch[1];
      continue;
    }

    // Behaviors section
    if (trimmed.toLowerCase() === '#### behaviors') {
      inBehaviorsSection = true;
      continue;
    }

    // Other #### section ends behaviors
    if (trimmed.startsWith('#### ')) {
      inBehaviorsSection = false;
      continue;
    }

    // Behavior list item
    if (inBehaviorsSection && currentPagePath && trimmed.startsWith('- ')) {
      const behaviorTitle = trimmed.slice(2).trim();
      const behaviorId = slugify(behaviorTitle);
      pagePaths.set(behaviorId, currentPagePath);
    }
  }

  return pagePaths;
}

/**
 * Parse Harbor format with full behavior definitions including dependencies.
 * Returns a Map of behavior ID to HarborBehavior for efficient chain building.
 */
export function parseHarborBehaviorsWithDependencies(
  content: string
): Map<string, import('./types').HarborBehavior> {
  // First, parse page paths
  const pagePaths = parsePagePaths(content);
  const behaviorsMatch = content.match(/^## Behaviors/im);
  if (!behaviorsMatch) {
    return new Map();
  }

  const behaviorsStart = behaviorsMatch.index! + behaviorsMatch[0].length;
  const nextH2Match = content.slice(behaviorsStart).match(/^## [^#]/m);
  const behaviorsEnd = nextH2Match
    ? behaviorsStart + nextH2Match.index!
    : content.length;

  const behaviorsContent = content.slice(behaviorsStart, behaviorsEnd);
  const lines = behaviorsContent.split("\n");

  const lineOffset = content.slice(0, behaviorsStart).split('\n').length;

  const behaviors = new Map<string, import('./types').HarborBehavior>();
  let currentBehavior: import('./types').HarborBehavior | null = null;
  let currentExample: SpecExample | null = null;
  let collectingSteps = false;
  let collectingDependencies = false;
  let inExamplesSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    const lineNumber = lineOffset + i + 1;

    // New behavior: ### Behavior Name
    if (trimmedLine.startsWith("### ") && !trimmedLine.startsWith("#### ")) {
      // Save previous behavior
      if (currentBehavior && currentExample && currentExample.steps.length > 0) {
        currentBehavior.examples.push(currentExample);
      }
      if (currentBehavior) {
        behaviors.set(currentBehavior.id, currentBehavior);
      }

      const title = trimmedLine.slice(4).trim();
      const behaviorId = slugify(title);
      currentBehavior = {
        id: behaviorId,
        title,
        description: '',
        dependencies: [],
        examples: [],
        pagePath: pagePaths.get(behaviorId),
      };
      currentExample = null;
      collectingSteps = false;
      collectingDependencies = false;
      inExamplesSection = false;
      continue;
    }

    if (!currentBehavior) continue;

    // #### Dependencies section
    if (/^#### Dependencies/i.test(trimmedLine) && !trimmedLine.startsWith("#####")) {
      collectingDependencies = true;
      collectingSteps = false;
      inExamplesSection = false;
      continue;
    }

    // Parse dependency lines: "1. Behavior Title" or "1. Behavior Title: Scenario Name"
    if (collectingDependencies && trimmedLine) {
      const depMatch = trimmedLine.match(/^\d+\.\s+(.+)$/);
      if (depMatch) {
        const depText = depMatch[1].trim();
        const colonIndex = depText.indexOf(':');
        if (colonIndex !== -1) {
          const behaviorTitle = depText.slice(0, colonIndex).trim();
          const scenarioName = depText.slice(colonIndex + 1).trim();
          currentBehavior.dependencies.push({
            behaviorId: slugify(behaviorTitle),
            scenarioName: scenarioName || undefined,
          });
        } else {
          currentBehavior.dependencies.push({
            behaviorId: slugify(depText),
          });
        }
        continue;
      }
    }

    // #### Steps (simple format - behavior has direct steps)
    if (/^#### Steps/i.test(trimmedLine) && !trimmedLine.startsWith("#####")) {
      collectingDependencies = false;
      if (currentExample && currentExample.steps.length > 0) {
        currentBehavior.examples.push(currentExample);
      }
      const nameMatch = trimmedLine.match(/^#### Steps\s*(?:\(([^)]+)\))?/i);
      const exampleName = nameMatch?.[1]?.trim() || currentBehavior.title;
      currentExample = { name: exampleName, steps: [] };
      collectingSteps = true;
      inExamplesSection = false;
      continue;
    }

    // #### Scenarios or #### Examples (full format - behavior has nested scenarios)
    if (/^#### (?:Scenarios|Examples)/i.test(trimmedLine)) {
      collectingDependencies = false;
      inExamplesSection = true;
      collectingSteps = false;
      continue;
    }

    // Other #### sections end dependency and step collection
    if (trimmedLine.startsWith("#### ") && !trimmedLine.startsWith("#####")) {
      collectingDependencies = false;
      if (currentExample && currentExample.steps.length > 0) {
        currentBehavior.examples.push(currentExample);
        currentExample = null;
      }
      collectingSteps = false;
      inExamplesSection = false;
      continue;
    }

    // ##### Example Name (inside #### Examples section)
    if (inExamplesSection && trimmedLine.startsWith("##### ") && !trimmedLine.startsWith("######")) {
      if (currentExample && currentExample.steps.length > 0) {
        currentBehavior.examples.push(currentExample);
      }
      currentExample = { name: trimmedLine.slice(6).trim(), steps: [] };
      collectingSteps = false;
      continue;
    }

    // ###### Steps (inside example)
    if (/^###### Steps/i.test(trimmedLine)) {
      collectingSteps = true;
      continue;
    }

    // Parse step lines
    if (collectingSteps && currentExample && trimmedLine.startsWith("* ")) {
      const stepMatch = trimmedLine.match(STEP_PATTERN);
      if (stepMatch) {
        const [, stepType, rawInstruction] = stepMatch;
        const instruction = rawInstruction.trim();

        if (stepType === "Act") {
          currentExample.steps.push({ type: "act", instruction, lineNumber });
        } else {
          currentExample.steps.push({
            type: "check",
            instruction,
            checkType: classifyCheck(instruction),
            lineNumber,
          });
        }
      }
    }

    // Collect description (before any H4 section)
    if (!collectingDependencies && !collectingSteps && !inExamplesSection &&
        !trimmedLine.startsWith("#") && trimmedLine && !currentBehavior.description) {
      currentBehavior.description = trimmedLine;
    }
  }

  // Save last behavior
  if (currentBehavior && currentExample && currentExample.steps.length > 0) {
    currentBehavior.examples.push(currentExample);
  }
  if (currentBehavior) {
    behaviors.set(currentBehavior.id, currentBehavior);
  }

  return behaviors;
}

/**
 * Tracks behavior verification results to enable dependency-aware testing.
 *
 * Features:
 * - Remembers which behaviors passed/failed
 * - Determines if behaviors should be skipped due to failed dependencies
 * - Provides clear failure attribution
 *
 * Usage:
 * ```typescript
 * const context = new VerificationContext();
 *
 * // Mark a behavior result
 * context.markResult('sign-up', {
 *   behaviorId: 'sign-up',
 *   behaviorName: 'Sign Up',
 *   status: 'pass',
 *   duration: 5000
 * });
 *
 * // Check if dependent behavior should skip
 * const { skip, reason } = context.shouldSkip(['sign-up', 'sign-in']);
 * if (skip) {
 *   console.log(`Skipping because: ${reason}`);
 * }
 * ```
 */
export class VerificationContext {
  private results: Map<string, import('./types').BehaviorContext>;

  constructor() {
    this.results = new Map();
  }

  /**
   * Mark a behavior verification result.
   *
   * @param behaviorId - Unique behavior identifier
   * @param result - Verification result context
   */
  markResult(behaviorId: string, result: import('./types').BehaviorContext): void {
    this.results.set(behaviorId, result);
  }

  /**
   * Get the result for a specific behavior.
   *
   * @param behaviorId - Behavior identifier to look up
   * @returns The behavior context if found, undefined otherwise
   */
  getResult(behaviorId: string): import('./types').BehaviorContext | undefined {
    return this.results.get(behaviorId);
  }

  /**
   * Check if a behavior should be skipped due to failed dependencies.
   *
   * @param dependencies - Array of behavior IDs this behavior depends on
   * @returns Object with skip flag and optional reason
   */
  shouldSkip(dependencies: string[]): { skip: boolean; reason?: string } {
    for (const depId of dependencies) {
      const depResult = this.results.get(depId);

      // If dependency hasn't been tested yet, don't skip
      if (!depResult) {
        continue;
      }

      // If dependency didn't pass, skip this behavior
      if (depResult.status !== 'pass') {
        return {
          skip: true,
          reason: `Dependency "${depResult.behaviorName}" failed`
        };
      }
    }

    return { skip: false };
  }

  /**
   * Check if a specific behavior passed verification.
   *
   * @param behaviorId - Behavior identifier to check
   * @returns True if behavior passed, false otherwise
   */
  hasPassed(behaviorId: string): boolean {
    const result = this.results.get(behaviorId);
    return result?.status === 'pass';
  }

  /**
   * Get all tracked results.
   * Useful for generating summaries.
   *
   * @returns Map of all behavior results
   */
  getAllResults(): Map<string, import('./types').BehaviorContext> {
    return new Map(this.results);
  }

  /**
   * Clear all tracked results.
   * Useful for starting a fresh verification run.
   */
  clear(): void {
    this.results.clear();
  }

  /**
   * Get count of behaviors by status.
   *
   * @returns Object with counts for each status
   */
  getStatusCounts(): { pass: number; fail: number; dependency_failed: number } {
    const counts = { pass: 0, fail: 0, dependency_failed: 0 };

    for (const result of this.results.values()) {
      counts[result.status]++;
    }

    return counts;
  }
}

/**
 * Tracks credentials created during Sign Up for reuse in Sign In.
 *
 * Usage:
 * ```typescript
 * const tracker = new CredentialTracker();
 *
 * // During Sign Up execution
 * tracker.captureFromStep('Type "newuser@tasks.com" into the email input field');
 * // Captures: email = "newuser@tasks.com"
 *
 * tracker.captureFromStep('Type "password123" into the password input field');
 * // Captures: password = "password123"
 *
 * // During Sign In execution
 * const updatedStep = tracker.injectIntoStep('Type "user@tasks.com" into the email input field');
 * // Returns: 'Type "newuser@tasks.com" into the email input field'
 *
 * // After behavior chain completes
 * tracker.reset();
 * ```
 */
export class CredentialTracker {
  private credentials: { email: string | null; password: string | null };
  private executionCounter: number;

  constructor() {
    this.credentials = { email: null, password: null };
    this.executionCounter = 0;
  }

  /**
   * Generate a unique email variant to avoid duplicate registration.
   * Appends a numeric suffix before the @ symbol.
   *
   * @param email - Base email address
   * @returns Unique email variant (e.g., "user_3@example.com")
   */
  uniquifyEmail(email: string): string {
    this.executionCounter++;
    const atIndex = email.indexOf('@');
    if (atIndex === -1) return email;
    return `${email.slice(0, atIndex)}_${this.executionCounter}${email.slice(atIndex)}`;
  }

  /**
   * Capture credentials from a Type step instruction.
   * Detects email and password fields, extracts the typed value.
   *
   * @param instruction - Act step instruction (e.g., 'Type "user@test.com" into the email input field')
   */
  captureFromStep(instruction: string): void {
    // Pattern: Type "value" into the [field descriptor]
    // Match both single and double quotes
    const typePattern = /Type\s+["']([^"']+)["']\s+into\s+(?:the\s+)?(.+)/i;
    const match = instruction.match(typePattern);

    if (!match) return;

    const value = match[1].trim();
    const fieldDescriptor = match[2].toLowerCase();

    // Detect email fields
    if (fieldDescriptor.includes('email')) {
      this.credentials.email = value;
      return;
    }

    // Detect password fields
    if (fieldDescriptor.includes('password')) {
      this.credentials.password = value;
      return;
    }
  }

  /**
   * Inject captured credentials into a Sign In step.
   * Replaces hardcoded email/password values with captured ones.
   *
   * @param instruction - Act step instruction with hardcoded credentials
   * @returns Modified instruction with captured credentials, or original if no match
   */
  injectIntoStep(instruction: string): string {
    // Pattern: Type "value" into the [field descriptor]
    const typePattern = /Type\s+["']([^"']+)["']\s+into\s+(?:the\s+)?(.+)/i;
    const match = instruction.match(typePattern);

    if (!match) return instruction;

    const fieldDescriptor = match[2].toLowerCase();
    const originalQuote = instruction.includes('"') ? '"' : "'";

    // Replace email
    if (fieldDescriptor.includes('email') && this.credentials.email) {
      return instruction.replace(
        /Type\s+["']([^"']+)["']/i,
        `Type ${originalQuote}${this.credentials.email}${originalQuote}`
      );
    }

    // Replace password
    if (fieldDescriptor.includes('password') && this.credentials.password) {
      return instruction.replace(
        /Type\s+["']([^"']+)["']/i,
        `Type ${originalQuote}${this.credentials.password}${originalQuote}`
      );
    }

    return instruction;
  }

  /**
   * Check if credentials have been captured.
   *
   * @returns True if both email and password are captured
   */
  hasCredentials(): boolean {
    return this.credentials.email !== null && this.credentials.password !== null;
  }

  /**
   * Get captured credentials (for debugging/logging).
   *
   * @returns Object with email and password (may be null)
   */
  getCredentials(): { email: string | null; password: string | null } {
    return { ...this.credentials };
  }

  /**
   * Reset captured credentials.
   * Call this when starting a new behavior chain.
   */
  reset(): void {
    this.credentials = { email: null, password: null };
  }
}

/**
 * Build the complete dependency chain for a behavior.
 * Returns array of chain steps in execution order (dependencies first, target last).
 * Each step carries the scenario name specified by the dependent behavior.
 *
 * @param targetBehaviorId - The behavior to execute
 * @param allBehaviors - Map of all available behaviors
 * @returns Array of ChainSteps in execution order
 * @throws Error if behavior or any dependency not found
 *
 * @example
 * // For "delete-task" with dependencies: add-task → sign-in → sign-up
 * const chain = buildDependencyChain('delete-task', behaviors);
 * // Returns: [{behavior: sign-up, scenarioName: "User creates a new account"}, ...]
 */
export function buildDependencyChain(
  targetBehaviorId: string,
  allBehaviors: Map<string, import('./types').HarborBehavior>
): ChainStep[] {
  const targetBehavior = allBehaviors.get(targetBehaviorId);

  if (!targetBehavior) {
    throw new Error(`Behavior "${targetBehaviorId}" not found`);
  }

  const chain: ChainStep[] = [];
  const visited = new Set<string>();

  /**
   * Recursively build chain by traversing dependencies depth-first.
   * scenarioName is the scenario requested by the behavior that declared this dependency.
   */
  function buildChainRecursive(behaviorId: string, scenarioName?: string): void {
    // Prevent infinite loops (circular dependencies)
    if (visited.has(behaviorId)) {
      return;
    }
    visited.add(behaviorId);

    const behavior = allBehaviors.get(behaviorId);

    if (!behavior) {
      throw new Error(`Dependency "${behaviorId}" not found for behavior chain`);
    }

    // Process dependencies first (depth-first), propagating their scenario names
    for (const dep of behavior.dependencies) {
      buildChainRecursive(dep.behaviorId, dep.scenarioName);
    }

    // Add this behavior after its dependencies
    chain.push({ behavior, scenarioName });
  }

  buildChainRecursive(targetBehaviorId);

  return chain;
}

/**
 * Process steps for a behavior, handling credential injection.
 *
 * For Sign Up behaviors: Captures credentials from Type steps
 * For Sign In behaviors: Injects captured credentials into Type steps
 * For other behaviors: Returns steps unchanged
 *
 * @param behavior - The behavior being executed
 * @param steps - The steps to process
 * @param credentialTracker - Credential tracker instance
 * @returns Processed steps with credentials injected if applicable
 */
export function processStepsWithCredentials(
  behavior: import('./types').HarborBehavior,
  steps: import('./types').SpecStep[],
  credentialTracker: CredentialTracker
): import('./types').SpecStep[] {
  const behaviorId = behavior.id.toLowerCase();

  // For Sign Up: Generate unique email to avoid duplicate registration
  if (behaviorId.includes('sign-up') || behaviorId.includes('signup')) {
    const typePattern = /Type\s+["']([^"']+)["']\s+into\s+(?:the\s+)?(.+)/i;
    return steps.map(step => {
      if (step.type !== 'act') return step;
      const match = step.instruction.match(typePattern);
      if (!match) return step;
      const fieldDescriptor = match[2].toLowerCase();
      if (fieldDescriptor.includes('email')) {
        const originalEmail = match[1];
        const uniqueEmail = credentialTracker.uniquifyEmail(originalEmail);
        const quote = step.instruction.includes('"') ? '"' : "'";
        return {
          ...step,
          instruction: step.instruction.replace(
            /Type\s+["']([^"']+)["']/i,
            `Type ${quote}${uniqueEmail}${quote}`
          ),
        };
      }
      return step;
    });
  }

  // For all other behaviors: Inject captured credentials into sign-in preamble.
  // Only the first 5 steps are candidates (Navigate, Type email, Type password,
  // Click Sign In). This avoids replacing email/password fields in
  // behavior-specific steps (e.g., candidate email in Add Candidate).
  //
  // Skip injection for behaviors that intentionally test invalid/wrong credentials
  // (e.g., "Invalid Sign In"). These behaviors depend on Sign Up to have a user
  // in the system, but their steps deliberately use wrong credentials.
  if (behaviorId.includes('invalid') || behaviorId.includes('wrong')) {
    return steps;
  }

  if (credentialTracker.hasCredentials()) {
    return steps.map((step, index) => {
      if (step.type === 'act' && index < 5) {
        return {
          ...step,
          instruction: credentialTracker.injectIntoStep(step.instruction),
        };
      }
      return step;
    });
  }

  return steps;
}

/**
 * Calculate reward score from behavior results.
 * Reward = passed behaviors / total behaviors
 *
 * Note: dependency_failed counts as FAIL for scoring purposes.
 *
 * @param results - Array of behavior results
 * @returns Reward score between 0 and 1
 */
export function calculateReward(results: import('./types').BehaviorContext[]): number {
  if (results.length === 0) return 0;

  const passed = results.filter(r => r.status === 'pass').length;
  return passed / results.length;
}

/**
 * Aggregate behavior results into summary statistics.
 *
 * @param results - Array of behavior results
 * @returns Aggregated statistics with counts and reward
 */
export function aggregateResults(results: import('./types').BehaviorContext[]): Omit<import('./types').VerificationSummary, 'summary' | 'behaviors' | 'duration'> {
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const dependency_failed = results.filter(r => r.status === 'dependency_failed').length;

  return {
    passed,
    failed,
    dependency_failed,
    total: results.length,
    reward: calculateReward(results)
  };
}

/**
 * Generate human-readable summary from behavior results.
 *
 * @param results - Array of behavior results
 * @returns Human-readable summary text
 *
 * @example
 * "2 behaviors passed, 1 failed (Sign In), 3 failed due to dependencies"
 */
export function generateSummary(results: import('./types').BehaviorContext[]): string {
  const { passed, failed, dependency_failed } = aggregateResults(results);

  const parts: string[] = [];

  // Passed count
  if (passed === 1) {
    parts.push('1 behavior passed');
  } else {
    parts.push(`${passed} behaviors passed`);
  }

  // Failed count with names
  if (failed > 0) {
    const failedNames = results
      .filter(r => r.status === 'fail')
      .map(r => r.behaviorName)
      .join(', ');

    if (failed === 1) {
      parts.push(`1 failed (${failedNames})`);
    } else {
      parts.push(`${failed} failed (${failedNames})`);
    }
  }

  // Dependency failed count
  if (dependency_failed > 0) {
    if (dependency_failed === 1) {
      parts.push('1 failed due to dependencies');
    } else {
      parts.push(`${dependency_failed} failed due to dependencies`);
    }
  }

  return parts.join(', ');
}

/**
 * Create full verification summary from behavior results.
 *
 * @param results - Array of behavior results
 * @param duration - Total duration in milliseconds
 * @returns Complete verification summary
 */
export function createVerificationSummary(
  results: import('./types').BehaviorContext[],
  duration: number
): import('./types').VerificationSummary {
  const aggregated = aggregateResults(results);

  return {
    ...aggregated,
    summary: generateSummary(results),
    behaviors: results,
    duration
  };
}

/**
 * Verify a behavior along with its full dependency chain.
 * Executes all dependencies first, then the target behavior.
 *
 * @param targetBehavior - The behavior to verify
 * @param allBehaviors - Map of all available behaviors
 * @param context - Verification context for tracking results
 * @param credentialTracker - Credential tracker for Sign Up/Sign In
 * @param runner - SpecTestRunner instance for executing examples
 * @returns Behavior verification result
 */
export async function verifyBehaviorWithDependencies(
  targetBehavior: import('./types').HarborBehavior,
  allBehaviors: Map<string, import('./types').HarborBehavior>,
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: any
): Promise<import('./types').BehaviorContext> {
  const startTime = Date.now();

  // Skip if a dependency already failed as a target behavior — no point
  // re-testing a chain that can't succeed.
  const skipCheck = context.shouldSkip(targetBehavior.dependencies.map(d => d.behaviorId));
  if (skipCheck.skip) {
    return {
      behaviorId: targetBehavior.id,
      behaviorName: targetBehavior.title,
      status: 'dependency_failed',
      failedDependency: skipCheck.reason,
      duration: 0
    };
  }

  // Build full dependency chain
  const chain = buildDependencyChain(targetBehavior.id, allBehaviors);

  // Execute each behavior in the chain from scratch.
  // Every chain runs the full dependency sequence with fresh browser state
  // and unique credentials to guarantee the ideal state for the target behavior.
  for (let chainIndex = 0; chainIndex < chain.length; chainIndex++) {
    const { behavior, scenarioName } = chain[chainIndex];
    const isFirstInChain = chainIndex === 0;

    // Pick scenario by name if specified, otherwise fall back to first example
    const example: SpecExample | undefined = scenarioName
      ? behavior.examples.find((e: SpecExample): boolean => e.name === scenarioName) ?? behavior.examples[0]
      : behavior.examples[0];
    if (!example) {
      return {
        behaviorId: targetBehavior.id,
        behaviorName: targetBehavior.title,
        status: 'fail',
        error: `No examples found for behavior: ${behavior.title}`,
        duration: Date.now() - startTime
      };
    }

    // For chain steps after the first, strip login steps since user is already logged in
    // The first step (usually Sign Up) runs all steps to establish the session
    let stepsToProcess = example.steps;
    if (!isFirstInChain) {
      stepsToProcess = stripLoginSteps(example.steps);
      if (behavior.pagePath) {
        console.log(`Chain step [${behavior.id}]: Navigating to ${behavior.pagePath}, stripped ${example.steps.length - stepsToProcess.length} login steps`);
      } else {
        console.log(`Chain step [${behavior.id}]: Stripped ${example.steps.length - stepsToProcess.length} login steps`);
      }
    }

    // Process steps with credential injection
    const processedSteps = processStepsWithCredentials(
      behavior,
      stepsToProcess,
      credentialTracker
    );

    // Log credential state for diagnostics
    const creds = credentialTracker.getCredentials();
    console.log(`Chain step [${behavior.id}]: email=${creds.email ?? '(none)'}, password=${creds.password ?? '(none)'}`);

    // Execute the example (wrapped in try-catch for browser crashes).
    // Only clear localStorage for the first step of the chain. Subsequent steps
    // preserve localStorage so that app data (user accounts in SPAs) created by
    // earlier steps (e.g., Sign Up) survives into later steps (e.g., Sign In).
    //
    // For non-first chain steps with a page path, we pass the page path to runExample
    // so it navigates directly to that page instead of the base URL.
    const navigateToPath = !isFirstInChain && behavior.pagePath ? behavior.pagePath : undefined;
    const exampleToRun = { ...example, steps: processedSteps };
    let result: import('./types').ExampleResult;
    try {
      result = await runner.runExample(exampleToRun, {
        clearLocalStorage: isFirstInChain,
        navigateToPath,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const behaviorResult: import('./types').BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: 'fail',
        error: `Runner crash: ${errorMessage}`,
        duration: Date.now() - startTime,
      };

      if (behavior.id !== targetBehavior.id) {
        return {
          behaviorId: targetBehavior.id,
          behaviorName: targetBehavior.title,
          status: 'dependency_failed',
          failedDependency: behavior.title,
          duration: Date.now() - startTime,
        };
      }
      return behaviorResult;
    }

    // Capture credentials if this is Sign Up (from processed steps to get uniquified email)
    if (behavior.id.includes('sign-up') || behavior.id.includes('signup')) {
      for (const step of processedSteps) {
        if (step.type === 'act') {
          credentialTracker.captureFromStep(step.instruction);
        }
      }
    }

    // Check if execution succeeded
    if (!result.success) {
      const behaviorResult: import('./types').BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: 'fail',
        error: result.failedAt?.context.error,
        duration: result.duration
      };

      // If this is not the target, the target fails due to dependency
      if (behavior.id !== targetBehavior.id) {
        return {
          behaviorId: targetBehavior.id,
          behaviorName: targetBehavior.title,
          status: 'dependency_failed',
          failedDependency: behavior.title,
          duration: Date.now() - startTime
        };
      }

      // This is the target behavior itself failing
      return {
        behaviorId: targetBehavior.id,
        behaviorName: targetBehavior.title,
        status: 'fail',
        error: result.failedAt?.context.error,
        duration: Date.now() - startTime
      };
    }

  }

  // All behaviors in chain passed
  return {
    behaviorId: targetBehavior.id,
    behaviorName: targetBehavior.title,
    status: 'pass',
    duration: Date.now() - startTime
  };
}

/** Default timeout per behavior in milliseconds (2 minutes) */
const DEFAULT_BEHAVIOR_TIMEOUT_MS = 120_000;

/** Auth behavior IDs that get special sequential handling */
const AUTH_BEHAVIOR_IDS = ['sign-up', 'sign-in', 'invalid-sign-in', 'sign-out'];

/**
 * Check if a behavior ID is an auth behavior.
 */
function isAuthBehavior(behaviorId: string): boolean {
  return AUTH_BEHAVIOR_IDS.includes(behaviorId.toLowerCase());
}

/**
 * Wrap a promise with a timeout.
 * @param promise - Promise to wrap
 * @param ms - Timeout in milliseconds
 * @param timeoutError - Error message on timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutError)), ms)
    ),
  ]);
}

/**
 * Strip login steps from behavior steps.
 * Used when executing chain steps after the first behavior (user is already logged in).
 *
 * Strips:
 * - Navigate to URL (we'll navigate directly to page path instead)
 * - Type email into field
 * - Type password into field
 * - Click Sign In / Login button
 *
 * Keeps:
 * - All Check steps
 * - Navigation button clicks (Jobs, Candidates, etc.)
 * - All other action steps
 */
function stripLoginSteps(steps: SpecStep[]): SpecStep[] {
  return steps.filter(step => {
    // Always keep check steps
    if (step.type === 'check') return true;

    const instruction = step.instruction.toLowerCase();

    // Strip navigation to URL
    if (instruction.includes('navigate to')) {
      return false;
    }

    // Strip email/password typing
    if ((instruction.includes('type') || instruction.includes('enter') || instruction.includes('fill')) &&
        (instruction.includes('email') || instruction.includes('password'))) {
      return false;
    }

    // Strip Sign In / Login button clicks
    if ((instruction.includes('click') || instruction.includes('press')) &&
        (instruction.includes('sign in') || instruction.includes('signin') ||
         instruction.includes('log in') || instruction.includes('login')) &&
        !instruction.includes('sign out') && !instruction.includes('logout')) {
      return false;
    }

    // Keep everything else
    return true;
  });
}

/**
 * Filter steps for Sign Out in auth flow sequence.
 * Since the user is already signed in after Sign Up, we only need to:
 * 1. Click Sign Out button
 * 2. Check sign in form is displayed
 *
 * This is more aggressive than stripLoginSteps - it also removes navigation clicks.
 */
function filterSignOutStepsForAuthFlow(steps: SpecStep[]): SpecStep[] {
  return steps.filter(step => {
    if (step.type === 'check') return true;
    const instruction = step.instruction.toLowerCase();
    // Keep only the Sign Out action
    if (instruction.includes('sign out') || instruction.includes('signout') ||
        instruction.includes('log out') || instruction.includes('logout')) {
      return true;
    }
    // Skip everything else (navigation, login, etc.)
    if (instruction.includes('navigate') ||
        instruction.includes('email') ||
        instruction.includes('password') ||
        instruction.includes('sign in') || instruction.includes('signin') ||
        instruction.includes('log in') || instruction.includes('login')) {
      return false;
    }
    return true;
  });
}

/**
 * Execute a single behavior directly (no dependency chain).
 * Used for the special auth flow where behaviors run in a specific sequence.
 *
 * @param isSignOutAfterSignUp - If true, strips login steps from Sign Out since user is already signed in
 */
async function executeBehaviorDirectly(
  behavior: import('./types').HarborBehavior,
  runner: any,
  credentialTracker: CredentialTracker,
  clearLocalStorage: boolean = true,
  isSignOutAfterSignUp: boolean = false
): Promise<import('./types').BehaviorContext> {
  const startTime = Date.now();

  const example = behavior.examples[0];
  if (!example) {
    return {
      behaviorId: behavior.id,
      behaviorName: behavior.title,
      status: 'fail',
      error: `No examples found for behavior: ${behavior.title}`,
      duration: Date.now() - startTime
    };
  }

  // Get steps, filtering for Sign Out if needed
  let stepsToProcess = example.steps;
  if (isSignOutAfterSignUp && (behavior.id.includes('sign-out') || behavior.id.includes('signout'))) {
    stepsToProcess = filterSignOutStepsForAuthFlow(example.steps);
    console.log(`Auth flow [${behavior.id}]: Filtered to ${stepsToProcess.length} steps (stripped login steps since user is already signed in)`);
  }

  // Process steps with credential handling
  const processedSteps = processStepsWithCredentials(behavior, stepsToProcess, credentialTracker);

  // Log credential state for diagnostics
  const creds = credentialTracker.getCredentials();
  console.log(`Auth flow [${behavior.id}]: email=${creds.email ?? '(none)'}, password=${creds.password ?? '(none)'}`);

  const exampleToRun = { ...example, steps: processedSteps };

  try {
    const result = await runner.runExample(exampleToRun, { clearLocalStorage });

    // Capture credentials if this is Sign Up
    if (behavior.id.includes('sign-up') || behavior.id.includes('signup')) {
      for (const step of processedSteps) {
        if (step.type === 'act') {
          credentialTracker.captureFromStep(step.instruction);
        }
      }
    }

    if (!result.success) {
      return {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: 'fail',
        error: result.failedAt?.context.error,
        duration: result.duration
      };
    }

    return {
      behaviorId: behavior.id,
      behaviorName: behavior.title,
      status: 'pass',
      duration: result.duration
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      behaviorId: behavior.id,
      behaviorName: behavior.title,
      status: 'fail',
      error: `Runner crash: ${errorMessage}`,
      duration: Date.now() - startTime
    };
  }
}

/**
 * Run auth behaviors in a special sequence: Sign Up → Sign Out → Invalid Sign In → Sign In
 *
 * This flow tests all auth behaviors efficiently:
 * 1. Sign Up - creates account and signs in
 * 2. Sign Out - signs out (requires being signed in)
 * 3. Invalid Sign In - tests wrong credentials (requires being signed out)
 * 4. Sign In - tests correct credentials (requires being signed out)
 *
 * Credentials from Sign Up are preserved and injected into Sign In.
 */
async function runAuthBehaviorsSequence(
  allBehaviors: Map<string, import('./types').HarborBehavior>,
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: any,
  behaviorTimeoutMs: number
): Promise<import('./types').BehaviorContext[]> {
  const results: import('./types').BehaviorContext[] = [];

  // Define the auth flow order
  const authOrder = ['sign-up', 'sign-out', 'invalid-sign-in', 'sign-in'];

  // Get behaviors in order (skip if not present)
  const authBehaviors: import('./types').HarborBehavior[] = [];
  for (const id of authOrder) {
    const behavior = allBehaviors.get(id);
    if (behavior) {
      authBehaviors.push(behavior);
    }
  }

  if (authBehaviors.length === 0) {
    return results;
  }

  console.log(`\nRunning auth behaviors in sequence: ${authBehaviors.map(b => b.title).join(' → ')}\n`);

  for (let i = 0; i < authBehaviors.length; i++) {
    const behavior = authBehaviors[i];
    const behaviorStart = Date.now();

    // Only clear localStorage for the first behavior (Sign Up)
    const clearLocalStorage = i === 0;

    // Check if a previous auth behavior failed
    if (i > 0) {
      const signUpResult = context.getResult('sign-up');
      if (signUpResult && signUpResult.status !== 'pass') {
        const failResult: import('./types').BehaviorContext = {
          behaviorId: behavior.id,
          behaviorName: behavior.title,
          status: 'dependency_failed',
          failedDependency: 'Sign Up',
          duration: 0
        };
        context.markResult(behavior.id, failResult);
        results.push(failResult);
        continue;
      }
    }

    try {
      // Sign Out runs after Sign Up, so user is already signed in - strip login steps
      const isSignOutAfterSignUp = behavior.id.includes('sign-out') || behavior.id.includes('signout');

      const result = await withTimeout(
        executeBehaviorDirectly(behavior, runner, credentialTracker, clearLocalStorage, isSignOutAfterSignUp),
        behaviorTimeoutMs,
        `Behavior "${behavior.title}" timed out after ${behaviorTimeoutMs / 1000}s`
      );

      context.markResult(behavior.id, result);
      results.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes('timed out');
      const failResult: import('./types').BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: 'fail',
        error: isTimeout ? errorMessage : `Unexpected error: ${errorMessage}`,
        duration: Date.now() - behaviorStart
      };
      context.markResult(behavior.id, failResult);
      results.push(failResult);
    }
  }

  return results;
}

/**
 * Verify all behaviors from an instruction.md file with dependency tracking.
 *
 * @param instructionPath - Path to instruction.md file
 * @param runner - SpecTestRunner instance
 * @param behaviorTimeoutMs - Timeout per behavior in milliseconds (default: 2 minutes)
 * @returns Complete verification summary
 */
export async function verifyAllBehaviors(
  instructionPath: string,
  runner: any,
  behaviorTimeoutMs: number = DEFAULT_BEHAVIOR_TIMEOUT_MS
): Promise<import('./types').VerificationSummary> {
  const startTime = Date.now();

  // 1. Parse instruction with dependencies
  const content = await readFile(instructionPath, 'utf-8');
  const allBehaviors = parseHarborBehaviorsWithDependencies(content);

  // 2. Initialize context and credential tracker
  const context = new VerificationContext();
  const credentialTracker = new CredentialTracker();

  // 3. Run auth behaviors first in special sequence
  // Auth flow: Sign Up → Sign Out → Invalid Sign In → Sign In
  const authResults = await runAuthBehaviorsSequence(
    allBehaviors,
    context,
    credentialTracker,
    runner,
    behaviorTimeoutMs
  );

  // 4. Verify non-auth behaviors with full dependency chain
  const nonAuthResults: import('./types').BehaviorContext[] = [];
  for (const behavior of allBehaviors.values()) {
    // Skip auth behaviors (already handled)
    if (isAuthBehavior(behavior.id)) {
      continue;
    }

    // Reset credentials for each behavior chain
    credentialTracker.reset();

    const behaviorStart = Date.now();
    try {
      const result = await withTimeout(
        verifyBehaviorWithDependencies(
          behavior,
          allBehaviors,
          context,
          credentialTracker,
          runner
        ),
        behaviorTimeoutMs,
        `Behavior "${behavior.title}" timed out after ${behaviorTimeoutMs / 1000}s`
      );

      context.markResult(behavior.id, result);
      nonAuthResults.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes('timed out');
      const failResult: import('./types').BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: 'fail',
        error: isTimeout ? errorMessage : `Unexpected error: ${errorMessage}`,
        duration: Date.now() - behaviorStart,
      };
      context.markResult(behavior.id, failResult);
      nonAuthResults.push(failResult);
    }
  }

  // 5. Combine results (auth first, then non-auth)
  const results = [...authResults, ...nonAuthResults];

  // 6. Create summary
  const duration = Date.now() - startTime;
  return createVerificationSummary(results, duration);
}

/**
 * Parse examples section with configurable heading levels.
 */
function parseExamplesSection(
  content: string,
  exampleHeading: string,
  stepsHeading: string,
  lineOffset: number = 0
): SpecExample[] {
  const lines = content.split("\n");
  const examples: SpecExample[] = [];
  let currentExample: SpecExample | null = null;
  let inSteps = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    const lineNumber = lineOffset + i + 1;

    // New example
    if (trimmedLine.startsWith(exampleHeading + " ")) {
      if (currentExample && currentExample.steps.length > 0) {
        examples.push(currentExample);
      }
      currentExample = {
        name: trimmedLine.slice(exampleHeading.length + 1).trim(),
        steps: [],
      };
      inSteps = false;
      continue;
    }

    // Steps section
    if (trimmedLine.toLowerCase() === stepsHeading.toLowerCase() + " steps") {
      inSteps = true;
      continue;
    }

    // Another section at same level ends steps
    if (trimmedLine.startsWith(stepsHeading + " ") && !trimmedLine.toLowerCase().includes("steps")) {
      inSteps = false;
      continue;
    }

    // Parse step lines
    if (inSteps && currentExample && trimmedLine.startsWith("* ")) {
      const match = trimmedLine.match(STEP_PATTERN);
      if (match) {
        const [, stepType, rawInstruction] = match;
        const instruction = rawInstruction.trim();

        if (stepType === "Act") {
          currentExample.steps.push({ type: "act", instruction, lineNumber });
        } else {
          currentExample.steps.push({
            type: "check",
            instruction,
            checkType: classifyCheck(instruction),
            lineNumber,
          });
        }
      }
    }
  }

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
    let pageSnapshot = "";
    let availableActions: string[] = [];

    // Wrap diagnostic calls in try/catch to prevent them from masking the original error
    try {
      pageSnapshot = page
        ? await page.evaluate(() => document.documentElement.outerHTML)
        : "";
    } catch {
      // Ignore page snapshot errors
    }

    try {
      const observations = await stagehand.observe();
      availableActions = observations.map((obs) => obs.description);
    } catch {
      // Ignore observe errors during error recovery
    }

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

  // Enhance instruction with semantic interpretation hints
  const enhancedInstruction = `${instruction}

(INTERPRETATION: "navigate the application" = any button/link to app sections like Jobs, Candidates, Dashboard. "create X" = buttons like Create/Add/New. Use "or" generously - if ANY part is true, pass.)`;

  const passed = await tester.assert(enhancedInstruction);

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
  const errorMessage = error.message;
  const isElementNotFound = errorMessage.includes('Element not found') ||
                            errorMessage.includes('No object generated') ||
                            errorMessage.includes('Could not locate') ||
                            errorMessage.includes('schema') ||
                            errorMessage.includes('not found') ||
                            errorMessage.includes('no element');
  const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('timed out');
  const isPageStateIssue = errorMessage.includes('Unexpected page state') ||
                            errorMessage.includes('login page') ||
                            errorMessage.includes('session may have expired') ||
                            errorMessage.includes('WARNING: Page appears to be');

  // Page state issues take priority - they explain the root cause
  if (isPageStateIssue) {
    return [
      'The page is in an unexpected state (likely redirected to login)',
      'Check if the application properly persists user sessions',
      'Verify modals and dialogs don\'t close unexpectedly on interactions',
      'The application may have a session timeout or auth issue',
      'Check for JavaScript errors that might cause unexpected navigation',
    ];
  }

  if (isElementNotFound) {
    const instructionLower = step.instruction.toLowerCase();

    if (step.type === 'act') {
      // Action step - element to interact with not found
      if (instructionLower.includes('click')) {
        const suggestions = [
          'The button or clickable element was not found on the page',
          'Verify the button exists and has the expected label',
        ];
        if (elements.length > 0) {
          const names = elements.filter(el => el.type === 'button' || el.type === 'link')
            .map(el => el.text || el.selector).slice(0, 5);
          if (names.length > 0) {
            suggestions.push(`Available clickable elements: ${names.join(', ')}`);
          }
        }
        suggestions.push('The feature may not be implemented in the application');
        return suggestions;
      }
      if (instructionLower.includes('select') ||
          instructionLower.includes('dropdown') ||
          instructionLower.includes('change') ||
          instructionLower.includes('choose')) {
        return [
          'The dropdown or select element was not found or is not interactive',
          'Verify the form includes this field with proper accessibility',
          'Check if the dropdown/select needs to be opened first',
          'The select element may use a custom component that\'s hard to automate',
          'Consider using standard HTML select elements for better testability',
        ];
      }
      if (instructionLower.includes('fill') ||
          instructionLower.includes('type') ||
          instructionLower.includes('enter')) {
        return [
          'The input field was not found on the page',
          'Verify the form includes this field with the expected label',
          'Check if the form or modal is visible and not hidden',
          'The field may not be implemented in the application',
        ];
      }
      return [
        'The UI element for this action was not found',
        'Verify the element exists with the expected label or identifier',
        'Check if the page state is what you expect (not on wrong page)',
        'This feature may not be implemented in the application',
      ];
    } else {
      // Check step - expected content not found
      return [
        'The expected content or element was not found on the page',
        'The application may not be displaying the expected data',
        'Verify the previous action completed successfully',
        'Check if you\'re on the correct page (URL/title in error)',
        'This feature may not be implemented correctly',
      ];
    }
  }

  if (isTimeout) {
    return [
      'The operation timed out waiting for a response',
      'The page may be slow to load or unresponsive',
      'Check for JavaScript errors in the application',
      'Consider if the application is properly running',
    ];
  }

  // Generic suggestions
  return [
    'Check if the page is fully loaded',
    'Verify the element or feature exists in the application',
    'Check the current page URL/title to ensure correct page state',
    'Review the application implementation for this feature',
  ];
}

/** Max retries for transient API errors */
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

/**
 * Get enhanced error context from the current page state.
 * Includes page title, URL, warnings for unexpected states, and visible elements.
 */
async function getEnhancedErrorContext(
  page: Page,
  instruction: string,
  attempt: number
): Promise<string> {
  let pageContext = '';
  let pageStateWarning = '';
  let visibleElements = '';

  try {
    const currentUrl = page.url();
    const title = await page.title();
    pageContext = ` Current page: "${title}" (${currentUrl}).`;

    // Detect common unexpected page states
    const lowerTitle = title.toLowerCase();
    const lowerUrl = currentUrl.toLowerCase();

    if (lowerTitle.includes('sign in') || lowerTitle.includes('login') ||
        lowerUrl.includes('/login') || lowerUrl.includes('/signin') ||
        lowerUrl.includes('/auth')) {
      pageStateWarning = ' WARNING: Page appears to be a login/sign-in page - the session may have expired or the user was logged out unexpectedly.';
    } else if (lowerTitle.includes('error') || lowerTitle.includes('404') || lowerTitle.includes('not found')) {
      pageStateWarning = ' WARNING: Page appears to be an error page - navigation may have failed.';
    }

    // Get visible interactive elements for debugging
    const elements = await page.evaluate(() => {
      const interactiveSelectors = 'button, a, input, select, [role="button"], [onclick]';
      const els = Array.from(document.querySelectorAll(interactiveSelectors));
      return els.slice(0, 10).map(el => {
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || '').trim().slice(0, 30);
        const type = el.getAttribute('type') || '';
        const role = el.getAttribute('role') || '';
        const placeholder = el.getAttribute('placeholder') || '';

        let desc = tag;
        if (type) desc += `[type=${type}]`;
        if (role) desc += `[role=${role}]`;
        if (text) desc += `: "${text}"`;
        else if (placeholder) desc += `: "${placeholder}"`;

        return desc;
      });
    });

    if (elements.length > 0) {
      visibleElements = ` Visible elements: [${elements.join(', ')}].`;
    }
  } catch {
    // Ignore errors getting page context
  }

  return `Act failed: Could not execute "${instruction}".${pageContext}${pageStateWarning}${visibleElements} The target element may not exist, have a different label, or the page state changed unexpectedly. (Attempted ${attempt}/${MAX_RETRIES} retries)`;
}

/**
 * Build error context for Check step failures.
 * Uses "Check failed" prefix instead of "Element not found" to distinguish from Act failures.
 */
async function getCheckErrorContext(
  page: Page,
  instruction: string,
  attempt: number
): Promise<string> {
  let pageContext = '';
  let visibleElements = '';

  try {
    const currentUrl = page.url();
    const title = await page.title();
    pageContext = ` Current page: "${title}" (${currentUrl}).`;

    const elements = await page.evaluate(() => {
      const interactiveSelectors = 'button, a, input, select, [role="button"], [onclick]';
      const els = Array.from(document.querySelectorAll(interactiveSelectors));
      return els.slice(0, 10).map(el => {
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || '').trim().slice(0, 30);
        const type = el.getAttribute('type') || '';
        const placeholder = el.getAttribute('placeholder') || '';

        let desc = tag;
        if (type) desc += `[type=${type}]`;
        if (text) desc += `: "${text}"`;
        else if (placeholder) desc += `: "${placeholder}"`;

        return desc;
      });
    });

    if (elements.length > 0) {
      visibleElements = ` Visible elements: [${elements.join(', ')}].`;
    }
  } catch {
    // Ignore errors getting page context
  }

  return `Check failed: "${instruction}" was not satisfied.${pageContext}${visibleElements} (Attempted ${attempt}/${MAX_RETRIES} retries)`;
}

/**
 * Check if an instruction is a navigation action (e.g., "Navigate to http://...")
 * Returns the URL if found, null otherwise.
 */
function isNavigationAction(instruction: string): string | null {
  // First, try to extract URL directly from instruction
  const urlMatch = instruction.match(/(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    return urlMatch[1].trim();
  }

  // Fallback patterns for relative paths
  const patterns = [
    /^navigate\s+to\s+(.+)$/i,
    /^go\s+to\s+(.+)$/i,
    /^open\s+(.+)$/i,
    /^visit\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = instruction.match(pattern);
    if (match) {
      const path = match[1].trim();
      // Only return if it looks like a path (starts with /)
      if (path.startsWith('/')) {
        return path;
      }
    }
  }
  return null;
}

/**
 * Check if instruction is a page refresh action.
 */
function isRefreshAction(instruction: string): boolean {
  const patterns = [
    /refresh\s+(?:the\s+)?page/i,
    /reload\s+(?:the\s+)?page/i,
    /^refresh$/i,
    /^reload$/i,
  ];
  return patterns.some(pattern => pattern.test(instruction));
}

/**
 * Extract quoted text from a check instruction for direct verification.
 * Returns null if no quoted text found.
 */
function extractExpectedText(instruction: string): { text: string; shouldExist: boolean } | null {
  const patterns = [
    /(?:the\s+text\s+)?["']([^"']+)["']\s+(?:no\s+longer\s+)?appears/i,
    /(?:should\s+)?(?:see|show|display|contain)\s+["']([^"']+)["']/i,
    /["']([^"']+)["']\s+(?:is\s+)?(?:no\s+longer\s+)?(?:visible|shown|displayed)/i,
  ];

  for (const pattern of patterns) {
    const match = instruction.match(pattern);
    if (match) {
      const shouldExist = !instruction.toLowerCase().includes('no longer') &&
                          !instruction.toLowerCase().includes('not ') &&
                          !instruction.toLowerCase().includes("doesn't") &&
                          !instruction.toLowerCase().includes("does not");
      return { text: match[1], shouldExist };
    }
  }
  return null;
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
 *
 * Error Handling
 * --------------
 * The runner includes robust error handling for Docker/CI environments:
 * - Retry logic (3 retries) for transient Stagehand AI errors
 * - Direct page.goto() for navigation actions (more reliable than AI)
 * - Direct text verification via page.locator() for simple checks
 * - Docker-compatible Chromium flags when running in containers
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
   *
   * Includes Docker-compatible configuration:
   * - disablePino: true (pino logger uses thread-stream which doesn't work in Bun binaries)
   * - chromiumSandbox: false when running in Docker (required when running as root)
   * - Docker-compatible Chromium flags: --no-sandbox, --disable-setuid-sandbox, etc.
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

    // Detect if running in Docker (no sandbox needed, typically running as root)
    const executablePath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    const isDocker = !!executablePath || process.getuid?.() === 0;

    // Build local browser options with Docker compatibility
    const localBrowserOptions = isLocal ? {
      headless: this.config.headless ?? true,
      ...(executablePath && { executablePath }),
      // Disable Chromium sandbox in Docker (required when running as root)
      chromiumSandbox: isDocker ? false : undefined,
      // Additional args for Docker environment
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
      cacheDir, // Pass cache directory for action caching
      // Disable pino logger - it uses thread-stream which doesn't work in Bun binaries
      disablePino: true,
      localBrowserLaunchOptions: localBrowserOptions,
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
  async runExample(example: SpecExample, options?: {
    clearLocalStorage?: boolean;
    /** Navigate to this path instead of base URL (for chain steps) */
    navigateToPath?: string;
  }): Promise<ExampleResult> {
    const startTime = Date.now();

    try {
      const { stagehand, tester } = await this.initialize();
      const stagehandPage = stagehand.context.activePage();

      if (!stagehandPage) {
        throw new Error("No active page available");
      }

      // Cast Stagehand's Page to Playwright's Page for type compatibility
      const page = stagehandPage as unknown as Page;

      // Clear browser state so each example starts with a fresh session.
      // This prevents session carry-over between chain steps (e.g., Sign Up
      // logging the user in, which would cause Sign In to land on the tasks
      // page instead of the login page).
      //
      // localStorage is only cleared when clearLocalStorage is true (default).
      // Within a dependency chain, subsequent steps preserve localStorage to
      // keep app data (e.g., user accounts in SPA apps) created by earlier steps.
      const shouldClearLocalStorage = options?.clearLocalStorage !== false;
      try {
        const browserContext = page.context();
        await browserContext.clearCookies();
        await page.evaluate((clearLS) => {
          if (clearLS) {
            try { localStorage.clear(); } catch {}
          }
          try { sessionStorage.clear(); } catch {}
        }, shouldClearLocalStorage);
      } catch {
        // Ignore errors clearing state - page may not be ready yet
      }

      // Navigate to target URL
      // For chain steps, navigate directly to the behavior's page path
      // This avoids redundant navigation through the login flow
      const targetUrl = options?.navigateToPath
        ? `${this.config.baseUrl.replace(/\/$/, '')}${options.navigateToPath}`
        : this.config.baseUrl;
      await page.goto(targetUrl);

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
    } catch (error) {
      // Catch-all for browser crashes, initialization failures, navigation errors
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const fallbackStep = example.steps[0] ?? { type: "act" as const, instruction: "initialize" };

      return {
        example,
        success: false,
        steps: [],
        duration,
        failedAt: {
          stepIndex: 0,
          step: fallbackStep,
          context: {
            pageSnapshot: "",
            pageUrl: "",
            failedStep: fallbackStep,
            error: errorMessage,
            availableElements: [],
            suggestions: ["Browser or page initialization failed - check browser availability"],
          },
        },
      };
    }
  }

  /**
   * Execute a single step with context.
   *
   * For Act steps: Resets snapshots and takes a fresh "before" baseline,
   * then executes the action. Includes:
   * - Direct page.goto() for navigation actions (more reliable)
   * - Direct page.reload() for refresh actions
   * - Retry logic (3 retries) for transient Stagehand errors
   *
   * For Check steps: Tries direct text verification first via page.locator(),
   * then uses semantic checks with page-transition-aware oracle selection.
   */
  async runStep(step: SpecStep, context: StepContext): Promise<StepResult> {
    const { page, stagehand, tester } = context;
    const stepStart = Date.now();

    if (step.type === "act") {
      // Capture URL before action for page-transition detection
      this.preActUrl = page.url();

      // Before executing Act: reset snapshots and take fresh "before" baseline
      // This ensures the upcoming Check steps compare against pre-action state
      tester.clearSnapshots();
      await tester.snapshot(page);

      // Try direct navigation first (more reliable than Stagehand for URLs)
      const navUrl = isNavigationAction(step.instruction);
      if (navUrl) {
        try {
          await page.goto(navUrl);
          await page.waitForLoadState('networkidle');
          const duration = Date.now() - stepStart;
          return {
            step,
            success: true,
            duration,
            actResult: { success: true, duration, pageUrl: page.url() },
          };
        } catch (error) {
          const duration = Date.now() - stepStart;
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            step,
            success: false,
            duration,
            actResult: { success: false, duration, error: errorMessage },
          };
        }
      }

      // Try direct page refresh
      if (isRefreshAction(step.instruction)) {
        try {
          await page.reload();
          await page.waitForLoadState('networkidle');
          const duration = Date.now() - stepStart;
          return {
            step,
            success: true,
            duration,
            actResult: { success: true, duration, pageUrl: page.url() },
          };
        } catch (error) {
          const duration = Date.now() - stepStart;
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            step,
            success: false,
            duration,
            actResult: { success: false, duration, error: errorMessage },
          };
        }
      }

      // Use Stagehand for other actions with retry logic
      const actResult = await this.executeActWithRetry(step.instruction, stagehand, page);
      const duration = Date.now() - stepStart;

      return {
        step,
        success: actResult.success,
        duration,
        actResult,
      };
    }

    // Check step: try direct text verification first
    const textCheck = extractExpectedText(step.instruction);
    if (textCheck) {
      try {
        const escapedText = textCheck.text.replace(/"/g, '\\"');
        const locator = page.locator(`text="${escapedText}"`);
        const count = await locator.count();
        const exists = count > 0;
        const passed = textCheck.shouldExist ? exists : !exists;
        const duration = Date.now() - stepStart;

        return {
          step,
          success: passed,
          duration,
          checkResult: {
            passed,
            checkType: "deterministic",
            expected: step.instruction,
            actual: exists ? `Found "${textCheck.text}" on page` : `Text "${textCheck.text}" not found`,
          },
        };
      } catch {
        // Fall through to semantic check on error
      }
    }

    // Detect page transition: URL changed since the last Act step
    const currentUrl = page.url();
    const pageTransitioned = this.preActUrl !== null && currentUrl !== this.preActUrl;

    // Semantic check with retry logic
    const checkType = step.checkType ?? "semantic";
    const checkResult = await this.executeCheckWithRetry(
      step.instruction,
      checkType,
      page,
      tester,
      stagehand,
      pageTransitioned
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
   * Execute an Act step with retry logic for transient errors.
   * Enhanced with rich error context including page state and visible elements.
   */
  private async executeActWithRetry(
    instruction: string,
    stagehand: Stagehand,
    page: Page
  ): Promise<ActResult> {
    let lastError: Error | undefined;
    let lastAttempt = 1;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      lastAttempt = attempt;
      try {
        const result = await executeActStep(instruction, stagehand);
        if (result.success) {
          return result;
        }
        // If not successful but no exception, check if it's retryable
        if (result.error && this.isRetryableError(result.error)) {
          lastError = new Error(result.error);
          if (attempt < MAX_RETRIES) {
            await this.delay(RETRY_DELAY);
            continue;
          }
        }
        // Not retryable or last attempt - enhance the error
        if (result.error && (result.error.includes('schema') || result.error.includes('No object generated'))) {
          const enhancedError = await getEnhancedErrorContext(page, instruction, attempt);
          return { ...result, error: enhancedError };
        }
        return result;
      } catch (error) {
        const rawError = error instanceof Error ? error : new Error(String(error));
        if (this.isRetryableError(rawError.message) && attempt < MAX_RETRIES) {
          lastError = rawError;
          await this.delay(RETRY_DELAY);
          continue;
        }
        // Return failure result instead of throwing
        let errorMsg: string;
        try {
          errorMsg = await getEnhancedErrorContext(page, instruction, attempt);
        } catch {
          errorMsg = rawError.message;
        }
        return {
          success: false,
          duration: 0,
          error: errorMsg,
        };
      }
    }

    // Final failure - get enhanced context
    const enhancedError = await getEnhancedErrorContext(page, instruction, lastAttempt);
    return {
      success: false,
      duration: 0,
      error: enhancedError,
    };
  }

  /**
   * Double-check a semantic failure using stagehand.extract() with a boolean zod schema.
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
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`extract() double-check threw: ${msg}`);
      return false;
    }
  }

  /**
   * Execute a Check step with retry logic for transient errors.
   *
   * Strategy depends on whether the page transitioned (URL changed):
   * - Same page: b-test (diff) primary → extract() rescue on failure
   * - Page transition: extract() primary → b-test rescue on failure
   *
   * b-test diffs are unreliable after full page transitions because the entire
   * DOM changes and the LLM can't confirm specific elements from the diff.
   * extract() evaluates current page state directly, making it ideal for
   * post-navigation checks like "the dashboard shows a Create button".
   */
  private async executeCheckWithRetry(
    instruction: string,
    checkType: "deterministic" | "semantic",
    page: Page,
    tester: Tester,
    stagehand: Stagehand,
    pageTransitioned: boolean = false
  ): Promise<CheckResult> {
    let lastError: Error | undefined;
    let lastAttempt = 1;

    let lastFailResult: CheckResult | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      lastAttempt = attempt;
      try {
        // For page transitions, use extract() as primary oracle
        if (checkType === "semantic" && pageTransitioned) {
          console.log(`Page transitioned (attempt ${attempt}/${MAX_RETRIES}) — using extract() as primary for: "${instruction.slice(0, 80)}..."`);
          const extractPassed = await this.doubleCheckWithExtract(instruction, stagehand);
          if (extractPassed) {
            return {
              passed: true,
              checkType: "semantic",
              expected: instruction,
              actual: "Condition confirmed by extract() (page transition — extract primary)",
            };
          }

          // extract() said fail — double-check with b-test before confirming
          const bTestResult = await executeCheckStep(instruction, checkType, page, tester);
          if (bTestResult.passed) {
            return {
              passed: true,
              checkType: "semantic",
              expected: instruction,
              actual: "Condition confirmed by b-test (extract false negative mitigated)",
            };
          }

          // Both agree on failure — retry if attempts remain
          lastFailResult = bTestResult;
          if (attempt < MAX_RETRIES) {
            console.log(`Both oracles failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
            await this.delay(RETRY_DELAY);
            continue;
          }

          const errorContext = await getCheckErrorContext(page, instruction, attempt);
          return { ...bTestResult, actual: errorContext };
        }

        // Same-page flow: b-test primary → extract() rescue
        const result = await executeCheckStep(instruction, checkType, page, tester);

        if (result.passed) return result;

        // Double-check semantic failures with extract()
        if (checkType === "semantic") {
          const extractConfirm = await this.doubleCheckWithExtract(instruction, stagehand);
          if (extractConfirm) {
            return {
              passed: true,
              checkType: "semantic",
              expected: instruction,
              actual: "Condition confirmed by extract() (b-test false negative mitigated)",
            };
          }
        }

        // Both failed — retry if attempts remain
        lastFailResult = result;
        if (checkType === "semantic" && attempt < MAX_RETRIES) {
          console.log(`Both oracles failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
          await this.delay(RETRY_DELAY);
          continue;
        }

        if (checkType === "semantic") {
          const errorContext = await getCheckErrorContext(page, instruction, attempt);
          return { ...result, actual: errorContext };
        }
        return result;
      } catch (error) {
        const rawError = error instanceof Error ? error : new Error(String(error));
        if (this.isRetryableError(rawError.message) && attempt < MAX_RETRIES) {
          lastError = rawError;
          await this.delay(RETRY_DELAY);
          continue;
        }
        const errorContext = await getCheckErrorContext(page, instruction, attempt);
        return {
          passed: false,
          checkType,
          expected: instruction,
          actual: errorContext,
        };
      }
    }

    // Final failure after all retries
    const errorContext = await getCheckErrorContext(page, instruction, lastAttempt);
    return {
      passed: false,
      checkType,
      expected: instruction,
      actual: errorContext,
    };
  }

  /**
   * Check if an error is retryable (transient API errors).
   */
  private isRetryableError(message: string): boolean {
    return message.includes('schema') ||
           message.includes('No object generated') ||
           message.includes('rate') ||
           message.includes('timeout') ||
           message.includes('ECONNRESET') ||
           message.includes('ETIMEDOUT');
  }

  /**
   * Delay helper for retry logic.
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Close browser and clean up resources.
   * Includes a timeout to prevent hanging in Docker environments.
   */
  async close(): Promise<void> {
    if (this.stagehand) {
      try {
        // Close with timeout - Stagehand may hang on close in Docker
        await Promise.race([
          this.stagehand.close(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 10000))
        ]);
      } catch {
        // Timeout reached or error, continue anyway
      }
      this.stagehand = null;
    }
    if (this.tester) {
      this.tester.clearSnapshots();
      this.tester = null;
    }
  }
}
