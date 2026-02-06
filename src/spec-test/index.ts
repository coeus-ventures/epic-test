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

// ============================================================================
// PARSING
// ============================================================================

/**
 * Regex pattern to match Act and Check step lines.
 * Captures: (1) step type (Act|Check), (2) instruction text
 */
const STEP_PATTERN = /^\s*\*\s*(Act|Check):\s*(.+)$/;

/**
 * Parses the Steps section from markdown content into an array of executable steps.
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

/**
 * Parses examples from markdown content.
 *
 * Supports:
 * 1. Epic Format (## Scenarios / ## Examples) → ### Scenario → #### Steps
 * 2. Harbor Format (## Behaviors) → ### Behavior → #### Steps (or nested #### Scenarios)
 * 3. Legacy fallback: treat entire content as single example
 */
export function parseExamples(content: string): SpecExample[] {
  const examplesMatch = content.match(/^## (?:Scenarios|Examples)\s*$/m);
  if (examplesMatch) {
    return parseEpicExamples(content, examplesMatch);
  }

  const behaviorsMatch = content.match(/^## Behaviors\s*$/m);
  if (behaviorsMatch) {
    return parseHarborBehaviors(content, behaviorsMatch);
  }

  // Fallback: treat entire content as single unnamed example
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

    // #### Steps (simple format)
    if (/^#### Steps/i.test(trimmedLine) && !trimmedLine.startsWith("#####")) {
      if (currentExample && currentExample.steps.length > 0) {
        examples.push(currentExample);
      }
      const nameMatch = trimmedLine.match(/^#### Steps\s*(?:\(([^)]+)\))?/i);
      const exampleName = nameMatch?.[1]?.trim() || currentBehavior;
      currentExample = { name: exampleName, steps: [] };
      collectingSteps = true;
      inExamplesSection = false;
      continue;
    }

    // #### Scenarios or #### Examples (nested format)
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

  if (currentExample && currentExample.steps.length > 0) {
    examples.push(currentExample);
  }

  return examples;
}

/** Convert title to slug (same as Python slugify) */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parse the ## Pages section to extract page paths for each behavior.
 * Returns a Map of behavior ID (slugified) to page path (e.g., "/candidates").
 *
 * Expected format:
 * ```markdown
 * ## Pages
 * ### Page Name
 * **Path:** `/route`
 * #### Behaviors
 * - Behavior Title
 * ```
 */
function parsePagePaths(content: string): Map<string, string> {
  const pagePaths = new Map<string, string>();

  const pagesMatch = content.match(/^## Pages/im);
  if (!pagesMatch) return pagePaths;

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
      pagePaths.set(slugify(behaviorTitle), currentPagePath);
    }
  }

  return pagePaths;
}

/**
 * Parse Harbor format with full behavior definitions including dependencies.
 * Returns a Map of behavior ID to HarborBehavior.
 */
export function parseHarborBehaviorsWithDependencies(
  content: string
): Map<string, import('./types').HarborBehavior> {
  // Parse page paths from ## Pages section
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

    // Parse dependency lines
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

    // #### Steps (simple format)
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

    // #### Scenarios or #### Examples (nested format)
    if (/^#### (?:Scenarios|Examples)/i.test(trimmedLine)) {
      collectingDependencies = false;
      inExamplesSection = true;
      collectingSteps = false;
      continue;
    }

    // Other #### sections
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

    // ##### Example Name
    if (inExamplesSection && trimmedLine.startsWith("##### ") && !trimmedLine.startsWith("######")) {
      if (currentExample && currentExample.steps.length > 0) {
        currentBehavior.examples.push(currentExample);
      }
      currentExample = { name: trimmedLine.slice(6).trim(), steps: [] };
      collectingSteps = false;
      continue;
    }

    // ###### Steps
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

    // Collect description (first non-heading, non-empty line before any H4)
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

/** Parse examples section with configurable heading levels. */
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

    if (trimmedLine.toLowerCase() === stepsHeading.toLowerCase() + " steps") {
      inSteps = true;
      continue;
    }

    if (trimmedLine.startsWith(stepsHeading + " ") && !trimmedLine.toLowerCase().includes("steps")) {
      inSteps = false;
      continue;
    }

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

/** Parse a behavior spec markdown file into a TestableSpec. */
export async function parseSpecFile(filePath: string): Promise<TestableSpec> {
  const content = await readFile(filePath, "utf-8");

  const nameMatch = content.match(NAME_PATTERN);
  const name = nameMatch?.[1]?.trim() ?? "Unnamed";

  const dirMatch = content.match(DIRECTORY_PATTERN);
  const directory = dirMatch?.[1]?.trim();

  const examples = parseExamples(content);

  return { name, directory, examples };
}

// ============================================================================
// CHECK CLASSIFICATION
// ============================================================================

const DETERMINISTIC_PATTERNS = [
  /^url\s+contains\s+/i,
  /^url\s+is\s+/i,
  /^page\s+title\s+is\s+/i,
  /^page\s+title\s+contains\s+/i,
  /^element\s+count\s+is\s+/i,
  /^input\s+value\s+is\s+/i,
  /^checkbox\s+is\s+checked/i,
];

export function classifyCheck(instruction: string): "deterministic" | "semantic" {
  const trimmed = instruction.trim();
  for (const pattern of DETERMINISTIC_PATTERNS) {
    if (pattern.test(trimmed)) return "deterministic";
  }
  return "semantic";
}

// ============================================================================
// VERIFICATION CONTEXT — tracks behavior results for dependency awareness
// ============================================================================

export class VerificationContext {
  private results: Map<string, import('./types').BehaviorContext>;

  constructor() {
    this.results = new Map();
  }

  markResult(behaviorId: string, result: import('./types').BehaviorContext): void {
    this.results.set(behaviorId, result);
  }

  getResult(behaviorId: string): import('./types').BehaviorContext | undefined {
    return this.results.get(behaviorId);
  }

  shouldSkip(dependencies: string[]): { skip: boolean; reason?: string } {
    for (const depId of dependencies) {
      const depResult = this.results.get(depId);
      if (!depResult) continue;
      if (depResult.status !== 'pass') {
        return { skip: true, reason: `Dependency "${depResult.behaviorName}" failed` };
      }
    }
    return { skip: false };
  }

  hasPassed(behaviorId: string): boolean {
    return this.results.get(behaviorId)?.status === 'pass';
  }

  getAllResults(): Map<string, import('./types').BehaviorContext> {
    return new Map(this.results);
  }

  clear(): void {
    this.results.clear();
  }

  getStatusCounts(): { pass: number; fail: number; dependency_failed: number } {
    const counts = { pass: 0, fail: 0, dependency_failed: 0 };
    for (const result of this.results.values()) {
      counts[result.status]++;
    }
    return counts;
  }
}

// ============================================================================
// CREDENTIAL TRACKER — captures Sign Up credentials for reuse
// ============================================================================

export class CredentialTracker {
  private credentials: { email: string | null; password: string | null };
  private executionCounter: number;

  constructor() {
    this.credentials = { email: null, password: null };
    this.executionCounter = 0;
  }

  /** Generate unique email variant to avoid duplicate registration. */
  uniquifyEmail(email: string): string {
    this.executionCounter++;
    const atIndex = email.indexOf('@');
    if (atIndex === -1) return email;
    return `${email.slice(0, atIndex)}_${this.executionCounter}${email.slice(atIndex)}`;
  }

  /** Capture credentials from a Type step instruction. */
  captureFromStep(instruction: string): void {
    const typePattern = /Type\s+["']([^"']+)["']\s+into\s+(?:the\s+)?(.+)/i;
    const match = instruction.match(typePattern);
    if (!match) return;

    const value = match[1].trim();
    const fieldDescriptor = match[2].toLowerCase();

    if (fieldDescriptor.includes('email')) {
      this.credentials.email = value;
    } else if (fieldDescriptor.includes('password')) {
      this.credentials.password = value;
    }
  }

  /** Inject captured credentials into a step instruction. */
  injectIntoStep(instruction: string): string {
    const typePattern = /Type\s+["']([^"']+)["']\s+into\s+(?:the\s+)?(.+)/i;
    const match = instruction.match(typePattern);
    if (!match) return instruction;

    const fieldDescriptor = match[2].toLowerCase();
    const originalQuote = instruction.includes('"') ? '"' : "'";

    if (fieldDescriptor.includes('email') && this.credentials.email) {
      return instruction.replace(
        /Type\s+["']([^"']+)["']/i,
        `Type ${originalQuote}${this.credentials.email}${originalQuote}`
      );
    }

    if (fieldDescriptor.includes('password') && this.credentials.password) {
      return instruction.replace(
        /Type\s+["']([^"']+)["']/i,
        `Type ${originalQuote}${this.credentials.password}${originalQuote}`
      );
    }

    return instruction;
  }

  hasCredentials(): boolean {
    return this.credentials.email !== null && this.credentials.password !== null;
  }

  getCredentials(): { email: string | null; password: string | null } {
    return { ...this.credentials };
  }

  reset(): void {
    this.credentials = { email: null, password: null };
  }
}

// ============================================================================
// DEPENDENCY CHAIN BUILDING
// ============================================================================

/**
 * Build the complete dependency chain for a behavior.
 * Returns chain steps in execution order (dependencies first, target last).
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

  function buildChainRecursive(behaviorId: string, scenarioName?: string): void {
    if (visited.has(behaviorId)) return;
    visited.add(behaviorId);

    const behavior = allBehaviors.get(behaviorId);
    if (!behavior) {
      throw new Error(`Dependency "${behaviorId}" not found for behavior chain`);
    }

    for (const dep of behavior.dependencies) {
      buildChainRecursive(dep.behaviorId, dep.scenarioName);
    }

    chain.push({ behavior, scenarioName });
  }

  buildChainRecursive(targetBehaviorId);
  return chain;
}

// ============================================================================
// CREDENTIAL PROCESSING FOR STEPS
// ============================================================================

/**
 * Process steps for a behavior, handling credential uniquification and injection.
 *
 * - Sign Up behaviors: uniquify email to avoid duplicate registration
 * - Behaviors with "invalid"/"wrong" in ID: skip injection (testing bad credentials)
 * - Other behaviors: inject captured credentials into first 5 steps
 *   (the sign-in preamble area — avoids replacing fields in behavior-specific forms)
 */
export function processStepsWithCredentials(
  behavior: import('./types').HarborBehavior,
  steps: import('./types').SpecStep[],
  credentialTracker: CredentialTracker
): import('./types').SpecStep[] {
  const behaviorId = behavior.id.toLowerCase();

  // Sign Up: uniquify email
  if (behaviorId.includes('sign-up') || behaviorId.includes('signup')) {
    const typePattern = /Type\s+["']([^"']+)["']\s+into\s+(?:the\s+)?(.+)/i;
    return steps.map(step => {
      if (step.type !== 'act') return step;
      const match = step.instruction.match(typePattern);
      if (!match) return step;
      if (match[2].toLowerCase().includes('email')) {
        const uniqueEmail = credentialTracker.uniquifyEmail(match[1]);
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

  // Skip injection for behaviors testing invalid credentials
  if (behaviorId.includes('invalid') || behaviorId.includes('wrong')) {
    return steps;
  }

  // Inject captured credentials into first 5 steps (sign-in preamble)
  if (credentialTracker.hasCredentials()) {
    return steps.map((step, index) => {
      if (step.type === 'act' && index < 5) {
        return { ...step, instruction: credentialTracker.injectIntoStep(step.instruction) };
      }
      return step;
    });
  }

  return steps;
}

// ============================================================================
// REWARD & SUMMARY
// ============================================================================

export function calculateReward(results: import('./types').BehaviorContext[]): number {
  if (results.length === 0) return 0;
  return results.filter(r => r.status === 'pass').length / results.length;
}

export function aggregateResults(results: import('./types').BehaviorContext[]): Omit<import('./types').VerificationSummary, 'summary' | 'behaviors' | 'duration'> {
  return {
    passed: results.filter(r => r.status === 'pass').length,
    failed: results.filter(r => r.status === 'fail').length,
    dependency_failed: results.filter(r => r.status === 'dependency_failed').length,
    total: results.length,
    reward: calculateReward(results),
  };
}

export function generateSummary(results: import('./types').BehaviorContext[]): string {
  const { passed, failed, dependency_failed } = aggregateResults(results);
  const parts: string[] = [];

  parts.push(passed === 1 ? '1 behavior passed' : `${passed} behaviors passed`);

  if (failed > 0) {
    const failedNames = results
      .filter(r => r.status === 'fail')
      .map(r => r.behaviorName)
      .join(', ');
    parts.push(failed === 1 ? `1 failed (${failedNames})` : `${failed} failed (${failedNames})`);
  }

  if (dependency_failed > 0) {
    parts.push(dependency_failed === 1
      ? '1 failed due to dependencies'
      : `${dependency_failed} failed due to dependencies`);
  }

  return parts.join(', ');
}

export function createVerificationSummary(
  results: import('./types').BehaviorContext[],
  duration: number
): import('./types').VerificationSummary {
  return {
    ...aggregateResults(results),
    summary: generateSummary(results),
    behaviors: results,
    duration,
  };
}

// ============================================================================
// BEHAVIOR VERIFICATION — chain execution with dependency tracking
// ============================================================================

/**
 * Verify a behavior along with its full dependency chain.
 *
 * Architecture (post-spec-update):
 * - Each behavior's steps start on its own page (no sign-in preamble)
 * - The chain is: Sign Up (creates account + logs in) → target behavior
 * - Only the first chain step (Sign Up) clears browser state
 * - Subsequent steps preserve localStorage/cookies so the SPA session survives
 * - NO page.goto() for non-first steps (would kill React in-memory auth state)
 */
export async function verifyBehaviorWithDependencies(
  targetBehavior: import('./types').HarborBehavior,
  allBehaviors: Map<string, import('./types').HarborBehavior>,
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: any
): Promise<import('./types').BehaviorContext> {
  const startTime = Date.now();

  // Skip if any dependency already failed
  const skipCheck = context.shouldSkip(targetBehavior.dependencies.map(d => d.behaviorId));
  if (skipCheck.skip) {
    return {
      behaviorId: targetBehavior.id,
      behaviorName: targetBehavior.title,
      status: 'dependency_failed',
      failedDependency: skipCheck.reason,
      duration: 0,
    };
  }

  // Build full dependency chain (Sign Up → ... → target)
  const chain = buildDependencyChain(targetBehavior.id, allBehaviors);

  for (let chainIndex = 0; chainIndex < chain.length; chainIndex++) {
    const { behavior, scenarioName } = chain[chainIndex];
    const isFirstInChain = chainIndex === 0;

    // Pick scenario
    const example = scenarioName
      ? behavior.examples.find(e => e.name === scenarioName) ?? behavior.examples[0]
      : behavior.examples[0];

    if (!example) {
      return {
        behaviorId: targetBehavior.id,
        behaviorName: targetBehavior.title,
        status: 'fail',
        error: `No examples found for behavior: ${behavior.title}`,
        duration: Date.now() - startTime,
      };
    }

    // Process steps with credential handling
    const processedSteps = processStepsWithCredentials(behavior, example.steps, credentialTracker);

    const creds = credentialTracker.getCredentials();
    const navigateToPath = !isFirstInChain && behavior.pagePath ? behavior.pagePath : undefined;
    console.log(`Chain [${chainIndex}/${chain.length - 1}] ${behavior.id}: ${processedSteps.length} steps, email=${creds.email ?? '(none)'}${navigateToPath ? `, navigateTo=${navigateToPath}` : ''}`);

    // Execute: only clear session for the first chain step.
    // For subsequent steps, navigate to the behavior's page path if available.
    const exampleToRun = { ...example, steps: processedSteps };
    let result: import('./types').ExampleResult;
    try {
      result = await runner.runExample(exampleToRun, {
        clearSession: isFirstInChain,
        navigateToPath,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (behavior.id !== targetBehavior.id) {
        return {
          behaviorId: targetBehavior.id,
          behaviorName: targetBehavior.title,
          status: 'dependency_failed',
          failedDependency: behavior.title,
          error: `Dependency "${behavior.title}" crashed: ${errorMessage}`,
          duration: Date.now() - startTime,
        };
      }
      return {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: 'fail',
        error: `Runner crash: ${errorMessage}`,
        duration: Date.now() - startTime,
      };
    }

    // Capture credentials after Sign Up (from processed steps to get uniquified email)
    if (behavior.id.includes('sign-up') || behavior.id.includes('signup')) {
      for (const step of processedSteps) {
        if (step.type === 'act') {
          credentialTracker.captureFromStep(step.instruction);
        }
      }
    }

    // Handle failure
    if (!result.success) {
      if (behavior.id !== targetBehavior.id) {
        const depError = result.failedAt?.context.error;
        return {
          behaviorId: targetBehavior.id,
          behaviorName: targetBehavior.title,
          status: 'dependency_failed',
          failedDependency: behavior.title,
          error: depError
            ? `Dependency "${behavior.title}" failed: ${depError}`
            : `Dependency "${behavior.title}" failed`,
          duration: Date.now() - startTime,
        };
      }
      return {
        behaviorId: targetBehavior.id,
        behaviorName: targetBehavior.title,
        status: 'fail',
        error: result.failedAt?.context.error,
        duration: Date.now() - startTime,
      };
    }
  }

  return {
    behaviorId: targetBehavior.id,
    behaviorName: targetBehavior.title,
    status: 'pass',
    duration: Date.now() - startTime,
  };
}

// ============================================================================
// AUTH BEHAVIOR IDENTIFICATION
// ============================================================================

/** Known auth behavior ID patterns */
const AUTH_PATTERNS = ['sign-up', 'signup', 'sign-in', 'signin', 'sign-out', 'signout', 'invalid-sign-in'];

function isAuthBehavior(behaviorId: string): boolean {
  const lower = behaviorId.toLowerCase();
  return AUTH_PATTERNS.some(p => lower === p || lower.includes(p));
}

// ============================================================================
// AUTH FLOW — runs auth behaviors in a deliberate sequence
// ============================================================================

/**
 * Run auth behaviors in sequence: Sign Up → Sign Out → Invalid Sign In → Sign In
 *
 * This is a dedicated flow because auth behaviors have unique requirements:
 * - Sign Up creates the account and logs the user in
 * - Sign Out needs the user to already be logged in (no login preamble)
 * - Invalid Sign In needs the user to be logged out
 * - Sign In needs the user to be logged out with valid credentials available
 *
 * The key insight: after Sign Up, the user IS signed in. So Sign Out can
 * execute directly. After Sign Out, the user is signed out, so Invalid Sign In
 * and Sign In can execute directly.
 *
 * Session management:
 * - Only Sign Up clears browser state (fresh start)
 * - All subsequent auth behaviors preserve state (no page.goto, no clearing)
 */
async function runAuthBehaviorsSequence(
  allBehaviors: Map<string, import('./types').HarborBehavior>,
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: any,
  behaviorTimeoutMs: number
): Promise<import('./types').BehaviorContext[]> {
  const results: import('./types').BehaviorContext[] = [];

  // Auth behaviors in execution order
  const authOrder = ['sign-up', 'sign-out', 'invalid-sign-in', 'sign-in'];

  const authBehaviors: import('./types').HarborBehavior[] = [];
  for (const id of authOrder) {
    const behavior = allBehaviors.get(id);
    if (behavior) authBehaviors.push(behavior);
  }

  if (authBehaviors.length === 0) return results;

  console.log(`\n=== Auth Flow: ${authBehaviors.map(b => b.title).join(' → ')} ===\n`);

  for (let i = 0; i < authBehaviors.length; i++) {
    const behavior = authBehaviors[i];
    const isFirst = i === 0;
    const behaviorStart = Date.now();

    // If Sign Up failed, skip all subsequent auth behaviors
    if (!isFirst) {
      const signUpResult = context.getResult('sign-up');
      if (signUpResult && signUpResult.status !== 'pass') {
        const failResult: import('./types').BehaviorContext = {
          behaviorId: behavior.id,
          behaviorName: behavior.title,
          status: 'dependency_failed',
          failedDependency: 'Sign Up',
          duration: 0,
        };
        context.markResult(behavior.id, failResult);
        results.push(failResult);
        continue;
      }
    }

    try {
      const example = behavior.examples[0];
      if (!example) {
        const failResult: import('./types').BehaviorContext = {
          behaviorId: behavior.id,
          behaviorName: behavior.title,
          status: 'fail',
          error: `No examples found for behavior: ${behavior.title}`,
          duration: 0,
        };
        context.markResult(behavior.id, failResult);
        results.push(failResult);
        continue;
      }

      // Process steps with credentials
      const processedSteps = processStepsWithCredentials(behavior, example.steps, credentialTracker);

      const creds = credentialTracker.getCredentials();
      console.log(`Auth [${behavior.id}]: ${processedSteps.length} steps, clearSession=${isFirst}, email=${creds.email ?? '(none)'}`);

      const exampleToRun = { ...example, steps: processedSteps };

      const exampleResult = await withTimeout(
        runner.runExample(exampleToRun, { clearSession: isFirst }),
        behaviorTimeoutMs,
        `Behavior "${behavior.title}" timed out after ${behaviorTimeoutMs / 1000}s`
      );

      // Capture credentials after Sign Up
      if (behavior.id.includes('sign-up') || behavior.id.includes('signup')) {
        for (const step of processedSteps) {
          if (step.type === 'act') {
            credentialTracker.captureFromStep(step.instruction);
          }
        }
      }

      const result: import('./types').BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: (exampleResult as import('./types').ExampleResult).success ? 'pass' : 'fail',
        error: (exampleResult as import('./types').ExampleResult).failedAt?.context.error,
        duration: (exampleResult as import('./types').ExampleResult).duration,
      };

      context.markResult(behavior.id, result);
      results.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failResult: import('./types').BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: 'fail',
        error: errorMessage.includes('timed out') ? errorMessage : `Unexpected error: ${errorMessage}`,
        duration: Date.now() - behaviorStart,
      };
      context.markResult(behavior.id, failResult);
      results.push(failResult);
    }
  }

  return results;
}

// ============================================================================
// TOP-LEVEL VERIFICATION ORCHESTRATOR
// ============================================================================

/** Default timeout per behavior (2 minutes) */
const DEFAULT_BEHAVIOR_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutError)), ms)),
  ]);
}

