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
  const epicSection = extractSection(content, /^## (?:Scenarios|Examples)\s*$/m);
  if (epicSection) {
    return parseExamplesSection(epicSection.body, "###", "####", epicSection.lineOffset);
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

/** Convert title to slug (same as Python slugify) */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Extract a markdown section by H2 heading, returning its body, lines, and line offset. */
function extractSection(
  content: string, headingPattern: RegExp
): { body: string; lines: string[]; lineOffset: number } | null {
  const match = content.match(headingPattern);
  if (!match) return null;

  const start = match.index! + match[0].length;
  const nextH2 = content.slice(start).match(/^## [^#]/m);
  const end = nextH2 ? start + nextH2.index! : content.length;
  const body = content.slice(start, end);

  return { body, lines: body.split("\n"), lineOffset: content.slice(0, start).split('\n').length };
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

  const section = extractSection(content, /^## Pages/im);
  if (!section) return pagePaths;

  let currentPagePath: string | null = null;
  let inBehaviorsSection = false;

  for (const line of section.lines) {
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

/** Parser state for content collection within a behavior. */
type ParserMode = 'idle' | 'dependencies' | 'steps';

/** Push current example onto behavior if it has steps. */
function flushExample(example: SpecExample | null, behavior: HarborBehavior): void {
  if (example && example.steps.length > 0) {
    behavior.examples.push(example);
  }
}

/** Save current example to behavior, then behavior to the map. */
function saveBehavior(
  currentBehavior: HarborBehavior | null,
  currentExample: SpecExample | null,
  behaviors: Map<string, HarborBehavior>
): void {
  if (!currentBehavior) return;
  flushExample(currentExample, currentBehavior);
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

/** Finalize previous behavior (if any) and create a new one from a ### heading. */
function startNewBehavior(
  trimmedLine: string,
  pagePaths: Map<string, string>,
  currentBehavior: HarborBehavior | null,
  currentExample: SpecExample | null,
  behaviors: Map<string, HarborBehavior>,
): HarborBehavior {
  saveBehavior(currentBehavior, currentExample, behaviors);
  const title = trimmedLine.slice(4).trim();
  const id = slugify(title);
  return {
    id, title, description: '', dependencies: [],
    examples: [], pagePath: pagePaths.get(id),
  };
}

/** Dispatch an #### heading, returning new parser state or null if not an H4. */
function handleH4Heading(
  trimmedLine: string,
  behavior: HarborBehavior,
  currentExample: SpecExample | null,
): { mode: ParserMode; inExamples: boolean; example: SpecExample | null } | null {
  if (!trimmedLine.startsWith("#### ") || trimmedLine.startsWith("#####")) return null;

  if (/^#### Dependencies/i.test(trimmedLine)) {
    return { mode: 'dependencies', inExamples: false, example: currentExample };
  }

  if (/^#### Steps/i.test(trimmedLine)) {
    flushExample(currentExample, behavior);
    const nameMatch = trimmedLine.match(/^#### Steps\s*(?:\(([^)]+)\))?/i);
    const exampleName = nameMatch?.[1]?.trim() || behavior.title;
    return { mode: 'steps', inExamples: false, example: { name: exampleName, steps: [] } };
  }

  if (/^#### (?:Scenarios|Examples)/i.test(trimmedLine)) {
    return { mode: 'idle', inExamples: true, example: currentExample };
  }

  // Other #### section — flush and reset
  flushExample(currentExample, behavior);
  return { mode: 'idle', inExamples: false, example: null };
}

/**
 * Parse Harbor format with full behavior definitions including dependencies.
 * Returns a Map of behavior ID to HarborBehavior.
 */
export function parseHarborBehaviorsWithDependencies(
  content: string
): Map<string, HarborBehavior> {
  const pagePaths = parsePagePaths(content);
  const section = extractSection(content, /^## Behaviors/im);
  if (!section) return new Map();
  const behaviors = new Map<string, HarborBehavior>();
  let currentBehavior: HarborBehavior | null = null;
  let currentExample: SpecExample | null = null;
  let mode: ParserMode = 'idle';
  let inExamples = false;

  for (let i = 0; i < section.lines.length; i++) {
    const trimmedLine = section.lines[i].trim();
    const lineNumber = section.lineOffset + i + 1;
    // ### Behavior boundary
    if (trimmedLine.startsWith("### ") && !trimmedLine.startsWith("#### ")) {
      currentBehavior = startNewBehavior(trimmedLine, pagePaths, currentBehavior, currentExample, behaviors);
      currentExample = null;
      mode = 'idle';
      inExamples = false;
      continue;
    }
    if (!currentBehavior) continue;
    // #### Heading dispatch
    const h4 = handleH4Heading(trimmedLine, currentBehavior, currentExample);
    if (h4) { mode = h4.mode; inExamples = h4.inExamples; currentExample = h4.example; continue; }

    // ##### Example heading (within examples section)
    if (inExamples && trimmedLine.startsWith("##### ") && !trimmedLine.startsWith("######")) {
      flushExample(currentExample, currentBehavior);
      currentExample = { name: trimmedLine.slice(6).trim(), steps: [] };
      mode = 'idle';
      continue;
    }
    // ###### Steps
    if (/^###### Steps/i.test(trimmedLine)) { mode = 'steps'; continue; }
    // Content: dependency lines
    if (mode === 'dependencies' && trimmedLine && parseDependencyLine(trimmedLine, currentBehavior)) continue;
    // Content: step lines
    if (mode === 'steps' && currentExample && trimmedLine.startsWith("* ")) {
      parseStepLine(trimmedLine, currentExample, lineNumber);
    }
    // Content: description (first text line in idle mode, outside examples)
    if (mode === 'idle' && !inExamples &&
        !trimmedLine.startsWith("#") && trimmedLine && !currentBehavior.description) {
      currentBehavior.description = trimmedLine;
    }
  }
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
