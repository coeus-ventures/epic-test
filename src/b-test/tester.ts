import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

/**
 * Generic page interface that works with both Playwright and Stagehand pages.
 * Uses the common subset of methods available in both.
 */
interface GenericPage {
  url(): string;
  // Playwright uses content(), Stagehand uses mainFrame().evaluate()
  content?: () => Promise<string>;
  mainFrame?: () => { evaluate: <R>(fn: () => R) => Promise<R> };
  // Playwright's accessibility
  accessibility?: { snapshot: () => Promise<unknown> };
}

export interface Snapshot {
  id: string;
  html: string;
  timestamp: number;
  url?: string;
}

export interface DiffResult {
  changes: Array<{
    type: "added" | "removed" | "modified" | "textdiff";
    element: string;
    attributes?: Record<string, unknown>;
    oldValue?: unknown;
    newValue?: unknown;
  }>;
  summary: string;
}

export class TesterError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "TesterError";
  }
}

/**
 * Testing service that captures HTML snapshots and uses LLM-powered assertions
 * to verify page conditions. Works with both Playwright and Stagehand pages.
 */
export class Tester {
  private snapshots: Map<string, Snapshot> = new Map();
  private currentSnapshot: Snapshot | null = null;
  private beforeSnapshot: Snapshot | null = null;
  private afterSnapshot: Snapshot | null = null;
  private snapshotCounter: number = 0;

  constructor(
    private readonly page?: GenericPage,
    private readonly aiModel = openai("gpt-4o-mini")
  ) {}

  /**
   * Gets page HTML content - supports both Playwright and Stagehand pages.
   */
  private async getPageContent(page: GenericPage): Promise<string> {
    if (typeof page.content === "function") {
      return page.content();
    } else if (typeof page.mainFrame === "function") {
      return page.mainFrame().evaluate(() => document.documentElement.outerHTML);
    }
    throw new Error("Page does not support content() or mainFrame().evaluate()");
  }

  /**
   * Captures current page HTML.
   * Works with both Playwright pages (content()) and Stagehand pages (mainFrame().evaluate()).
   * @param page - Optional page to snapshot (uses constructor page if not provided)
   * @returns Success boolean and snapshot ID
   */
  async snapshot(
    page?: GenericPage
  ): Promise<{ success: boolean; snapshotId: string }> {
    const targetPage = page || this.page;

    if (!targetPage) {
      throw new TesterError("No page provided for snapshot", "NO_PAGE");
    }

    try {
      // Capture HTML content - support both Playwright and Stagehand pages
      const html = await this.getPageContent(targetPage);
      const url = targetPage.url();
      const timestamp = Date.now();
      const snapshotId = `snapshot_${++this.snapshotCounter}_${timestamp}`;

      const snapshot: Snapshot = {
        id: snapshotId,
        html,
        timestamp,
        url,
      };

      // Store snapshot with unique identifier
      this.snapshots.set(snapshotId, snapshot);

      // Store as current snapshot for assert() calls
      this.currentSnapshot = snapshot;

      // Update before/after snapshots based on sequence
      if (!this.beforeSnapshot) {
        this.beforeSnapshot = snapshot;
      } else {
        this.afterSnapshot = snapshot;
      }

      return { success: true, snapshotId };
    } catch (error) {
      throw new TesterError(
        `Failed to capture snapshot: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "SNAPSHOT_FAILED"
      );
    }
  }

  /**
   * Uses diff between stored snapshot and current page state to assert a condition using LLM
   * @param condition - Natural language condition to check
   * @returns Boolean result of assertion
   */
  async assert(condition: string): Promise<boolean> {
    try {
      // Get diff between stored snapshot and current page state
      const diffResult = await this.diff();

      // Send diff summary and changes to LLM for evaluation
      const response = await generateText({
        model: this.aiModel,
        messages: [
          {
            role: "system",
            content: `You are a testing assistant that evaluates page changes against conditions.
Analyze the provided diff of changes and determine if the specified condition is met.
Focus on what has changed in the page, not the entire content.
Respond with only "true" or "false" followed by a brief explanation.`,
          },
          {
            role: "user",
            content: `Page Changes:
${diffResult.summary}

Changes Details:
${diffResult.changes
  .map(
    (c) => `- ${c.type}: ${c.element} ${c.newValue ? `(${c.newValue})` : ""}`
  )
  .join("\n")}

Condition to check: "${condition}"

Based on these changes, is this condition met? (respond with true/false and explanation)`,
          },
        ],
        temperature: 0,
      });

      const result = response.text;
      const isTrue = result.toLowerCase().startsWith("true");

      // Log assertion result for test output
      console.log(`Assertion "${condition}": ${result}`);

      return isTrue;
    } catch (error) {
      throw new TesterError(
        `Assertion failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "ASSERTION_FAILED"
      );
    }
  }

