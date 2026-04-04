import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { Tester } from "../b-test";
import type { ActResult, CheckResult, SpecStep, FailureContext } from "./types";

export const MAX_RETRIES = 3;
export const RETRY_DELAY = 1000;
const ELEMENT_TEXT_PREVIEW = 50;
const ERROR_CONTEXT_ELEMENT_LIMIT = 10;
const INTERACTIVE_ELEMENT_LIMIT = 20;

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

export async function executeCheckStep(
  instruction: string,
  checkType: "deterministic" | "semantic",
  page: Page,
  tester: Tester
): Promise<CheckResult> {
  if (checkType === "deterministic") return executeDeterministicCheck(instruction, page);
  return executeSemanticCheck(instruction, page, tester);
}

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

export async function getEnhancedErrorContext(page: Page, instruction: string, attempt: number): Promise<string> {
  try {
    const { url, title } = await getPageContext(page);
    const pageContext = ` Current page: "${title}" (${url}).`;
    const pageStateWarning = detectPageStateWarning(title, url);
    const visibleElements = await describePageElements(page, ERROR_CONTEXT_ELEMENT_LIMIT);

    return `Act failed: Could not execute "${instruction}".${pageContext}${pageStateWarning}${visibleElements} (Attempt ${attempt}/${MAX_RETRIES})`;
  } catch {
    return `Act failed: Could not execute "${instruction}". (Attempt ${attempt}/${MAX_RETRIES})`;
  }
}

export async function getCheckErrorContext(page: Page, instruction: string, attempt: number): Promise<string> {
  try {
    const { url, title } = await getPageContext(page);
    const pageContext = ` Current page: "${title}" (${url}).`;
    const visibleElements = await describePageElements(page, ERROR_CONTEXT_ELEMENT_LIMIT);

    return `Check failed: "${instruction}" was not satisfied.${pageContext}${visibleElements} (Attempt ${attempt}/${MAX_RETRIES})`;
  } catch {
    return `Check failed: "${instruction}" was not satisfied. (Attempt ${attempt}/${MAX_RETRIES})`;
  }
}

/** Check if instruction is a navigation action. Returns URL if found. */
export function isNavigationAction(instruction: string): string | null {
  const urlMatch = instruction.match(/(https?:\/\/[^\s]+)/i);
  if (urlMatch) return urlMatch[1].trim();

  const patterns = [
    /^navigate\s+to\s+(.+)$/i,
    /^go\s+to\s+(.+)$/i,
    /^open\s+(.+)$/i,
    /^visit\s+(.+)$/i,
  ];

  const navMatch = patterns
    .map(p => instruction.match(p))
    .find(m => m && m[1].trim().startsWith('/'));
  return navMatch ? navMatch[1].trim() : null;
}

/** Check if instruction is a page refresh action. */
export function isRefreshAction(instruction: string): boolean {
  return /refresh\s+(?:the\s+)?page|reload\s+(?:the\s+)?page|^refresh$|^reload$/i.test(instruction);
}

/** Extract quoted text from check instruction for direct verification. */
export function extractExpectedText(instruction: string): { text: string; shouldExist: boolean } | null {
  const patterns = [
    /(?:the\s+text\s+)?["']([^"']+)["']\s+(?:no\s+longer\s+)?appears/i,
    /(?:should\s+)?(?:see|show|display|contain)\s+["']([^"']+)["']/i,
    /["']([^"']+)["']\s+(?:is\s+)?(?:no\s+longer\s+)?(?:visible|shown|displayed)/i,
  ];

  const match = patterns
    .map(p => instruction.match(p))
    .find(m => m !== null);

  if (!match) return null;

  const lower = instruction.toLowerCase();
  const shouldExist = !lower.includes('no longer') &&
                      !lower.includes('not ') &&
                      !lower.includes("doesn't") &&
                      !lower.includes("does not");
  return { text: match[1], shouldExist };
}

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

async function executeDeterministicCheck(instruction: string, page: Page): Promise<CheckResult> {
  const trimmed = instruction.trim();

  const found = DETERMINISTIC_HANDLERS
    .map(h => ({ handler: h, match: trimmed.match(h.pattern) }))
    .find(({ match }) => match !== null);

  if (found) {
    const expected = found.match![1].trim();
    const actual = await found.handler.getActual(page);
    const passed = found.handler.compare(actual, expected);
    return { passed, checkType: "deterministic", expected, actual };
  }

  return {
    passed: false,
    checkType: "deterministic",
    expected: instruction,
    actual: "Unrecognized check pattern",
    suggestion: "Use patterns like 'URL contains X' or 'Page title is Y'",
  };
}

