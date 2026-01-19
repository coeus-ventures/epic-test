/**
 * Integration tests for spec-test library.
 *
 * These tests validate the full flow: Spec → Stagehand Act → B-Test Check → Pass/Fail
 * using a real browser against test HTML pages.
 *
 * Note: These tests require:
 * - Chromium/Chrome installed (Stagehand will use it)
 * - OPENAI_API_KEY for semantic checks
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SpecTestRunner, parseSpecFile } from "../index";
import { Server } from "bun";
import path from "path";
import { readFileSync } from "fs";

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const TEST_PORT = 9876;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Simple static file server for test fixtures
function createTestServer(): Server {
  return Bun.serve({
    port: TEST_PORT,
    fetch(req) {
      const url = new URL(req.url);
      let filePath: string;

      // Route handling
      if (url.pathname === "/" || url.pathname === "/login") {
        filePath = path.join(FIXTURES_DIR, "login-page.html");
      } else if (url.pathname === "/dashboard") {
        filePath = path.join(FIXTURES_DIR, "dashboard-page.html");
      } else {
        return new Response("Not Found", { status: 404 });
      }

      try {
        const content = readFileSync(filePath, "utf-8");
        return new Response(content, {
          headers: { "Content-Type": "text/html" },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    },
  });
}

describe("SpecTestRunner Integration", () => {
  let server: Server;
  let runner: SpecTestRunner;

  beforeAll(() => {
    server = createTestServer();
    runner = new SpecTestRunner({
      baseUrl: `${BASE_URL}/login`,
      headless: true,
    });
  });

  afterAll(async () => {
    await runner.close();
    server.stop();
  });

  describe("parseSpecFile", () => {
    it("should parse login spec file correctly", async () => {
      const specPath = path.join(FIXTURES_DIR, "login-spec.md");
      const spec = await parseSpecFile(specPath);

      expect(spec.name).toBe("Login");
      expect(spec.directory).toBe("app/(app)/auth/behaviors/login/");
      expect(spec.examples).toHaveLength(1);

      const example = spec.examples[0];
      expect(example.name).toBe("Login with valid credentials");
      expect(example.steps).toHaveLength(5);
      expect(example.steps[0].type).toBe("act");
      expect(example.steps[3].type).toBe("check");
      expect(example.steps[3].checkType).toBe("deterministic"); // URL contains
      expect(example.steps[4].checkType).toBe("deterministic"); // Page title contains
    });

    it("should parse failure spec file correctly", async () => {
      const specPath = path.join(FIXTURES_DIR, "login-failure-spec.md");
      const spec = await parseSpecFile(specPath);

      expect(spec.name).toBe("Login Failure");
      expect(spec.examples).toHaveLength(1);

      const example = spec.examples[0];
      expect(example.name).toBe("Click non-existent element");
      expect(example.steps).toHaveLength(2);
      expect(example.steps[0].type).toBe("act");
      expect(example.steps[0].instruction).toContain("Submit Application");
    });
  });

  // Note: These tests require a real browser and OPENAI_API_KEY for semantic checks.

  describe("Full E2E flow (requires browser)", () => {
    it("should successfully run login spec with valid credentials", async () => {
      const specPath = path.join(FIXTURES_DIR, "login-spec.md");
      const result = await runner.runFromFile(specPath);

      expect(result.success).toBe(true);
      expect(result.exampleResults).toHaveLength(1);

      const exampleResult = result.exampleResults[0];
      expect(exampleResult.example.name).toBe("Login with valid credentials");
      expect(exampleResult.success).toBe(true);
      expect(exampleResult.steps).toHaveLength(5);
      expect(exampleResult.steps.every(s => s.success)).toBe(true);
      expect(exampleResult.failedAt).toBeUndefined();
    }, 60000); // 60s timeout for browser operations

    it("should generate failure context when action fails", async () => {
      const specPath = path.join(FIXTURES_DIR, "login-failure-spec.md");
      const result = await runner.runFromFile(specPath);

      expect(result.success).toBe(false);
      expect(result.exampleResults).toHaveLength(1);

      const exampleResult = result.exampleResults[0];
      expect(exampleResult.failedAt).toBeDefined();
      expect(exampleResult.failedAt?.stepIndex).toBe(0);
      expect(exampleResult.failedAt?.context).toBeDefined();
      expect(exampleResult.failedAt?.context.suggestions.length).toBeGreaterThan(0);
      expect(exampleResult.failedAt?.context.availableElements.length).toBeGreaterThan(0);
    }, 60000);

    it("should report correct step results", async () => {
      const specPath = path.join(FIXTURES_DIR, "login-spec.md");
      const result = await runner.runFromFile(specPath);

      const exampleResult = result.exampleResults[0];

      // Check Act results
      const actSteps = exampleResult.steps.filter(s => s.step.type === "act");
      actSteps.forEach(step => {
        expect(step.actResult).toBeDefined();
        expect(step.actResult?.success).toBe(true);
        expect(step.duration).toBeGreaterThan(0);
      });

      // Check Check results
      const checkSteps = exampleResult.steps.filter(s => s.step.type === "check");
      checkSteps.forEach(step => {
        expect(step.checkResult).toBeDefined();
        expect(step.checkResult?.passed).toBe(true);
      });
    }, 60000);

    it("should run specific example by name", async () => {
      const specPath = path.join(FIXTURES_DIR, "login-spec.md");
      const result = await runner.runFromFile(specPath, "Login with valid credentials");

      expect(result.success).toBe(true);
      expect(result.exampleResults).toHaveLength(1);
      expect(result.exampleResults[0].example.name).toBe("Login with valid credentials");
    }, 60000);
  });
});

/**
 * Manual test runner for integration tests.
 * Run this directly with: bun lib/spec-test/tests/integration.test.ts --run
 */
if (process.argv.includes("--run")) {
  (async () => {
    console.log("Starting integration test server...");
    const server = createTestServer();
    console.log(`Server running at ${BASE_URL}`);

    const runner = new SpecTestRunner({
      baseUrl: `${BASE_URL}/login`,
      headless: false, // Show browser for debugging
    });

    try {
      console.log("\n--- Running login spec ---");
      const specPath = path.join(FIXTURES_DIR, "login-spec.md");
      const result = await runner.runFromFile(specPath);

      console.log(`\nResult: ${result.success ? "PASSED" : "FAILED"}`);
      console.log(`Duration: ${result.duration}ms`);
      console.log(`Examples: ${result.exampleResults.length}`);

      result.exampleResults.forEach((exampleResult) => {
        const exampleStatus = exampleResult.success ? "PASSED" : "FAILED";
        console.log(`\n  Example: ${exampleResult.example.name} - ${exampleStatus}`);
        console.log(`  Duration: ${exampleResult.duration}ms`);

        exampleResult.steps.forEach((step, i) => {
          const status = step.success ? "+" : "x";
          console.log(`    ${status} Step ${i + 1}: ${step.step.instruction}`);
        });

        if (exampleResult.failedAt) {
          console.log(`\n  Failed at step ${exampleResult.failedAt.stepIndex + 1}:`);
          console.log(`    Error: ${exampleResult.failedAt.context.error}`);
          console.log("    Suggestions:");
          exampleResult.failedAt.context.suggestions.forEach(s => console.log(`      - ${s}`));
        }
      });
    } catch (error) {
      console.error("Test error:", error);
    } finally {
      await runner.close();
      server.stop();
    }
  })();
}
