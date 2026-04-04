import { z } from "zod";
import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { SpecStep, StepResult } from "./types";

const RETRY_DELAY = 1000;
const POST_CLICK_DELAY_MS = 500;
const STALE_MODAL_DELAY_MS = 300;

const NATIVE_WIDGET_TYPES = ["date", "time", "datetime-local"] as const;

const POSITION_HINTS: Array<{ keywords: RegExp; biasToward: "first" | "last" }> = [
  { keywords: /start|begin|from|earliest|since/i, biasToward: "first" },
  { keywords: /end|finish|to|until|latest/i, biasToward: "last" },
];

const FILL_VALUE_SCHEMA = z.object({
  value: z.string().describe("The exact value to fill into the input field"),
});

/**
 * Default values for auto-filling required form fields.
 * Keys match input type or hint keyword. Passed into page.evaluate() as serializable data.
 */
const DEFAULT_FIELD_VALUES: Record<string, string> = {
  email: `test-${Date.now()}@example.com`,
  password: 'TestPass123!',
  tel: '+1234567890',
  phone: '+1234567890',
  url: 'https://example.com',
  website: 'https://example.com',
  number: '42',
  textarea: 'Test description content',
};

const CLICK_KEYWORD_PATTERN = /\b(click|press|tap|select|choose|pick|rate|score)\b/i;

const SUBMIT_PATTERN = /Click\s+the\s+["']?(Submit|Save|Create|Add|Done|Finish|Complete|Confirm)["']?\s+button/i;

const MODAL_SELECTORS = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  'dialog[open]',
  '[class*="modal" i]',
  '[class*="dialog" i]',
];

/**
 * Fills empty required form fields with sensible default values.
 *
 * Called in the "failed" branch of executeAdaptiveAct when the instruction is a
 * submit/save action — HTML5 required-field validation silently blocks submission
 * (no DOM change), so the evaluator returns "failed" and this auto-fills to unblock it.
 */
export async function tryFillRequiredInputs(page: Page): Promise<number> {
  const fieldValues = { ...DEFAULT_FIELD_VALUES, email: `test-${Date.now()}@example.com` };

  const filled = await page.evaluate((defaults): number => {
    const selector = [
      'input[required]:not([type="hidden"]):not([type="submit"])',
      ':not([type="button"]):not([type="checkbox"]):not([type="radio"])',
      ', textarea[required]',
      ', select[required]',
    ].join('');

    const fields = Array.from(
      document.querySelectorAll(selector),
    ) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];

    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value',
    )?.set;

    let count = 0;

    for (const el of fields) {
      if ((el as HTMLInputElement).value?.trim()) continue;
      if (!isVisible(el)) continue;

      if (el.tagName.toLowerCase() === 'select') {
        count += fillSelect(el as HTMLSelectElement);
        continue;
      }

      const type = ((el as HTMLInputElement).type ?? '').toLowerCase();
      const hint = buildHint(el as HTMLInputElement);
      const value = resolveValue(type, hint, el as HTMLInputElement, defaults);

      nativeSetter?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      count++;
    }

    return count;

    function isVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }

    function fillSelect(el: HTMLSelectElement): number {
      const firstOption = Array.from(el.options).find(o => o.value);
      if (!firstOption) return 0;
      el.value = firstOption.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    }

    function buildHint(el: HTMLInputElement): string {
      return [
        ...(Array.from(el.labels ?? []).map(l => l.textContent ?? '')),
        el.name, el.id, el.placeholder ?? '',
      ].join(' ').toLowerCase();
    }

    function resolveValue(type: string, hint: string, el: HTMLInputElement, defaults: Record<string, string>): string {
      if (defaults[type]) return defaults[type];
      for (const key of Object.keys(defaults)) {
        if (hint.includes(key)) return defaults[key];
      }
      if (el.tagName.toLowerCase() === 'textarea') return defaults['textarea'] ?? 'Test input';
      if (el.placeholder) return el.placeholder;
      return 'Test input';
    }
  }, fieldValues);

  if (filled > 0) {
    console.log(`[tryFillRequiredInputs] Auto-filled ${filled} empty required field(s)`);
  }
  return filled;
}

/**
 * DOM-based click fallback for elements outside Stagehand's accessibility tree
 * (NPS rating scales, custom-styled radio buttons, aria-label-only elements, etc.).
 *
 * Only activates for click/select/rate-type instructions. Returns true if
 * any strategy successfully interacted with an element.
 */
export async function tryDOMClick(page: Page, instruction: string): Promise<boolean> {
  if (!CLICK_KEYWORD_PATTERN.test(instruction)) return false;

  const target = extractClickTarget(instruction);
  if (!target) return false;

  const clicked = await page.evaluate((tgt) => {
    // Strategy 1: exact text content match (leaf nodes first, then wrappers)
    const clickables = Array.from(document.querySelectorAll(
      'button, [role="button"], label, span, div, a, li, td',
    )) as HTMLElement[];
    const leaves = clickables.filter(el => el.children.length === 0 && el.textContent?.trim() === tgt);
    if (leaves.length > 0) { leaves[0].click(); return true; }
    const wrappers = clickables.filter(el => el.textContent?.trim() === tgt);
    if (wrappers.length > 0) { wrappers[0].click(); return true; }

    // Strategy 2: radio/checkbox by input value or label text
    const radios = Array.from(document.querySelectorAll(
      'input[type="radio"], input[type="checkbox"]',
    )) as HTMLInputElement[];
    const radio = radios.find(r =>
      r.value === tgt || r.labels?.[0]?.textContent?.trim() === tgt,
    );
    if (radio) { radio.click(); return true; }

    // Strategy 3: number/range input via native value setter
    const numVal = Number(tgt);
    if (!isNaN(numVal)) {
      const ranges = Array.from(document.querySelectorAll(
        'input[type="number"], input[type="range"]',
      )) as HTMLInputElement[];
      const range = ranges.find(r =>
        numVal >= Number(r.min || 0) && numVal <= Number(r.max || 100),
      );
      if (range) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(range, String(numVal));
        range.dispatchEvent(new Event('input', { bubbles: true }));
        range.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }

    // Strategy 4: aria-label or data-value attribute
    const ariaEl = document.querySelector(
      `[aria-label="${tgt}"], [data-value="${tgt}"]`,
    ) as HTMLElement | null;
    if (ariaEl) { ariaEl.click(); return true; }

    return false;
  }, target);

  if (clicked) {
    console.log(`[tryDOMClick] DOM interaction succeeded for target "${target}" in: "${instruction.slice(0, 60)}"`);
    await delay(POST_CLICK_DELAY_MS);
  }
  return clicked;
}