/**
 * Verify all behaviors from an instruction.md file.
 *
 * Execution strategy:
 * 1. Auth behaviors run first in a dedicated sequence (shared session)
 * 2. Non-auth behaviors run independently, each with its own fresh chain
 *    (Sign Up → target behavior, fresh browser state per chain)
 */
export async function verifyAllBehaviors(
  instructionPath: string,
  runner: any,
  behaviorTimeoutMs: number = DEFAULT_BEHAVIOR_TIMEOUT_MS
): Promise<import('./types').VerificationSummary> {
  const startTime = Date.now();

  const content = await readFile(instructionPath, 'utf-8');
  const allBehaviors = parseHarborBehaviorsWithDependencies(content);

  const context = new VerificationContext();
  const credentialTracker = new CredentialTracker();

  // 1. Auth behaviors in dedicated sequence
  const authResults = await runAuthBehaviorsSequence(
    allBehaviors, context, credentialTracker, runner, behaviorTimeoutMs
  );

  // 2. Non-auth behaviors with independent chains
  const nonAuthResults: import('./types').BehaviorContext[] = [];
  for (const behavior of allBehaviors.values()) {
    if (isAuthBehavior(behavior.id)) continue;

    // Fresh credentials for each chain
    credentialTracker.reset();

    const behaviorStart = Date.now();
    try {
      const result = await withTimeout(
        verifyBehaviorWithDependencies(behavior, allBehaviors, context, credentialTracker, runner),
        behaviorTimeoutMs,
        `Behavior "${behavior.title}" timed out after ${behaviorTimeoutMs / 1000}s`
      );
      context.markResult(behavior.id, result);
      nonAuthResults.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failResult: import('./types').BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: 'fail',
        error: errorMessage.includes('timed out') ? errorMessage : `Unexpected error: ${errorMessage}`,
        duration: Date.now() - behaviorStart,
      };
      context.markResult(behavior.id, failResult);
      nonAuthResults.push(failResult);
    }
  }

  const results = [...authResults, ...nonAuthResults];
  return createVerificationSummary(results, Date.now() - startTime);
}

