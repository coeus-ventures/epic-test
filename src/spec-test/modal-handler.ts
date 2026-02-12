import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { SpecStep } from "./types";
import { isModalTriggerAction, isModalDismissAction } from "./step-execution";

/** Result of a DOM-based modal detection scan. */
export interface ModalDetection {
  /** CSS selector that matched the modal element */
  selector: string;
  /** Selector for the confirm/action button inside the modal, if found */
  confirmButton: string | null;
}

/**
 * Combined modal selector — single querySelectorAll traversal.
 * O(N) where N = DOM nodes, instead of O(S × N) with separate queries.
 */
const MODAL_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  'dialog[open]',
  '[class*="modal" i]',
  '[class*="dialog" i]',
  '[class*="overlay" i]',
].join(', ');

/**
 * Detect a visible modal/dialog in the DOM using a single combined CSS query.
 * Returns modal info with optional confirm button selector, or null if none found.
 *
 * Complexity: O(N + B) — one DOM traversal for modal candidates, one scan of
 * buttons inside the first visible match. N = total DOM nodes, B = buttons in modal.
 */
export async function detectModalInDOM(page: Page): Promise<ModalDetection | null> {
  try {
    return await page.evaluate((selector: string) => {
      const confirmRe = /^(confirm|ok|yes|delete|remove|archive|submit|save|apply|approve)$/i;
      const cancelRe = /^(cancel|close|dismiss|no|back|never\s*mind)$/i;

      const candidates = document.querySelectorAll(selector);
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i] as HTMLElement;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

        // Overlay-class elements need interactive children to be considered modals
        if (el.className?.includes?.('overlay') && !el.querySelector('button, input, [role="button"], a')) continue;

        // Find confirm button via .find() on the button list
        const buttons = el.querySelectorAll('button, [role="button"], input[type="submit"]');
        let confirmButton: string | null = null;

        for (let j = 0; j < buttons.length; j++) {
          const btn = buttons[j] as HTMLElement;
          const text = btn.textContent?.trim() ?? '';
          if (cancelRe.test(text)) continue;
          if (confirmRe.test(text)) {
            // Prefer ID, then data-testid, then :has-text-style positional selector
            if (btn.id) {
              confirmButton = `#${btn.id}`;
            } else if (btn.dataset.testid) {
              confirmButton = `[data-testid="${btn.dataset.testid}"]`;
            } else {
              // Nth-of-type inside the modal — more specific than generic "button"
              confirmButton = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} button:nth-of-type(${j + 1})`;
            }
            break;
          }
        }

        // Build a stable selector for the modal itself
        const modalSelector = el.id ? `#${el.id}` : (el.getAttribute('role') ? `[role="${el.getAttribute('role')}"]` : el.tagName.toLowerCase());
        return { selector: modalSelector, confirmButton };
      }
      return null;
    }, MODAL_SELECTOR);
  } catch {
    return null;
  }
}

/**
 * Auto-confirm a modal by clicking its confirm/action button.
 * DOM-first (fast, deterministic), Stagehand fallback (for non-standard modals).
 * Returns true if a modal was confirmed, false if none found or click failed.
 */
export async function autoConfirmModal(page: Page, stagehand: Stagehand): Promise<boolean> {
  const modal = await detectModalInDOM(page);
  if (!modal) return false;

  try {
    if (modal.confirmButton) {
      // DOM-first: click the identified confirm button
      await page.click(modal.confirmButton, { timeout: 2000 });
      console.log(`[autoConfirmModal] Clicked confirm button via DOM: ${modal.confirmButton}`);
    } else {
      // LLM fallback: ask Stagehand to find and click the confirm button
      await stagehand.act('Click the confirm, OK, submit, or primary action button in the modal/dialog');
      console.log(`[autoConfirmModal] Confirmed modal via Stagehand fallback`);
    }
    // Wait for modal dismissal animation
    await new Promise(resolve => setTimeout(resolve, 500));
    return true;
  } catch (error) {
    console.log(`[autoConfirmModal] Failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Dismiss a leftover modal/overlay by pressing Escape or clicking cancel.
 * Returns true if a modal was found and dismissed, false if none detected.
 */
export async function dismissLeftoverModal(page: Page): Promise<boolean> {
  const modal = await detectModalInDOM(page);
  if (!modal) return false;

  console.log(`[dismissLeftoverModal] Found leftover modal: ${modal.selector}`);

  try {
    // Try Escape key first (works for most modals)
    await page.keyboard.press('Escape');
    await new Promise(resolve => setTimeout(resolve, 300));

    // Check if modal is still present
    const stillPresent = await detectModalInDOM(page);
    if (!stillPresent) {
      console.log(`[dismissLeftoverModal] Dismissed via Escape`);
      return true;
    }

    // Try clicking cancel/close button inside modal
    const dismissed = await page.evaluate((sel: string) => {
      const cancelRe = /^(cancel|close|dismiss|no|×|✕|x)$/i;
      const el = document.querySelector(sel);
      if (!el) return false;

      const buttons = el.querySelectorAll('button, [role="button"]');
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i] as HTMLElement;
        const text = btn.textContent?.trim() ?? '';
        if (cancelRe.test(text) || btn.getAttribute('aria-label')?.match(/close/i)) {
          btn.click();
          return true;
        }
      }
      return false;
    }, modal.selector);

    if (dismissed) {
      await new Promise(resolve => setTimeout(resolve, 300));
      console.log(`[dismissLeftoverModal] Dismissed via cancel/close button`);
      return true;
    }

    // Last resort: click backdrop/overlay if it exists
    await page.keyboard.press('Escape');
    await new Promise(resolve => setTimeout(resolve, 300));
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide whether to auto-confirm a modal after a trigger action.
 * Returns true when the spec doesn't have an explicit confirm/cancel step next.
 */
export function shouldAutoConfirmModal(
  currentStep: SpecStep,
  nextStep: SpecStep | undefined
): boolean {
  // Only auto-confirm after modal trigger actions
  if (!isModalTriggerAction(currentStep.instruction)) return false;

  // If there's no next step, auto-confirm (end of behavior)
  if (!nextStep) return true;

  // If next step is an explicit modal dismiss (confirm/cancel/dismiss),
  // the spec handles it — don't auto-confirm
  if (nextStep.type === 'act' && isModalDismissAction(nextStep.instruction)) return false;

  // Next step is a Check or a non-modal Act — auto-confirm
  return true;
}