function extractClickTarget(instruction: string): string | null {
  const quotedMatch = instruction.match(/["']([^"']+)["']/);
  const numberMatch = instruction.match(/\b(\d{1,2})\b/);
  return quotedMatch?.[1] ?? numberMatch?.[1] ?? null;
}

/**
 * Fallback for native browser widget inputs (date, time, datetime-local) that
 * Stagehand's act() cannot reach due to shadow DOM internals.
 *
 * Returns null if no native inputs are found on the page.
 */
export async function tryNativeInputFill(
  page: Page,
  stagehand: Stagehand,
  instruction: string,
): Promise<(() => Promise<void>) | null> {
  const nativeSelector = NATIVE_WIDGET_TYPES.map(t => `input[type="${t}"]`).join(", ");
  const inputs = await page.evaluate((sel) => {
    const els = document.querySelectorAll(sel) as NodeListOf<HTMLInputElement>;
    return Array.from(els).map(el => ({
      id: el.id, name: el.name, type: el.type, value: el.value,
    }));
  }, nativeSelector);

  if (inputs.length === 0) return null;

  const target = resolveNativeInputTarget(inputs, instruction);
  const value = await extractNativeInputValue(stagehand, instruction, target);
  const selector = buildNativeInputSelector(target);

  console.log(`[nativeInputFill] Filling "${selector}" with "${value}" for: "${instruction.slice(0, 60)}"`);

  return async () => {
    await page.locator(selector).fill(value);
    await page.locator(selector).dispatchEvent("change");
  };
}

function resolveNativeInputTarget(
  inputs: Array<{ id: string; name: string; type: string; value: string }>,
  instruction: string,
): typeof inputs[0] {
  const instructionLower = instruction.toLowerCase();
  const idMatch = inputs.find(el =>
    (el.id && instructionLower.includes(el.id.toLowerCase())) ||
    (el.name && instructionLower.includes(el.name.toLowerCase()))
  );
  if (idMatch) return idMatch;

  for (const hint of POSITION_HINTS) {
    if (hint.keywords.test(instruction)) {
      return hint.biasToward === "last" ? inputs[inputs.length - 1] : inputs[0];
    }
  }
  return inputs[0];
}

async function extractNativeInputValue(
  stagehand: Stagehand, instruction: string, target: { id: string; type: string },
): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const prompt = `The goal is: "${instruction}".
There is an input[type="${target.type}"] field (id="${target.id || "unknown"}") on the page.
What value should be filled? Use YYYY-MM-DD format for dates.
Today is ${today}. Use a reasonable value (e.g., for a "start date" filter use 30 days ago; for "end date" use today).
Respond with only the value string, nothing else.`;

  const { value } = await (stagehand as any).extract(prompt, FILL_VALUE_SCHEMA);
  return value;
}

function buildNativeInputSelector(target: { id: string; name: string; type: string }): string {
  if (target.id) return `#${target.id}`;
  if (target.name) return `input[type="${target.type}"][name="${target.name}"]`;
  return `input[type="${target.type}"]`;
}

/**
 * Execute a page action (navigation or refresh) with shared try/catch pattern.
 */
export async function executePageAction(
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
 * Wrapper around stagehand.act() that retries on transient API errors.
 */
export async function actWithRetry(
  stagehand: Stagehand,
  instruction: string,
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await stagehand.act(instruction);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRetryableError(msg) && attempt < maxAttempts - 1) {
        console.log(`[actWithRetry] Retrying (attempt ${attempt + 1}): ${msg.slice(0, 80)}`);
        await delay(RETRY_DELAY);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Pre-flight modal dismissal. Clears any stale overlay left over from a previous step.
 * Returns true if a modal was detected and dismissed.
 */
export async function dismissStaleModal(page: Page): Promise<boolean> {
  const modalFound = await page.evaluate((selectors) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (
        rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      ) {
        return true;
      }
    }
    return false;
  }, MODAL_SELECTORS);

  if (!modalFound) return false;

  await page.keyboard.press('Escape');
  await delay(STALE_MODAL_DELAY_MS);
  console.log('[dismissStaleModal] Pressed Escape to clear stale modal');
  return true;
}

/**
 * Returns true if the instruction is a submit/save-type action.
 */
export function isSubmitAction(instruction: string): boolean {
  return SUBMIT_PATTERN.test(instruction) || /\b(submit|save)\b/i.test(instruction);
}

/** Delay helper for retry and stabilization logic. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Check if an error is retryable (transient API errors). */
export function isRetryableError(message: string): boolean {
  return /schema|No object generated|rate|timeout|ECONNRESET|ETIMEDOUT/i.test(message);
}