  /**
   * Compares stored snapshot with current page state
   * @returns Structured diff of changes between stored snapshot and current page
   */
  async diff(): Promise<DiffResult> {
    if (!this.beforeSnapshot || !this.afterSnapshot) {
      throw new TesterError(
        "Need both before and after snapshots for diff. Call snapshot() twice.",
        "NO_SNAPSHOTS"
      );
    }

    try {
      // If HTML hasn't changed, no diff needed
      if (this.beforeSnapshot.html === this.afterSnapshot.html) {
        return {
          changes: [],
          summary: "No changes detected",
        };
      }

      // Get accessibility tree snapshot for both states
      let afterAccessibility;

      try {
        if (!this.page) throw new Error("No page available");
        if (!this.page.accessibility) throw new Error("Accessibility not available");

        // We need to capture the current accessibility tree as "after"
        afterAccessibility = await this.page.accessibility.snapshot();
      } catch {
        // Fallback to basic HTML diff if accessibility tree fails
        return {
          changes: [
            {
              type: "modified" as const,
              element: "page-content",
              attributes: {},
              oldValue: "previous page state",
              newValue: "current page state",
            },
          ],
          summary: "Page content has changed (HTML level)",
        };
      }

      // Create a simplified representation of the current page
      const getPageElements = (snapshot: unknown): string[] => {
        const elements: string[] = [];

        const traverse = (node: unknown) => {
          if (node && typeof node === "object") {
            const n = node as {
              role?: string;
              name?: string;
              value?: string;
              children?: unknown[];
            };
            if (n.role) {
              let elementDesc = n.role;
              if (n.name) elementDesc += `: "${n.name}"`;
              if (n.value) elementDesc += ` = "${n.value}"`;
              elements.push(elementDesc);
            }
            if (n.children) {
              n.children.forEach(traverse);
            }
          }
        };

        if (snapshot) traverse(snapshot);
        return elements;
      };

      const currentElements = getPageElements(afterAccessibility);

      // Generate a summary of what's visible on the page now
      const summary =
        currentElements.length > 0
          ? `Page now contains: ${currentElements.slice(0, 10).join(", ")}${
              currentElements.length > 10 ? "..." : ""
            }`
          : "Page content has changed";

      return {
        changes: [
          {
            type: "modified" as const,
            element: "page-accessibility-tree",
            attributes: {},
            oldValue: "previous state",
            newValue: summary,
          },
        ],
        summary,
      };
    } catch (error) {
      throw new TesterError(
        `Diff generation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "DIFF_FAILED"
      );
    }
  }

  /**
   * Repeatedly snapshots page until condition is met
   * @param condition - Natural language condition to wait for
   * @param timeout - Maximum time to wait in milliseconds (default: 30000)
   * @returns True when condition is met, throws on timeout
   */
  async waitFor(condition: string, timeout: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 500; // Poll every 500ms
    let lastHtml: string | null = null;

    if (!this.page) {
      throw new TesterError("No page provided for waitFor", "NO_PAGE");
    }

    while (Date.now() - startTime < timeout) {
      try {
        // Capture current HTML - support both Playwright and Stagehand pages
        const currentHtml = await this.getPageContent(this.page);

        // Only check condition if page has changed
        if (currentHtml !== lastHtml) {
          // Take new snapshot since content changed - this updates currentSnapshot
          await this.snapshot();

          // LLM checks condition on new snapshot (diff will compare old vs new)
          const conditionMet = await this.assert(condition);

          if (conditionMet) {
            return true;
          }

          // Update last HTML for next comparison
          lastHtml = currentHtml;
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error) {
        // Continue polling on non-critical errors
        if (error instanceof TesterError && error.code === "ASSERTION_FAILED") {
          throw error;
        }
      }
    }

    throw new TesterError(
      `Timeout waiting for condition: "${condition}" after ${timeout}ms`,
      "WAIT_TIMEOUT"
    );
  }

  /**
   * Get a specific snapshot by ID
   */
  getSnapshot(snapshotId: string): Snapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * Get all stored snapshots
   */
  getAllSnapshots(): Snapshot[] {
    return Array.from(this.snapshots.values());
  }

  /**
   * Clear all stored snapshots
   */
  clearSnapshots(): void {
    this.snapshots.clear();
    this.currentSnapshot = null;
    this.beforeSnapshot = null;
    this.afterSnapshot = null;
    this.snapshotCounter = 0;
  }

  /**
   * Set a specific snapshot as the reference for diff comparison
   * @param snapshotId - ID of snapshot to use as reference for diff
   */
  setReferenceSnapshot(snapshotId: string): void {
    const snapshot = this.snapshots.get(snapshotId);

    if (!snapshot) {
      throw new TesterError(
        "Invalid snapshot ID provided",
        "INVALID_SNAPSHOT_ID"
      );
    }

    this.currentSnapshot = snapshot;
  }
}
