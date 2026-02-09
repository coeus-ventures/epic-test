import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSteps, parseSpecFile, classifyCheck, executeActStep, executeCheckStep, generateFailureContext, SpecTestRunner } from "../index";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { Page } from "playwright";
import type { Tester } from "../../b-test";
import type { SpecStep, TestableSpec } from "../types";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("parseSteps", () => {
  it("should parse Act steps from markdown content", () => {
    const content = `
#### Steps
* Act: User navigates to /login
* Act: User clicks Login button
`;
    const steps = parseSteps(content);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({
      type: "act",
      instruction: "User navigates to /login",
      lineNumber: expect.any(Number),
    });
    expect(steps[1]).toEqual({
      type: "act",
      instruction: "User clicks Login button",
      lineNumber: expect.any(Number),
    });
  });

  it("should parse Check steps with deterministic classification", () => {
    const content = `
#### Steps
* Check: URL contains /dashboard
* Check: Page title is 'Home'
`;
    const steps = parseSteps(content);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({
      type: "check",
      instruction: "URL contains /dashboard",
      checkType: "deterministic",
      lineNumber: expect.any(Number),
    });
    expect(steps[1]).toEqual({
      type: "check",
      instruction: "Page title is 'Home'",
      checkType: "deterministic",
      lineNumber: expect.any(Number),
    });
  });

  it("should parse Check steps with semantic classification", () => {
    const content = `
#### Steps
* Check: Error message is displayed
* Check: Welcome message is displayed
`;
    const steps = parseSteps(content);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({
      type: "check",
      instruction: "Error message is displayed",
      checkType: "semantic",
      lineNumber: expect.any(Number),
    });
    expect(steps[1]).toEqual({
      type: "check",
      instruction: "Welcome message is displayed",
      checkType: "semantic",
      lineNumber: expect.any(Number),
    });
  });

  it("should parse mixed Act and Check steps", () => {
    const content = `
#### Steps
* Act: User logs in as "client"
* Act: User navigates to the projects page
* Check: Projects list is visible
* Act: User clicks Create Project button
* Check: URL contains /projects/new
`;
    const steps = parseSteps(content);

    expect(steps).toHaveLength(5);
    expect(steps[0].type).toBe("act");
    expect(steps[1].type).toBe("act");
    expect(steps[2].type).toBe("check");
    expect(steps[2].checkType).toBe("semantic");
    expect(steps[3].type).toBe("act");
    expect(steps[4].type).toBe("check");
    expect(steps[4].checkType).toBe("deterministic");
  });
});

describe("classifyCheck", () => {
  it('should classify "URL contains" as deterministic', () => {
    expect(classifyCheck("URL contains /projects")).toBe("deterministic");
    expect(classifyCheck("URL contains /dashboard")).toBe("deterministic");
  });

  it('should classify "Page title is" as deterministic', () => {
    expect(classifyCheck("Page title is 'Projects'")).toBe("deterministic");
    expect(classifyCheck("Page title is 'Home'")).toBe("deterministic");
  });

  it('should classify "URL is" as deterministic', () => {
    expect(classifyCheck("URL is http://localhost:8080/login")).toBe(
      "deterministic"
    );
  });

  it('should classify "Page title contains" as deterministic', () => {
    expect(classifyCheck("Page title contains 'Dashboard'")).toBe(
      "deterministic"
    );
  });

  it('should classify "Element count is" as deterministic', () => {
    expect(classifyCheck("Element count is 5")).toBe("deterministic");
  });

  it('should classify "Input value is" as deterministic', () => {
    expect(classifyCheck("Input value is 'test@example.com'")).toBe(
      "deterministic"
    );
  });

  it('should classify "Checkbox is checked" as deterministic', () => {
    expect(classifyCheck("Checkbox is checked")).toBe("deterministic");
  });

  it('should classify "Error message is displayed" as semantic', () => {
    expect(classifyCheck("Error message is displayed")).toBe("semantic");
  });

  it('should classify "Success notification appears" as semantic', () => {
    expect(classifyCheck("Success notification appears")).toBe("semantic");
  });

  it('should classify "New project appears in the list" as semantic', () => {
    expect(classifyCheck("New project appears in the list")).toBe("semantic");
  });

  it('should classify "Form validation errors are shown" as semantic', () => {
    expect(classifyCheck("Form validation errors are shown")).toBe("semantic");
  });
});

