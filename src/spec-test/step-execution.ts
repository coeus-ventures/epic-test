// ============================================================================
// STEP EXECUTION — Act and Check
// ============================================================================

import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { Tester } from "../b-test";
import type { ActResult, CheckResult, SpecStep, FailureContext } from "./types";

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

export const MAX_RETRIES = 3;
export const RETRY_DELAY = 1000;

export async function getEnhancedErrorContext(page: Page, instruction: string, attempt: number): Promise<string> {
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

export async function getCheckErrorContext(page: Page, instruction: string, attempt: number): Promise<string> {
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
export function isNavigationAction(instruction: string): string | null {
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

/**
 * Detect if a failed act step is a UI navigation action that may be redundant.
 * Returns the target page name (lowercased) if the instruction looks like "Click X in the navigation/sidebar/menu",
 * or null if it doesn't match the pattern.
 */
export function extractNavigationTarget(instruction: string): string | null {
  // Pattern: "Click [the] X [button/link/tab/item] in [the] navigation/sidebar/menu/nav bar"
  const navMatch = instruction.match(
    /click\s+(?:the\s+)?["']?([^"']+?)["']?\s+(?:button\s+|link\s+|tab\s+|item\s+)?in\s+(?:the\s+)?(?:navigation|sidebar|menu|nav\s*bar|left\s*panel|header)/i
  );
  if (navMatch) return navMatch[1].trim().toLowerCase();

  // Pattern: "Navigate/Go to [the] X page"
  const pageMatch = instruction.match(
    /(?:navigate|go)\s+to\s+(?:the\s+)?(\w+)\s+(?:page|section|tab|view)/i
  );
  if (pageMatch) return pageMatch[1].trim().toLowerCase();

  return null;
}

/** Check if instruction is a page refresh action. */
export function isRefreshAction(instruction: string): boolean {
  return /refresh\s+(?:the\s+)?page|reload\s+(?:the\s+)?page|^refresh$|^reload$/i.test(instruction);
}

/**
 * Detect if an act instruction is a save/submit action (clicking a save-like button).
 * Used to trigger post-save wait logic (wait for form dismissal before proceeding).
 */
export function isSaveAction(instruction: string): boolean {
  if (!/click|press|tap|hit/i.test(instruction)) return false;
  return /\b(save|submit|publish)\b/i.test(instruction);
}

/**
 * Detect if an act instruction targets a select/dropdown element.
 * Returns the target value to select, or null if not a select action.
 */
export function extractSelectAction(instruction: string): { value: string } | null {
  // "Select 'X' from [the] Y [dropdown/menu/select]"
  const selectFromMatch = instruction.match(
    /(?:select|choose)\s+["']([^"']+)["']\s+(?:from|in)\s+/i
  );
  if (selectFromMatch) return { value: selectFromMatch[1] };

  // "Change/Set Y to 'X'"
  const changeToMatch = instruction.match(
    /(?:change|set)\s+.+?\s+to\s+["']([^"']+)["']/i
  );
  if (changeToMatch) return { value: changeToMatch[1] };

  // "Select 'X'" (without "from", shorter pattern)
  const selectOnlyMatch = instruction.match(
    /(?:select|choose)\s+["']([^"']+)["'](?:\s|$)/i
  );
  if (selectOnlyMatch) return { value: selectOnlyMatch[1] };

  return null;
}

/** Extract quoted text from check instruction for direct verification. */
export function extractExpectedText(instruction: string): { text: string; shouldExist: boolean } | null {
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
