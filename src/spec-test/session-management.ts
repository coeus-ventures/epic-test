// ============================================================================
// SESSION MANAGEMENT — browser session, navigation, auth recovery, port detection
// ============================================================================

import type { Page } from "playwright";
import type { Stagehand } from "@browserbasehq/stagehand";

/** Compare URLs ignoring trailing slashes. */
export function urlsMatch(a: string, b: string): boolean {
  return a.replace(/\/$/, '') === b.replace(/\/$/, '');
}

/** Detect if the page was redirected to a sign-in/login page. */
export function isSignInRedirect(currentUrl: string, targetUrl: string): boolean {
  if (urlsMatch(currentUrl, targetUrl)) return false;
  const path = new URL(currentUrl).pathname.toLowerCase();
  return /\/(sign[-_]?in|login|auth)/.test(path);
}

/**
 * Auto-detect the port the application is running on.
 * Tries the configured port first, then probes common alternatives (Vite, Angular, etc.).
 * Returns the (possibly updated) baseUrl.
 */
export async function detectPort(page: Page, baseUrl: string): Promise<string> {
  const url = new URL(baseUrl);
  const baseHost = url.hostname;
  const expectedPort = url.port || '3000';
  const alternativePorts = [3000, 5173, 8080, 4200, 3001];

  // 1. Try configured port first
  try {
    const response = await page.goto(`http://${baseHost}:${expectedPort}`, { timeout: 5000 });
    if (response?.ok()) {
      console.log(`[detectPort] App responding on configured port ${expectedPort}`);
      return baseUrl;
    }
  } catch { /* configured port failed */ }

  // 2. Probe alternative ports
  for (const port of alternativePorts) {
    if (String(port) === expectedPort) continue;
    try {
      const response = await page.goto(`http://${baseHost}:${port}`, { timeout: 3000 });
      if (response?.ok()) {
        const newBase = `http://${baseHost}:${port}`;
        console.log(`[detectPort] App found on port ${port} (expected ${expectedPort}). Overriding baseUrl to ${newBase}.`);
        return newBase;
      }
    } catch { /* port not responding */ }
  }

  console.log(`[detectPort] No app found on any probed port — using configured ${expectedPort}`);
  return baseUrl;
}

/**
 * Hard reset: navigate to about:blank → baseUrl → clear all storage/cookies → reload.
 * Guarantees a completely clean SPA state with zero auth tokens or user data.
 */
export async function resetSession(page: Page, baseUrl: string): Promise<void> {
  // 1. Navigate to about:blank to fully unload the SPA (destroys in-memory state).
  await page.goto('about:blank');

  // 2. Navigate to baseUrl to get back on the app's origin.
  await page.goto(baseUrl);

  // 3. Clear localStorage, sessionStorage, and non-HttpOnly cookies on the correct origin.
  await page.evaluate(() => {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    try {
      document.cookie.split(';').forEach(c => {
        const name = c.split('=')[0].trim();
        if (name) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        }
      });
    } catch {}
  }).catch(() => {});

  // 4. Reload so the SPA re-initializes reading the now-empty storage.
  await page.reload();
  await page.waitForLoadState('networkidle');
  console.log(`[resetSession] Hard reset complete. Page URL: ${page.url()}`);
}

