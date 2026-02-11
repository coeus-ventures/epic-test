import { describe, it, expect, vi } from 'vitest';
import {
  isNavigationAction,
  isRefreshAction,
  isSaveAction,
  extractExpectedText,
  extractNavigationTarget,
  extractSelectAction,
  executeActStep,
  executeCheckStep,
  generateFailureContext,
} from '../index';
import type { Stagehand } from "@browserbasehq/stagehand";
import type { Page } from "playwright";
import type { Tester } from "../../b-test";
import type { SpecStep } from "../types";

describe('isNavigationAction', () => {
  it('should detect full URLs', () => {
    expect(isNavigationAction('Navigate to http://localhost:3000/login')).toBe('http://localhost:3000/login');
    expect(isNavigationAction('Go to https://example.com')).toBe('https://example.com');
  });

  it('should detect relative paths with navigate/go/open/visit', () => {
    expect(isNavigationAction('Navigate to /login')).toBe('/login');
    expect(isNavigationAction('Go to /dashboard')).toBe('/dashboard');
    expect(isNavigationAction('Open /settings')).toBe('/settings');
    expect(isNavigationAction('Visit /profile')).toBe('/profile');
  });

  it('should return null for non-navigation actions', () => {
    expect(isNavigationAction('Click the Login button')).toBeNull();
    expect(isNavigationAction('Type "hello" into the field')).toBeNull();
    expect(isNavigationAction('Select "Option A" from dropdown')).toBeNull();
  });

  it('should not match non-path arguments', () => {
    expect(isNavigationAction('Navigate to the settings page')).toBeNull();
    expect(isNavigationAction('Go to home')).toBeNull();
  });
});

describe('isRefreshAction', () => {
  it('should match refresh instructions', () => {
    expect(isRefreshAction('Refresh the page')).toBe(true);
    expect(isRefreshAction('Reload the page')).toBe(true);
    expect(isRefreshAction('Refresh page')).toBe(true);
    expect(isRefreshAction('Reload page')).toBe(true);
    expect(isRefreshAction('refresh')).toBe(true);
    expect(isRefreshAction('reload')).toBe(true);
  });

  it('should not match non-refresh instructions', () => {
    expect(isRefreshAction('Click refresh button')).toBe(false);
    expect(isRefreshAction('Type "reload" into field')).toBe(false);
  });
});

describe('isSaveAction', () => {
  it('should match save/submit/publish click instructions', () => {
    expect(isSaveAction('Click the "Save" button')).toBe(true);
    expect(isSaveAction('Click Save')).toBe(true);
    expect(isSaveAction('Click "Save Order"')).toBe(true);
    expect(isSaveAction('Click Submit')).toBe(true);
    expect(isSaveAction('Click the submit button')).toBe(true);
    expect(isSaveAction('Click "Publish"')).toBe(true);
    expect(isSaveAction('Press the Save button')).toBe(true);
  });

  it('should NOT match non-save actions', () => {
    expect(isSaveAction('Click the "Add Contact" button')).toBe(false);
    expect(isSaveAction('Click Create')).toBe(false);
    expect(isSaveAction('Click the "Delete" button')).toBe(false);
    expect(isSaveAction('Type "Save" into the input')).toBe(false);
    expect(isSaveAction('Navigate to /save')).toBe(false);
  });
});

describe('extractSelectAction', () => {
  it('should match "Select X from dropdown" patterns', () => {
    expect(extractSelectAction('Select "Open" from the status dropdown')).toEqual({ value: 'Open' });
    expect(extractSelectAction("Choose 'High' from the priority dropdown")).toEqual({ value: 'High' });
    expect(extractSelectAction('Select "Technology" from category')).toEqual({ value: 'Technology' });
    expect(extractSelectAction("Select 'Closed' from the filter")).toEqual({ value: 'Closed' });
  });

  it('should match "Change/Set X to Y" patterns', () => {
    expect(extractSelectAction('Change status to "Resolved"')).toEqual({ value: 'Resolved' });
    expect(extractSelectAction("Set priority to 'Critical'")).toEqual({ value: 'Critical' });
  });

  it('should match bare "Select X" patterns', () => {
    expect(extractSelectAction('Select "Open"')).toEqual({ value: 'Open' });
    expect(extractSelectAction("Choose 'Pending'")).toEqual({ value: 'Pending' });
  });

  it('should NOT match non-select instructions', () => {
    expect(extractSelectAction('Click the "Add" button')).toBeNull();
    expect(extractSelectAction('Type "hello" into the input')).toBeNull();
    expect(extractSelectAction('Navigate to /settings')).toBeNull();
  });
});

