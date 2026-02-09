// ============================================================================
// PARSING
// ============================================================================

import { readFile } from "fs/promises";
import type { SpecStep, SpecExample, TestableSpec, HarborBehavior } from "./types";
import { classifyCheck } from "./classify";

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
    const behaviors = parseHarborBehaviorsWithDependencies(content);
    const examples: SpecExample[] = [];
    for (const behavior of behaviors.values()) {
      examples.push(...behavior.examples);
    }
    return examples;
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

/** Save current example to behavior, then behavior to the map. */
function saveBehavior(
  currentBehavior: HarborBehavior | null,
  currentExample: SpecExample | null,
  behaviors: Map<string, HarborBehavior>
): void {
  if (!currentBehavior) return;
  if (currentExample && currentExample.steps.length > 0) {
    currentBehavior.examples.push(currentExample);
  }
  behaviors.set(currentBehavior.id, currentBehavior);
}

/** Parse a numbered dependency line and push onto behavior.dependencies. */
function parseDependencyLine(trimmedLine: string, behavior: HarborBehavior): boolean {
  const depMatch = trimmedLine.match(/^\d+\.\s+(.+)$/);
  if (!depMatch) return false;

  const depText = depMatch[1].trim();
  const colonIndex = depText.indexOf(':');
  if (colonIndex !== -1) {
    behavior.dependencies.push({
      behaviorId: slugify(depText.slice(0, colonIndex).trim()),
      scenarioName: depText.slice(colonIndex + 1).trim() || undefined,
    });
  } else {
    behavior.dependencies.push({ behaviorId: slugify(depText) });
  }
  return true;
}

/** Parse an Act/Check step line and push onto example.steps. */
function parseStepLine(trimmedLine: string, example: SpecExample, lineNumber: number): boolean {
  const stepMatch = trimmedLine.match(STEP_PATTERN);
  if (!stepMatch) return false;

  const [, stepType, rawInstruction] = stepMatch;
  const instruction = rawInstruction.trim();
  example.steps.push(
    stepType === "Act"
      ? { type: "act", instruction, lineNumber }
      : { type: "check", instruction, checkType: classifyCheck(instruction), lineNumber }
  );
  return true;
}

/**
 * Parse Harbor format with full behavior definitions including dependencies.
 * Returns a Map of behavior ID to HarborBehavior.
 */
export function parseHarborBehaviorsWithDependencies(
  content: string
): Map<string, HarborBehavior> {
  const pagePaths = parsePagePaths(content);

  const behaviorsMatch = content.match(/^## Behaviors/im);
  if (!behaviorsMatch) return new Map();

  const behaviorsStart = behaviorsMatch.index! + behaviorsMatch[0].length;
  const nextH2Match = content.slice(behaviorsStart).match(/^## [^#]/m);
  const behaviorsEnd = nextH2Match
    ? behaviorsStart + nextH2Match.index!
    : content.length;

  const behaviorsContent = content.slice(behaviorsStart, behaviorsEnd);
  const lines = behaviorsContent.split("\n");
  const lineOffset = content.slice(0, behaviorsStart).split('\n').length;

  const behaviors = new Map<string, HarborBehavior>();
  let currentBehavior: HarborBehavior | null = null;
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
      saveBehavior(currentBehavior, currentExample, behaviors);

      const title = trimmedLine.slice(4).trim();
      const behaviorId = slugify(title);
      currentBehavior = {
        id: behaviorId, title, description: '', dependencies: [],
        examples: [], pagePath: pagePaths.get(behaviorId),
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
      if (parseDependencyLine(trimmedLine, currentBehavior)) continue;
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
      parseStepLine(trimmedLine, currentExample, lineNumber);
    }

    // Collect description (first non-heading, non-empty line before any H4)
    if (!collectingDependencies && !collectingSteps && !inExamplesSection &&
        !trimmedLine.startsWith("#") && trimmedLine && !currentBehavior.description) {
      currentBehavior.description = trimmedLine;
    }
  }

  // Save last behavior
  saveBehavior(currentBehavior, currentExample, behaviors);

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