// ============================================================================
// STEP EXECUTION — Act and Check
// ============================================================================

/** Execute an Act step using Stagehand. */
export async function executeActStep(
  instruction: string,
  stagehand: Stagehand
): Promise<ActResult> {
  const startTime = Date.now();

  try {
    await stagehand.act(instruction);
    const duration = Date.now() - startTime;
    const page = stagehand.context.activePage();
    return { success: true, duration, pageUrl: page?.url() ?? "" };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    const page = stagehand.context.activePage();
    let pageSnapshot = "";
    let availableActions: string[] = [];

    try {
      pageSnapshot = page ? await page.evaluate(() => document.documentElement.outerHTML) : "";
    } catch { /* ignore */ }

    try {
      const observations = await stagehand.observe();
      availableActions = observations.map(obs => obs.description);
    } catch { /* ignore */ }

    return { success: false, duration, error: errorMessage, pageSnapshot, availableActions };
  }
}

/** Pattern handlers for deterministic checks */
const DETERMINISTIC_HANDLERS: Array<{
  pattern: RegExp;
  getActual: (page: Page) => string | Promise<string>;
  compare: (actual: string, expected: string) => boolean;
}> = [
  { pattern: /^url\s+contains\s+(.+)$/i, getActual: (p) => p.url(), compare: (a, e) => a.includes(e) },
  { pattern: /^url\s+is\s+(.+)$/i, getActual: (p) => p.url(), compare: (a, e) => a === e },
  { pattern: /^page\s+title\s+is\s+(.+)$/i, getActual: (p) => p.title(), compare: (a, e) => a === e },
  { pattern: /^page\s+title\s+contains\s+(.+)$/i, getActual: (p) => p.title(), compare: (a, e) => a.includes(e) },
];

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

