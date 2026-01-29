/**
 * epic-test - A collection of testing utilities
 *
 * This library provides three testing modules:
 *
 * - **spec-test**: Specification-driven browser testing with AI-powered automation
 * - **b-test**: LLM-powered browser assertions with HTML snapshot diffing
 * - **db-test**: Database state management for deterministic testing with Drizzle ORM
 */

// Re-export spec-test
export {
  SpecTestRunner,
  parseSpecFile,
  parseSteps,
  parseExamples,
  classifyCheck,
  executeActStep,
  executeCheckStep,
  generateFailureContext,
} from "./spec-test/index.js";

export type {
  SpecTestConfig,
  TestableSpec,
  SpecExample,
  SpecStep,
  SpecTestResult,
  ExampleResult,
  StepResult,
  ActResult,
  CheckResult,
  FailureContext,
  StepContext,
} from "./spec-test/index.js";

// Re-export b-test
export { Tester, TesterError } from "./b-test/index.js";
export type { Snapshot, DiffResult } from "./b-test/index.js";

// Re-export db-test
export { PreDB, PreDBFromFile, PostDB, PostDBFromFile } from "./db-test/index.js";
export type { StateObject, PreDBOptions, PostDBOptions } from "./db-test/index.js";
