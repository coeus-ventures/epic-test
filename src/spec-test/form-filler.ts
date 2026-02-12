// ============================================================================
// FORM FILLER — auto-fill empty required fields before submit
// ============================================================================

import type { Page } from "playwright";

/** Information about an empty required form field extracted from the DOM. */
export interface FormField {
  id: string;
  name: string;
  tagName: string;
  inputType: string;
  placeholder: string;
  label: string;
  selector: string;
}

/**
 * Auto-fill empty required form fields before a submit action.
 * Prevents HTML5 validation from blocking form submission when the spec
 * steps don't fill every required field. Uses DOM inspection to find empty
 * required inputs, then fills with sensible defaults based on field type.
 */
export async function fillEmptyRequiredFields(page: Page): Promise<void> {
  const emptyFields = await page.evaluate(() => {
    const results: Array<{
      id: string;
      name: string;
      tagName: string;
      inputType: string;
      placeholder: string;
      label: string;
      selector: string;
    }> = [];

    const requiredElements = Array.from(document.querySelectorAll(
      'input[required]:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), ' +
      'textarea[required], ' +
      'select[required]'
    ));

    for (const el of requiredElements) {
      const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

      // Skip if already has a value
      if (input.value && input.value.trim() !== '') continue;

      // Skip if not visible
      const rect = input.getBoundingClientRect();
      if (rect.height === 0 || rect.width === 0) continue;
      const style = window.getComputedStyle(input);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      // Build CSS selector
      let selector = '';
      if (input.id) {
        selector = `#${input.id}`;
      } else if (input.name) {
        selector = `${input.tagName.toLowerCase()}[name="${input.name}"]`;
      } else {
        const parent = input.parentElement;
        const siblings = parent ? Array.from(parent.querySelectorAll(input.tagName.toLowerCase())) : [input];
        const idx = siblings.indexOf(input);
        selector = `${input.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;
      }

      // Get associated label text
      let label = '';
      if (input.id) {
        const labelEl = document.querySelector(`label[for="${input.id}"]`);
        if (labelEl) label = (labelEl.textContent || '').trim();
      }
      if (!label && input.closest('label')) {
        label = (input.closest('label')!.textContent || '').trim();
      }

      results.push({
        id: input.id || '',
        name: input.name || '',
        tagName: input.tagName.toLowerCase(),
        inputType: (input as HTMLInputElement).type || '',
        placeholder: (input as HTMLInputElement).placeholder || '',
        label,
        selector,
      });
    }

    return results;
  });

  if (emptyFields.length === 0) return;

  console.log(`[fillEmptyRequiredFields] Found ${emptyFields.length} empty required field(s)`);

  for (const field of emptyFields) {
    const desc = field.label || field.name || field.id || field.selector;

    if (field.tagName === 'select') {
      try {
        const firstValue = await page.evaluate((sel: string) => {
          const select = document.querySelector(sel) as HTMLSelectElement;
          if (!select) return null;
          for (const opt of Array.from(select.options)) {
            if (opt.value && opt.value.trim()) return opt.value;
          }
          return null;
        }, field.selector);

        if (firstValue) {
          await page.locator(field.selector).first().selectOption(firstValue);
          console.log(`[fillEmptyRequiredFields] Selected "${firstValue}" for ${desc}`);
        }
      } catch (err) {
        console.log(`[fillEmptyRequiredFields] Failed to select for "${desc}": ${err}`);
      }
      continue;
    }

    const value = generateFillValue(field);
    if (!value) continue;

    console.log(`[fillEmptyRequiredFields] Filling "${desc}" with "${value}"`);
    try {
      await page.locator(field.selector).first().fill(value);
    } catch (err) {
      console.log(`[fillEmptyRequiredFields] Failed to fill "${desc}": ${err}`);
    }
  }
}

/**
 * Generate a sensible fill value for an empty required form field.
 * Uses field type, name, label, and placeholder to infer the best value.
 */
export function generateFillValue(field: {
  inputType: string;
  name: string;
  label: string;
  placeholder: string;
  tagName: string;
}): string {
  const hint = `${field.label} ${field.name} ${field.placeholder}`.toLowerCase();

  if (field.inputType === 'email' || hint.includes('email')) {
    return `test-${Date.now()}@example.com`;
  }
  if (field.inputType === 'password' || hint.includes('password')) {
    return 'TestPass123!';
  }
  if (field.inputType === 'tel' || hint.includes('phone') || hint.includes('tel')) {
    return '+1234567890';
  }
  if (field.inputType === 'url' || hint.includes('url') || hint.includes('website')) {
    return 'https://example.com';
  }
  if (field.inputType === 'number') {
    return '42';
  }
  if (field.tagName === 'textarea') {
    return 'Test description content';
  }
  // Use placeholder if available, otherwise generic text
  if (field.placeholder) {
    return field.placeholder;
  }
  return 'Test input';
}