describe('extractExpectedText', () => {
  it('should extract quoted text from "see" instructions', () => {
    const result = extractExpectedText('Should see "Welcome back"');
    expect(result).toEqual({ text: 'Welcome back', shouldExist: true });
  });

  it('should extract quoted text from "display" instructions', () => {
    const result = extractExpectedText('Should display "Error occurred"');
    expect(result).toEqual({ text: 'Error occurred', shouldExist: true });
  });

  it('should handle "no longer" as negative assertion', () => {
    const result = extractExpectedText('The text "Loading" no longer appears');
    expect(result).toEqual({ text: 'Loading', shouldExist: false });
  });

  it('should return null for instructions without quoted text', () => {
    expect(extractExpectedText('URL contains /dashboard')).toBeNull();
    expect(extractExpectedText('Page title is Home')).toBeNull();
  });

  it('should handle single quotes', () => {
    const result = extractExpectedText("Should see 'Welcome back'");
    expect(result).toEqual({ text: 'Welcome back', shouldExist: true });
  });
});

describe('extractNavigationTarget', () => {
  it('should detect "Click X in the navigation" pattern', () => {
    expect(extractNavigationTarget('Click the Contacts button in the navigation')).toBe('contacts');
  });

  it('should detect "Click X in the sidebar" pattern', () => {
    expect(extractNavigationTarget('Click Jobs in the sidebar')).toBe('jobs');
  });

  it('should detect "Click X in the menu" pattern', () => {
    expect(extractNavigationTarget('Click Dashboard in the menu')).toBe('dashboard');
  });

  it('should detect "Click X in the header" pattern', () => {
    expect(extractNavigationTarget('Click Dashboard in the header')).toBe('dashboard');
  });

  it('should detect "Click X item in the left panel" pattern', () => {
    expect(extractNavigationTarget('Click Candidates item in the left panel')).toBe('candidates');
  });

  it('should detect "Navigate to X page" pattern', () => {
    expect(extractNavigationTarget('Navigate to the Settings page')).toBe('settings');
  });

  it('should detect "Go to X section" pattern', () => {
    expect(extractNavigationTarget('Go to the Candidates section')).toBe('candidates');
  });

  it('should detect "Go to X page" pattern', () => {
    expect(extractNavigationTarget('Go to the Tasks page')).toBe('tasks');
  });

  it('should detect "Navigate to X section" pattern', () => {
    expect(extractNavigationTarget('Navigate to the Reports section')).toBe('reports');
  });

  it('should return null for non-navigation actions', () => {
    expect(extractNavigationTarget('Click the Submit button')).toBeNull();
    expect(extractNavigationTarget('Click the "Add" button')).toBeNull();
    expect(extractNavigationTarget('Type "hello" into the search field')).toBeNull();
    expect(extractNavigationTarget('Select "Option A" from dropdown')).toBeNull();
    expect(extractNavigationTarget('Check the "Agree" checkbox')).toBeNull();
  });
});

