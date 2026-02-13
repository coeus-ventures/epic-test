import { describe, it, expect, vi } from "vitest";
import { verifyOutcome } from "../verifier";

// Mock Stagehand and Page
function createMockStagehand(extractResults: Record<string, any>) {
  return {
    extract: vi.fn(async (prompt: string, _schema: any) => {
      const match = Object.entries(extractResults).find(([key]) =>
        prompt.includes(key)
      );
      return match?.[1] ?? { passed: false, actual: "No matching mock", reasoning: "No mock found" };
    }),
  } as any;
}

function createMockPage(bodyText: string = "") {
  return {
    evaluate: vi.fn(async (fn: Function, ...args: any[]) => {
      // Simulate document.body.innerText.includes(text)
      if (typeof args[0] === "string") {
        return bodyText.includes(args[0]);
      }
      return false;
    }),
    url: vi.fn(() => "http://localhost:3000/surveys"),
    content: vi.fn(async () => "<html><body></body></html>"),
  } as any;
}

describe("verifyOutcome", () => {
  it("should pass all criteria when extract returns passed=true", async () => {
    const stagehand = createMockStagehand({
      "NPS score is displayed": {
        passed: true,
        actual: "NPS score of 72 shown in header",
        reasoning: "Found NPS score display",
      },
      "chart is visible": {
        passed: true,
        actual: "Bar chart rendered with response data",
        reasoning: "Chart element found",
      },
    });
    const page = createMockPage();

    const { allPassed, results } = await verifyOutcome(
      ["NPS score is displayed", "A response chart is visible"],
      stagehand,
      page
    );

    expect(allPassed).toBe(true);
    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(true);
  });

  it("should fail when any criterion fails", async () => {
    const stagehand = createMockStagehand({
      "survey is saved": {
        passed: true,
        actual: "Survey saved confirmation shown",
        reasoning: "Found success message",
      },
      "email notification sent": {
        passed: false,
        actual: "No notification indicator found",
        reasoning: "No email notification visible on page",
      },
    });
    const page = createMockPage();

    const { allPassed, results } = await verifyOutcome(
      ["The survey is saved", "An email notification sent confirmation is shown"],
      stagehand,
      page
    );

    expect(allPassed).toBe(false);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
    expect(results[1].actual).toBe("No notification indicator found");
  });

  it("should handle extract errors gracefully", async () => {
    const stagehand = {
      extract: vi.fn(async () => {
        throw new Error("LLM API timeout");
      }),
    } as any;
    const page = createMockPage();

    const { allPassed, results } = await verifyOutcome(
      ["Some condition"],
      stagehand,
      page
    );

    expect(allPassed).toBe(false);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].actual).toContain("Verification error");
    expect(results[0].actual).toContain("LLM API timeout");
  });

  it("should return allPassed=true for empty criteria", async () => {
    const stagehand = createMockStagehand({});
    const page = createMockPage();

    const { allPassed, results } = await verifyOutcome([], stagehand, page);

    expect(allPassed).toBe(true);
    expect(results).toHaveLength(0);
  });

  it("should use deterministic fast path when quoted text is found on page", async () => {
    const stagehand = createMockStagehand({});
    const page = createMockPage(
      "Welcome! Your survey Customer Satisfaction Q1 2024 has been created."
    );

    const { allPassed, results } = await verifyOutcome(
      ['The text "Customer Satisfaction Q1 2024" is visible on the page'],
      stagehand,
      page
    );

    expect(allPassed).toBe(true);
    expect(results[0].passed).toBe(true);
    expect(results[0].actual).toContain("Customer Satisfaction Q1 2024");
    // Should NOT have called stagehand.extract() for this one
    expect(stagehand.extract).not.toHaveBeenCalled();
  });

  it("should fall through to semantic when deterministic text not found", async () => {
    const stagehand = createMockStagehand({
      "Customer Satisfaction Q1 2024": {
        passed: true,
        actual: "Found in a list element",
        reasoning: "Text present in survey list",
      },
    });
    // Page text doesn't contain exact match
    const page = createMockPage("Welcome to the surveys page");

    const { allPassed, results } = await verifyOutcome(
      ['The text "Customer Satisfaction Q1 2024" is visible on the page'],
      stagehand,
      page
    );

    expect(allPassed).toBe(true);
    // Should have fallen through to extract()
    expect(stagehand.extract).toHaveBeenCalled();
  });

  it("should handle absence checks when text is correctly not on page", async () => {
    const stagehand = createMockStagehand({});
    const page = createMockPage("Welcome to the dashboard");

    const { allPassed, results } = await verifyOutcome(
      ['The text "Error" is no longer visible on the page'],
      stagehand,
      page
    );

    expect(allPassed).toBe(true);
    expect(results[0].passed).toBe(true);
    expect(results[0].actual).toContain("expected absent");
    expect(stagehand.extract).not.toHaveBeenCalled();
  });

  it("should include reasoning in results when available", async () => {
    const stagehand = createMockStagehand({
      "dashboard is visible": {
        passed: true,
        actual: "Dashboard component rendered with 3 widgets",
        reasoning:
          "Found main dashboard container with analytics widgets",
      },
    });
    const page = createMockPage();

    const { results } = await verifyOutcome(
      ["The dashboard is visible"],
      stagehand,
      page
    );

    expect(results[0].reasoning).toBe(
      "Found main dashboard container with analytics widgets"
    );
  });
});