async function executeDeterministicCheck(instruction: string, page: Page): Promise<CheckResult> {
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
 * Semantic check using B-Test's LLM-powered assertions.
 *
 * Snapshot lifecycle:
 * - "before" snapshot must already exist (set by SpecTestRunner before Act step)
 * - This function takes the "after" snapshot, then asserts the diff
 */
async function executeSemanticCheck(
  instruction: string,
  page: Page,
  tester: Tester
): Promise<CheckResult> {
  await tester.snapshot(page);

  // Enhance instruction with interpretation hints to reduce false negatives
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

// ============================================================================
// FAILURE CONTEXT — rich debugging info for failed steps
// ============================================================================

export async function generateFailureContext(
  page: Page,
  step: SpecStep,
  error: Error
): Promise<FailureContext> {
  const pageUrl = page.url();
  const pageSnapshot = await page.evaluate(() => document.documentElement.outerHTML);
  const availableElements = await extractInteractiveElements(page);
  const suggestions = generateSuggestions(error, step, availableElements);

  return { pageSnapshot, pageUrl, failedStep: step, error: error.message, availableElements, suggestions };
}

async function extractInteractiveElements(page: Page): Promise<FailureContext["availableElements"]> {
  return page.evaluate(() => {
    const elements = document.querySelectorAll("button, a, input, select, textarea");
    return Array.from(elements).slice(0, 20).map(el => {
      const tagName = el.tagName.toLowerCase();
      const type = tagName === "a" ? "link" : tagName;
      const text = el.textContent?.trim().slice(0, 50) || "";

      let selector = tagName;
      if (el.id) selector += `#${el.id}`;
      else if (el.className && typeof el.className === "string") selector += `.${el.className.split(" ")[0]}`;
      else if (el.getAttribute("name")) selector += `[name='${el.getAttribute("name")}']`;

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

function generateSuggestions(
  error: Error,
  step: SpecStep,
  elements: FailureContext["availableElements"]
): string[] {
  const msg = error.message;
  const isNotFound = /element not found|no object generated|could not locate|schema|not found|no element/i.test(msg);
  const isTimeout = /timeout|timed out/i.test(msg);
  const isPageState = /unexpected page state|login page|session may have expired|WARNING: Page appears/i.test(msg);

  if (isPageState) {
    return [
      'The page is in an unexpected state (likely redirected to login)',
      'Check if the application properly persists user sessions',
      'The application may have a session timeout or auth issue',
    ];
  }

  if (isNotFound && step.type === 'act') {
    const lower = step.instruction.toLowerCase();
    if (lower.includes('click')) {
      const names = elements.filter(el => el.type === 'button' || el.type === 'link')
        .map(el => el.text || el.selector).slice(0, 5);
      return [
        'The button or clickable element was not found on the page',
        ...(names.length > 0 ? [`Available clickable elements: ${names.join(', ')}`] : []),
        'The feature may not be implemented in the application',
      ];
    }
    if (/select|dropdown|change|choose/i.test(lower)) {
      return [
        'The dropdown or select element was not found or is not interactive',
        'Check if the dropdown needs to be opened first',
      ];
    }
    if (/fill|type|enter/i.test(lower)) {
      return [
        'The input field was not found on the page',
        'Check if the form or modal is visible and not hidden',
      ];
    }
    return ['The UI element for this action was not found', 'This feature may not be implemented'];
  }

  if (isNotFound && step.type === 'check') {
    return [
      'The expected content was not found on the page',
      'Verify the previous action completed successfully',
      'This feature may not be implemented correctly',
    ];
  }

  if (isTimeout) {
    return ['The operation timed out', 'Check for JavaScript errors in the application'];
  }

  return ['Check if the page is fully loaded', 'Review the application implementation'];
}

// ============================================================================
// ERROR CONTEXT HELPERS
// ============================================================================

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

async function getEnhancedErrorContext(page: Page, instruction: string, attempt: number): Promise<string> {
  let pageContext = '';
  let pageStateWarning = '';
  let visibleElements = '';

  try {
    const currentUrl = page.url();
    const title = await page.title();
    pageContext = ` Current page: "${title}" (${currentUrl}).`;

    const lowerTitle = title.toLowerCase();
    const lowerUrl = currentUrl.toLowerCase();

    if (/sign in|login/.test(lowerTitle) || /\/login|\/signin|\/auth/.test(lowerUrl)) {
      pageStateWarning = ' WARNING: Page appears to be a login page - session may have expired.';
    } else if (/error|404|not found/.test(lowerTitle)) {
      pageStateWarning = ' WARNING: Page appears to be an error page.';
    }

    const elements = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button, a, input, select, [role="button"]'));
      return els.slice(0, 10).map(el => {
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || '').trim().slice(0, 30);
        const type = el.getAttribute('type') || '';
        let desc = tag;
        if (type) desc += `[type=${type}]`;
        if (text) desc += `: "${text}"`;
        return desc;
      });
    });

    if (elements.length > 0) visibleElements = ` Visible elements: [${elements.join(', ')}].`;
  } catch { /* ignore */ }

  return `Act failed: Could not execute "${instruction}".${pageContext}${pageStateWarning}${visibleElements} (Attempt ${attempt}/${MAX_RETRIES})`;
}

async function getCheckErrorContext(page: Page, instruction: string, attempt: number): Promise<string> {
  let pageContext = '';
  let visibleElements = '';

  try {
    const currentUrl = page.url();
    const title = await page.title();
    pageContext = ` Current page: "${title}" (${currentUrl}).`;

    const elements = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button, a, input, select, [role="button"]'));
      return els.slice(0, 10).map(el => {
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || '').trim().slice(0, 30);
        let desc = tag;
        if (text) desc += `: "${text}"`;
        return desc;
      });
    });

    if (elements.length > 0) visibleElements = ` Visible elements: [${elements.join(', ')}].`;
  } catch { /* ignore */ }

  return `Check failed: "${instruction}" was not satisfied.${pageContext}${visibleElements} (Attempt ${attempt}/${MAX_RETRIES})`;
}


// ============================================================================
// INSTRUCTION DETECTION HELPERS
// ============================================================================

/** Check if instruction is a navigation action. Returns URL if found. */
function isNavigationAction(instruction: string): string | null {
  const urlMatch = instruction.match(/(https?:\/\/[^\s]+)/i);
  if (urlMatch) return urlMatch[1].trim();

  const patterns = [
    /^navigate\s+to\s+(.+)$/i,
    /^go\s+to\s+(.+)$/i,
    /^open\s+(.+)$/i,
    /^visit\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = instruction.match(pattern);
    if (match && match[1].trim().startsWith('/')) {
      return match[1].trim();
    }
  }
  return null;
}

/** Check if instruction is a page refresh action. */
function isRefreshAction(instruction: string): boolean {
  return /refresh\s+(?:the\s+)?page|reload\s+(?:the\s+)?page|^refresh$|^reload$/i.test(instruction);
}

/** Extract quoted text from check instruction for direct verification. */
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

// ============================================================================
// SPEC TEST RUNNER — the main class for executing behavior specs
// ============================================================================

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
   * Run a single example (behavior scenario).
   *
   * Session management strategy:
   * - clearSession=true: Hard reset. Navigate to about:blank (neutral origin),
   *   clear ALL cookies/localStorage/sessionStorage, then navigate to baseUrl.
   *   The SPA loads into a completely clean state — no stale user, no stale tokens.
   * - clearSession=false + navigateToPath: Preserve session but navigate to the
   *   behavior's page (e.g., /candidates). Uses page.goto() which is fine because
   *   localStorage persists across navigations. If a page.goto() causes sign-out,
   *   that's the app's bug, not the runner's.
   * - clearSession=false + no path: Keep everything as-is. No navigation, no clearing.
   *   Used for auth flow steps (Sign Out, Invalid Sign In, Sign In) where we want
   *   to preserve the exact page state.
   */
  async runExample(example: SpecExample, options?: {
    clearSession?: boolean;
    /** Navigate to this page path for non-first chain steps (e.g., "/candidates") */
    navigateToPath?: string;
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
        // === HARD RESET ===
        // Goal: ensure the SPA loads into a completely clean state with zero
        // auth tokens, user data, or in-memory state from previous runs.
        //
        // 1. Navigate to about:blank to fully unload the SPA. This destroys
        //    any in-memory React/Vue/Angular state. localStorage is NOT
        //    destroyed (it's origin-scoped and persists), but the SPA can no
        //    longer act on it.
        await page.goto('about:blank');

        // 2. Clear cookies (they're origin-independent, cleared via browser API)
        const browserContext = page.context();
        await browserContext.clearCookies();

        // 3. Navigate to baseUrl to get back on the app's origin. The SPA will
        //    load and may briefly read stale localStorage — that's OK because
        //    we clear storage and reload immediately after.
        await page.goto(this.config.baseUrl);

        // 4. Clear localStorage and sessionStorage on the correct origin
        await page.evaluate(() => {
          try { localStorage.clear(); } catch {}
          try { sessionStorage.clear(); } catch {}
        }).catch(() => {});

        // 5. Reload so the SPA re-initializes reading the now-empty storage.
        //    This is the step that actually produces the clean sign-in page.
        await page.reload();
        await page.waitForLoadState('networkidle');

        console.log(`[runExample] Hard reset complete. Page URL: ${page.url()}`);
      } else if (options?.navigateToPath) {
        // === NAVIGATE TO PAGE PATH (session preserved) ===
        // Navigate directly to the behavior's page. localStorage and cookies
        // persist across page.goto() calls — this is standard browser behavior.
        // The SPA will load on the target route with the existing auth session.
        const targetUrl = `${this.config.baseUrl.replace(/\/$/, '')}${options.navigateToPath}`;
        console.log(`[runExample] Navigating to page path: ${targetUrl}`);
        await page.goto(targetUrl);
        await page.waitForLoadState('networkidle');
        console.log(`[runExample] Page URL after navigation: ${page.url()}`);
      } else {
        // === PRESERVE SESSION (no navigation) ===
        // Don't navigate, don't clear anything.
        // Used for auth flow continuation (Sign Out after Sign Up, etc.)
        console.log(`[runExample] Preserving session. Page URL: ${page.url()}`);
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

          failedAt = { stepIndex: i, step, context: failureContext };
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
          return {
            step,
            success: false,
            duration,
            actResult: { success: false, duration, error: error instanceof Error ? error.message : String(error) },
          };
        }
      }

      // Direct page refresh
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
          return {
            step,
            success: false,
            duration,
            actResult: { success: false, duration, error: error instanceof Error ? error.message : String(error) },
          };
        }
      }

      // Stagehand AI action with retry logic
      const actResult = await this.executeActWithRetry(step.instruction, stagehand, page);
      return {
        step,
        success: actResult.success,
        duration: Date.now() - stepStart,
        actResult,
      };
    }

    // === CHECK STEP ===

    // Try direct text verification first
    const textCheck = extractExpectedText(step.instruction);
    if (textCheck) {
      try {
        const escapedText = textCheck.text.replace(/"/g, '\\"');
        const locator = page.locator(`text="${escapedText}"`);
        const count = await locator.count();
        const exists = count > 0;
        const passed = textCheck.shouldExist ? exists : !exists;
        return {
          step,
          success: passed,
          duration: Date.now() - stepStart,
          checkResult: {
            passed,
            checkType: "deterministic",
            expected: step.instruction,
            actual: exists ? `Found "${textCheck.text}" on page` : `Text "${textCheck.text}" not found`,
          },
        };
      } catch { /* fall through to semantic check */ }
    }

    // Detect page transition for oracle selection strategy
    const currentUrl = page.url();
    const pageTransitioned = this.preActUrl !== null && currentUrl !== this.preActUrl;

    const checkType = step.checkType ?? "semantic";
    const checkResult = await this.executeCheckWithRetry(
      step.instruction, checkType, page, tester, stagehand, pageTransitioned
    );

    return {
      step,
      success: checkResult.passed,
      duration: Date.now() - stepStart,
      checkResult,
    };
  }

  /**
   * Execute an Act step with retry logic for transient errors.
   */
  private async executeActWithRetry(
    instruction: string,
    stagehand: Stagehand,
    page: Page
  ): Promise<ActResult> {
    let lastAttempt = 1;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      lastAttempt = attempt;
      try {
        const result = await executeActStep(instruction, stagehand);
        if (result.success) return result;

        if (result.error && this.isRetryableError(result.error) && attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY);
          continue;
        }

        // Enhance schema/object errors with page context
        if (result.error && /schema|No object generated/i.test(result.error)) {
          return { ...result, error: await getEnhancedErrorContext(page, instruction, attempt) };
        }
        return result;
      } catch (error) {
        const rawError = error instanceof Error ? error : new Error(String(error));
        if (this.isRetryableError(rawError.message) && attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY);
          continue;
        }
        let errorMsg: string;
        try { errorMsg = await getEnhancedErrorContext(page, instruction, attempt); }
        catch { errorMsg = rawError.message; }
        return { success: false, duration: 0, error: errorMsg };
      }
    }

    return {
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