describe("parseSpecFile", () => {
  it("should parse spec file and extract name from heading", async () => {
    const fixturePath = path.join(__dirname, "fixtures", "sample-spec.md");
    const spec = await parseSpecFile(fixturePath);

    expect(spec.name).toBe("Login");
  });

  it("should parse spec file and extract examples with steps", async () => {
    const fixturePath = path.join(__dirname, "fixtures", "sample-spec.md");
    const spec = await parseSpecFile(fixturePath);

    expect(spec.examples).toHaveLength(1);
    expect(spec.examples[0].name).toBe("Login with valid credentials");
    expect(spec.examples[0].steps).toHaveLength(6);
    expect(spec.examples[0].steps[0]).toEqual({
      type: "act",
      instruction: "User navigates to /login",
      lineNumber: expect.any(Number),
    });
    expect(spec.examples[0].steps[4]).toEqual({
      type: "check",
      instruction: "URL contains /dashboard",
      checkType: "deterministic",
      lineNumber: expect.any(Number),
    });
    expect(spec.examples[0].steps[5]).toEqual({
      type: "check",
      instruction: "Welcome message is displayed",
      checkType: "semantic",
      lineNumber: expect.any(Number),
    });
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

describe("Caching Configuration", () => {
  const testCacheDir = "./test-cache-temp";

  afterEach(() => {
    // Clean up test cache directory
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true, force: true });
    }
  });

  it("should return cacheDir when configured", () => {
    const runner = new SpecTestRunner({
      baseUrl: "http://localhost:8080",
      cacheDir: "./cache/tests",
    });

    // Access private method via type assertion
    const getCacheDir = (runner as unknown as { getCacheDir: (spec?: TestableSpec) => string | undefined }).getCacheDir;
    expect(getCacheDir.call(runner)).toBe("./cache/tests");
  });

  it("should return undefined when cacheDir not configured", () => {
    const runner = new SpecTestRunner({
      baseUrl: "http://localhost:8080",
    });

    const getCacheDir = (runner as unknown as { getCacheDir: (spec?: TestableSpec) => string | undefined }).getCacheDir;
    expect(getCacheDir.call(runner)).toBeUndefined();
  });

  it("should create per-spec cache directory when cachePerSpec is true", () => {
    const runner = new SpecTestRunner({
      baseUrl: "http://localhost:8080",
      cacheDir: "./cache",
      cachePerSpec: true,
    });

    const spec: TestableSpec = {
      name: "Login Flow",
      examples: [],
    };

    const getCacheDir = (runner as unknown as { getCacheDir: (spec?: TestableSpec) => string | undefined }).getCacheDir;
    expect(getCacheDir.call(runner, spec)).toMatch(/cache[/\\]login-flow$/);
  });

  it("should sanitize spec name for filesystem", () => {
    const runner = new SpecTestRunner({
      baseUrl: "http://localhost:8080",
      cacheDir: "./cache",
      cachePerSpec: true,
    });

    const spec: TestableSpec = {
      name: "Create Project (with spaces & symbols!)",
      examples: [],
    };

    const getCacheDir = (runner as unknown as { getCacheDir: (spec?: TestableSpec) => string | undefined }).getCacheDir;
    const result = getCacheDir.call(runner, spec);
    expect(result).toMatch(/cache[/\\]create-project-with-spaces-symbols-$/);
  });
});

describe("Cache Management", () => {
  const testCacheDir = path.join(os.tmpdir(), "epic-test-cache-mgmt-temp");

  afterEach(() => {
    // Clean up test cache directory
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true, force: true });
    }
  });

  it("should clear cache directory when clearCache is called", () => {
    // Create a test cache directory with a file
    mkdirSync(testCacheDir, { recursive: true });
    writeFileSync(`${testCacheDir}/test-file.json`, "{}");

    const runner = new SpecTestRunner({
      baseUrl: "http://localhost:8080",
      cacheDir: testCacheDir,
    });

    expect(existsSync(testCacheDir)).toBe(true);

    runner.clearCache();

    expect(existsSync(testCacheDir)).toBe(false);
  });

  it("should not throw when clearing non-existent cache", () => {
    const runner = new SpecTestRunner({
      baseUrl: "http://localhost:8080",
      cacheDir: "./non-existent-cache-12345",
    });

    expect(() => runner.clearCache()).not.toThrow();
  });

  it("should not throw when cacheDir is not configured", () => {
    const runner = new SpecTestRunner({
      baseUrl: "http://localhost:8080",
    });

    expect(() => runner.clearCache()).not.toThrow();
  });
});