describe("executeActStep", () => {
  it("should return success with page URL when action succeeds", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080/dashboard"),
    };
    const mockStagehand = {
      act: vi.fn().mockResolvedValue(undefined),
      context: {
        activePage: vi.fn().mockReturnValue(mockPage),
      },
    } as unknown as Stagehand;

    const result = await executeActStep("User clicks Login button", mockStagehand);

    expect(result.success).toBe(true);
    expect(result.pageUrl).toBe("http://localhost:8080/dashboard");
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(mockStagehand.act).toHaveBeenCalledWith("User clicks Login button");
  });

  it("should return failure with error when action fails", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080/login"),
      evaluate: vi.fn().mockResolvedValue("<html><body>Login page</body></html>"),
    };
    const mockStagehand = {
      act: vi.fn().mockRejectedValue(new Error("Element not found")),
      context: {
        activePage: vi.fn().mockReturnValue(mockPage),
      },
      observe: vi.fn().mockResolvedValue([
        { description: "Click Sign Up button" },
        { description: "Enter text in email field" },
      ]),
    } as unknown as Stagehand;

    const result = await executeActStep("User clicks non-existent button", mockStagehand);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Element not found");
    expect(result.pageSnapshot).toBe("<html><body>Login page</body></html>");
    expect(result.availableActions).toEqual([
      "Click Sign Up button",
      "Enter text in email field",
    ]);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("should measure duration correctly", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080/dashboard"),
    };
    const mockStagehand = {
      act: vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 50))),
      context: {
        activePage: vi.fn().mockReturnValue(mockPage),
      },
    } as unknown as Stagehand;

    const result = await executeActStep("User waits", mockStagehand);

    expect(result.duration).toBeGreaterThanOrEqual(50);
  });
});

describe("executeCheckStep", () => {
  it("should pass deterministic URL contains check", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080/dashboard"),
    } as unknown as Page;
    const mockTester = {} as Tester;

    const result = await executeCheckStep("URL contains /dashboard", "deterministic", mockPage, mockTester);

    expect(result.passed).toBe(true);
    expect(result.checkType).toBe("deterministic");
    expect(result.expected).toBe("/dashboard");
    expect(result.actual).toBe("http://localhost:8080/dashboard");
  });

  it("should fail deterministic URL contains check when not matching", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080/login"),
    } as unknown as Page;
    const mockTester = {} as Tester;

    const result = await executeCheckStep("URL contains /dashboard", "deterministic", mockPage, mockTester);

    expect(result.passed).toBe(false);
    expect(result.checkType).toBe("deterministic");
    expect(result.expected).toBe("/dashboard");
    expect(result.actual).toBe("http://localhost:8080/login");
  });

  it("should pass deterministic URL is check", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080/login"),
    } as unknown as Page;
    const mockTester = {} as Tester;

    const result = await executeCheckStep("URL is http://localhost:8080/login", "deterministic", mockPage, mockTester);

    expect(result.passed).toBe(true);
    expect(result.checkType).toBe("deterministic");
    expect(result.expected).toBe("http://localhost:8080/login");
    expect(result.actual).toBe("http://localhost:8080/login");
  });

  it("should pass deterministic Page title is check", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080"),
      title: vi.fn().mockResolvedValue("Home Page"),
    } as unknown as Page;
    const mockTester = {} as Tester;

    const result = await executeCheckStep("Page title is Home Page", "deterministic", mockPage, mockTester);

    expect(result.passed).toBe(true);
    expect(result.checkType).toBe("deterministic");
    expect(result.expected).toBe("Home Page");
    expect(result.actual).toBe("Home Page");
  });

  it("should pass deterministic Page title contains check", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080"),
      title: vi.fn().mockResolvedValue("My Dashboard - App"),
    } as unknown as Page;
    const mockTester = {} as Tester;

    const result = await executeCheckStep("Page title contains Dashboard", "deterministic", mockPage, mockTester);

    expect(result.passed).toBe(true);
    expect(result.checkType).toBe("deterministic");
    expect(result.expected).toBe("Dashboard");
    expect(result.actual).toBe("My Dashboard - App");
  });

  it("should pass semantic check using tester.assert", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080"),
    } as unknown as Page;
    const mockTester = {
      snapshot: vi.fn().mockResolvedValue({ success: true, snapshotId: "snap1" }),
      assert: vi.fn().mockResolvedValue(true),
    } as unknown as Tester;

    const result = await executeCheckStep("Error message is displayed", "semantic", mockPage, mockTester);

    expect(result.passed).toBe(true);
    expect(result.checkType).toBe("semantic");
    expect(result.expected).toBe("Error message is displayed");
    expect(mockTester.snapshot).toHaveBeenCalledWith(mockPage);
    expect(mockTester.assert).toHaveBeenCalledWith(
      expect.stringContaining("Error message is displayed")
    );
  });

  it("should fail semantic check when tester.assert returns false", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080"),
    } as unknown as Page;
    const mockTester = {
      snapshot: vi.fn().mockResolvedValue({ success: true, snapshotId: "snap1" }),
      assert: vi.fn().mockResolvedValue(false),
    } as unknown as Tester;

    const result = await executeCheckStep("Success notification appears", "semantic", mockPage, mockTester);

    expect(result.passed).toBe(false);
    expect(result.checkType).toBe("semantic");
    expect(result.expected).toBe("Success notification appears");
  });
});