/** Attempt to re-authenticate by filling the sign-in form. */
export async function recoverAuth(
  page: Page,
  stagehand: Stagehand,
  credentials: { email: string | null; password: string | null },
  targetUrl: string
): Promise<void> {
  try {
    await stagehand.act(`Type "${credentials.email}" into the email field`);
    await stagehand.act(`Type "${credentials.password}" into the password field`);
    await stagehand.act('Click the sign in button');
    await page.waitForLoadState('networkidle');

    // Navigate to the original target after re-auth
    const afterAuth = page.url();
    if (!urlsMatch(afterAuth, targetUrl)) {
      await page.evaluate((url: string) => { window.location.href = url; }, targetUrl);
      await page.waitForLoadState('networkidle');
    }
    console.log(`[navigateToPagePath] Auth recovery succeeded. Page URL: ${page.url()}`);
  } catch (error) {
    console.log(`[navigateToPagePath] Auth recovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Navigate to a page path while preserving the current session.
 * Uses soft navigation (window.location.href) instead of page.goto() to avoid
 * destroying SPA in-memory auth state. Includes auth recovery if session is lost.
 */
export async function navigateToPagePath(
  page: Page,
  pagePath: string,
  baseUrl: string,
  stagehand?: Stagehand,
  credentials?: { email: string | null; password: string | null }
): Promise<void> {
  // Resolve parameterized routes to their parent path (e.g., /surveys/:id → /surveys)
  // The behavior's steps handle navigating to the specific instance.
  let resolvedPath = pagePath;
  if (/:\w+/.test(resolvedPath)) {
    resolvedPath = resolvedPath.replace(/\/:[^/]+/g, '');
    if (!resolvedPath || resolvedPath === '/') {
      console.log(`[navigateToPagePath] Route "${pagePath}" resolves to root, skipping navigation`);
      return;
    }
    console.log(`[navigateToPagePath] Parameterized route "${pagePath}" → resolved to parent "${resolvedPath}"`);
  }

  const targetUrl = `${baseUrl.replace(/\/$/, '')}${resolvedPath}`;
  const currentUrl = page.url();

  // Skip if already on the target URL
  if (urlsMatch(currentUrl, targetUrl)) {
    console.log(`[navigateToPagePath] Already on ${resolvedPath}, skipping navigation`);
    return;
  }

  // Soft navigation (avoids full reload, preserves SPA state)
  console.log(`[navigateToPagePath] Soft-navigating to ${targetUrl}`);
  await page.evaluate((url: string) => { window.location.href = url; }, targetUrl);
  await page.waitForLoadState('networkidle');

  // Auth recovery — detect redirect to sign-in page
  const afterUrl = page.url();
  if (isSignInRedirect(afterUrl, targetUrl) && stagehand && credentials?.email && credentials?.password) {
    console.log(`[navigateToPagePath] Auth lost — detected redirect to ${afterUrl}. Attempting recovery...`);
    await recoverAuth(page, stagehand, credentials, targetUrl);
  } else {
    console.log(`[navigateToPagePath] Page URL after navigation: ${afterUrl}`);
  }
}

/**
 * Clear all visible form fields with React/Vue-compatible approach.
 * Uses native value setters to trigger framework change tracking,
 * then falls back to triple-click + delete for resistant fields.
 */
export async function clearFormFields(page: Page): Promise<void> {
  const FIELD_SELECTOR = 'input:not([type="hidden"]), textarea';

  // Programmatic clearing via native value setters
  await page.evaluate((selector: string) => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    Array.from(document.querySelectorAll(selector)).forEach(el => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      input.focus();

      const setter = el.tagName === 'TEXTAREA' ? nativeTextareaValueSetter : nativeInputValueSetter;
      if (setter) {
        setter.call(input, '');
      } else {
        input.value = '';
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, FIELD_SELECTOR).catch(() => {});

  // Fallback: triple-click + delete for fields that resist programmatic clearing
  try {
    const fieldsStillFilled = await page.evaluate((sel: string) => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(sel));
      return inputs.some(el => {
        const rect = el.getBoundingClientRect();
        return rect.height > 0 && rect.width > 0 && el.value.length > 0;
      });
    }, FIELD_SELECTOR);

    if (fieldsStillFilled) {
      console.log(`[clearFormFields] Fields still have values after programmatic clear — using triple-click+delete fallback`);
      const filledSelectors = await page.evaluate((sel: string) => {
        const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(sel));
        return inputs
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.height > 0 && rect.width > 0 && el.value.length > 0;
          })
          .map((el, i) => {
            if (el.id) return `#${el.id}`;
            if (el.name) return `[name="${el.name}"]`;
            return `input:not([type="hidden"]):nth-of-type(${i + 1})`;
          });
      }, FIELD_SELECTOR);
      for (const selector of filledSelectors) {
        try {
          await page.locator(selector).first().click({ clickCount: 3 });
          await page.keyboard.press('Delete');
        } catch { /* skip this field */ }
      }
    }
  } catch { /* fallback failed, proceed anyway */ }
}