async function executeSemanticCheck(
  instruction: string, page: Page, tester: Tester,
): Promise<CheckResult> {
  await tester.snapshot(page);

  const enhancedInstruction = `${instruction}

(INTERPRETATION: "navigate the application" = any button/link to app sections like Jobs, Candidates, Dashboard. "create X" = buttons like Create/Add/New. Use "or" generously - if ANY part is true, pass. For visual state checks like "edited", "pinned", "starred", look for ANY indicator: text labels, icons, badges, status tags, or visual changes.)`;

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

async function extractInteractiveElements(page: Page): Promise<FailureContext["availableElements"]> {
  return page.evaluate((args) => {
    const elements = document.querySelectorAll("button, a, input, select, textarea");
    return Array.from(elements).slice(0, args.limit).map(el => {
      const tagName = el.tagName.toLowerCase();
      const type = tagName === "a" ? "link" : tagName;
      const text = el.textContent?.trim().slice(0, args.previewLen) || "";

      let selector = tagName;
      if (el.id) selector += `#${el.id}`;
      else if (el.className && typeof el.className === "string") selector += `.${el.className.split(" ")[0]}`;
      else if (el.getAttribute("name")) selector += `[name='${el.getAttribute("name")}']`;

      const attributes = Object.fromEntries(
        ["type", "name", "placeholder", "href", "value"]
          .map(attr => [attr, el.getAttribute(attr)] as const)
          .filter((entry): entry is [string, string] => entry[1] != null)
      );

      return {
        type,
        text: text || undefined,
        selector,
        ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
      };
    });
  }, { limit: INTERACTIVE_ELEMENT_LIMIT, previewLen: ELEMENT_TEXT_PREVIEW });
}

async function getPageContext(page: Page): Promise<{ url: string; title: string }> {
  return { url: page.url(), title: await page.title() };
}

function detectPageStateWarning(title: string, url: string): string {
  const lowerTitle = title.toLowerCase();
  const lowerUrl = url.toLowerCase();

  if (/sign in|login/.test(lowerTitle) || /\/login|\/signin|\/auth/.test(lowerUrl)) {
    return ' WARNING: Page appears to be a login page - session may have expired.';
  }
  if (/error|404|not found/.test(lowerTitle)) {
    return ' WARNING: Page appears to be an error page.';
  }
  return '';
}

async function describePageElements(page: Page, limit: number): Promise<string> {
  const elements = await page.evaluate((args) => {
    const els = Array.from(document.querySelectorAll('button, a, input, select, [role="button"]'));
    return els.slice(0, args.limit).map(el => {
      const tag = el.tagName.toLowerCase();
      const text = (el.textContent || '').trim().slice(0, args.previewLen);
      const type = el.getAttribute('type') || '';
      let desc = tag;
      if (type) desc += `[type=${type}]`;
      if (text) desc += `: "${text}"`;
      return desc;
    });
  }, { limit, previewLen: ELEMENT_TEXT_PREVIEW });

  return elements.length > 0 ? ` Visible elements: [${elements.join(', ')}].` : '';
}

const NOT_FOUND_PATTERN = /element not found|no object generated|could not locate|schema|not found|no element/i;

const ERROR_CLASSIFIERS: Array<{
  test: (msg: string, step: SpecStep) => boolean;
  suggest: (elements: FailureContext["availableElements"], step: SpecStep) => string[];
}> = [
  {
    test: (msg) => /unexpected page state|login page|session may have expired|WARNING: Page appears/i.test(msg),
    suggest: () => [
      'The page is in an unexpected state (likely redirected to login)',
      'Check if the application properly persists user sessions',
      'The application may have a session timeout or auth issue',
    ],
  },
  {
    test: (msg, step) => NOT_FOUND_PATTERN.test(msg) && step.type === 'Act' && /click/i.test(step.instruction),
    suggest: (elements) => {
      const names = elements.filter(el => el.type === 'button' || el.type === 'link')
        .map(el => el.text || el.selector).slice(0, 5);
      return [
        'The button or clickable element was not found on the page',
        ...(names.length > 0 ? [`Available clickable elements: ${names.join(', ')}`] : []),
        'The feature may not be implemented in the application',
      ];
    },
  },
  {
    test: (msg, step) => NOT_FOUND_PATTERN.test(msg) && step.type === 'Act' && /select|dropdown|change|choose/i.test(step.instruction),
    suggest: () => [
      'The dropdown or select element was not found or is not interactive',
      'Check if the dropdown needs to be opened first',
    ],
  },
  {
    test: (msg, step) => NOT_FOUND_PATTERN.test(msg) && step.type === 'Act' && /fill|type|enter/i.test(step.instruction),
    suggest: () => [
      'The input field was not found on the page',
      'Check if the form or modal is visible and not hidden',
    ],
  },
  {
    test: (msg, step) => NOT_FOUND_PATTERN.test(msg) && step.type === 'Act',
    suggest: () => ['The UI element for this action was not found', 'This feature may not be implemented'],
  },
  {
    test: (msg, step) => NOT_FOUND_PATTERN.test(msg) && step.type === 'Check',
    suggest: () => [
      'The expected content was not found on the page',
      'Verify the previous action completed successfully',
      'This feature may not be implemented correctly',
    ],
  },
  {
    test: (msg) => /timeout|timed out/i.test(msg),
    suggest: () => ['The operation timed out', 'Check for JavaScript errors in the application'],
  },
];

function generateSuggestions(
  error: Error, step: SpecStep, elements: FailureContext["availableElements"],
): string[] {
  const classifier = ERROR_CLASSIFIERS.find(c => c.test(error.message, step));
  if (classifier) return classifier.suggest(elements, step);
  return ['Check if the page is fully loaded', 'Review the application implementation'];
}