describe("generateFailureContext", () => {
  it("should capture page URL and snapshot", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080/form"),
      evaluate: vi.fn()
        .mockResolvedValueOnce("<html><body>Test page</body></html>")
        .mockResolvedValueOnce([]),
    } as unknown as Page;
    const step: SpecStep = { type: "act", instruction: "Click Submit button" };
    const error = new Error("Element not found");

    const context = await generateFailureContext(mockPage, step, error);

    expect(context.pageUrl).toBe("http://localhost:8080/form");
    expect(context.pageSnapshot).toBe("<html><body>Test page</body></html>");
    expect(context.failedStep).toEqual(step);
    expect(context.error).toBe("Element not found");
  });

  it("should extract interactive elements from page", async () => {
    const mockElements = [
      { type: "button", text: "Save", selector: "button#save" },
      { type: "link", text: "Cancel", selector: "a.cancel" },
      { type: "input", text: "", selector: "input[name='email']", attributes: { type: "email", name: "email" } },
    ];
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080/form"),
      evaluate: vi.fn()
        .mockResolvedValueOnce("<html><body>Form</body></html>")
        .mockResolvedValueOnce(mockElements),
    } as unknown as Page;
    const step: SpecStep = { type: "act", instruction: "Click Submit button" };
    const error = new Error("Element not found");

    const context = await generateFailureContext(mockPage, step, error);

    expect(context.availableElements).toHaveLength(3);
    expect(context.availableElements[0]).toEqual({ type: "button", text: "Save", selector: "button#save" });
    expect(context.availableElements[1]).toEqual({ type: "link", text: "Cancel", selector: "a.cancel" });
  });

  it("should generate suggestions for 'not found' errors", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080/form"),
      evaluate: vi.fn()
        .mockResolvedValueOnce("<html></html>")
        .mockResolvedValueOnce([{ type: "button", text: "Save", selector: "button#save" }]),
    } as unknown as Page;
    const step: SpecStep = { type: "act", instruction: "Click Submit button" };
    const error = new Error("Element not found");

    const context = await generateFailureContext(mockPage, step, error);

    expect(context.suggestions.length).toBeGreaterThan(0);
    expect(context.suggestions.some(s => s.toLowerCase().includes("not found") || s.toLowerCase().includes("element"))).toBe(true);
  });

  it("should generate suggestions for timeout errors", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080/form"),
      evaluate: vi.fn()
        .mockResolvedValueOnce("<html></html>")
        .mockResolvedValueOnce([]),
    } as unknown as Page;
    const step: SpecStep = { type: "act", instruction: "Wait for modal" };
    const error = new Error("Timeout waiting for element");

    const context = await generateFailureContext(mockPage, step, error);

    expect(context.suggestions.length).toBeGreaterThan(0);
    expect(context.suggestions.some(s => s.toLowerCase().includes("timed out") || s.toLowerCase().includes("timeout"))).toBe(true);
  });

  it("should generate suggestions for check failures", async () => {
    const mockPage = {
      url: vi.fn().mockReturnValue("http://localhost:8080/dashboard"),
      evaluate: vi.fn()
        .mockResolvedValueOnce("<html></html>")
        .mockResolvedValueOnce([]),
    } as unknown as Page;
    const step: SpecStep = { type: "check", instruction: "URL contains /profile", checkType: "deterministic" };
    const error = new Error("Check failed: expected /profile");

    const context = await generateFailureContext(mockPage, step, error);

    expect(context.suggestions.length).toBeGreaterThan(0);
  });
});
