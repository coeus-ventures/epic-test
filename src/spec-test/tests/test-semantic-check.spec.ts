import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpecTestRunner } from '../index';
import type { SpecStep, StepContext } from '../types';

/**
 * Tests for the semantic check flow with page-transition-aware oracle selection.
 *
 * Strategy:
 * - Same page: b-test (diff) primary → extract() rescue on failure
 * - Page transition: extract() primary → b-test rescue on failure
 *
 * Both oracles must agree on failure before marking it failed.
 */

// Mock page
function createMockPage() {
  return {
    url: vi.fn(() => 'http://localhost:3000/app'),
    title: vi.fn(async () => 'Test App'),
    evaluate: vi.fn(async () => false),
    goto: vi.fn(),
    reload: vi.fn(),
    waitForLoadState: vi.fn(),
  } as any;
}

// Mock tester (b-test)
function createMockTester(assertResult: boolean) {
  return {
    snapshot: vi.fn(),
    assert: vi.fn(async () => assertResult),
    clearSnapshots: vi.fn(),
  } as any;
}

// Mock stagehand
function createMockStagehand(extractResult?: { passed: boolean }, extractError?: Error) {
  const extract = extractError
    ? vi.fn(async () => { throw extractError; })
    : vi.fn(async () => extractResult ?? { passed: false });

  return {
    extract,
    act: vi.fn(),
    observe: vi.fn(async () => []),
    context: {
      activePage: vi.fn(() => createMockPage()),
    },
    init: vi.fn(),
    close: vi.fn(),
  } as any;
}

function makeSemanticCheckStep(instruction: string): SpecStep {
  return {
    type: 'check',
    instruction,
    checkType: 'semantic',
  };
}

function makeDeterministicCheckStep(instruction: string): SpecStep {
  return {
    type: 'check',
    instruction,
    checkType: 'deterministic',
  };
}

function makeContext(overrides: Partial<StepContext> = {}): StepContext {
  return {
    stepIndex: 0,
    totalSteps: 1,
    previousResults: [],
    page: createMockPage(),
    stagehand: createMockStagehand(),
    tester: createMockTester(true),
    ...overrides,
  };
}

describe('semantic check: b-test + extract() double-check', () => {
  let runner: SpecTestRunner;

  beforeEach(() => {
    runner = new SpecTestRunner({
      baseUrl: 'http://localhost:3000',
    });
    // Inject mocked stagehand/tester so initialize() is bypassed
    (runner as any).stagehand = createMockStagehand();
    (runner as any).tester = createMockTester(true);
  });

  it('b-test pass → returns pass (no extract call)', async () => {
    const tester = createMockTester(true); // b-test says pass
    const stagehand = createMockStagehand({ passed: true });
    const page = createMockPage();

    const step = makeSemanticCheckStep('The user is signed in and can see the dashboard');
    const context = makeContext({ page, stagehand, tester });

    const result = await runner.runStep(step, context);

    expect(result.success).toBe(true);
    expect(result.checkResult?.passed).toBe(true);
    // extract() should NOT have been called since b-test passed
    expect(stagehand.extract).not.toHaveBeenCalled();
  });

  it('b-test fail + extract() pass → returns pass (false negative mitigated)', async () => {
    const tester = createMockTester(false); // b-test says fail
    const stagehand = createMockStagehand({ passed: true }); // extract says pass
    const page = createMockPage();

    const step = makeSemanticCheckStep(
      'The user is signed in and can see the main application page, no longer on the sign-in or sign-up form'
    );
    const context = makeContext({ page, stagehand, tester });

    const result = await runner.runStep(step, context);

    expect(result.success).toBe(true);
    expect(result.checkResult?.passed).toBe(true);
    expect(result.checkResult?.actual).toContain('extract()');
    expect(result.checkResult?.actual).toContain('false negative mitigated');
    // extract() was called because b-test failed
    expect(stagehand.extract).toHaveBeenCalledTimes(1);
  });

  it('b-test fail + extract() fail → returns fail (confirmed failure after retries)', async () => {
    const tester = createMockTester(false); // b-test says fail
    const stagehand = createMockStagehand({ passed: false }); // extract also says fail
    const page = createMockPage();

    const step = makeSemanticCheckStep('The todo list shows 5 items');
    const context = makeContext({ page, stagehand, tester });

    const result = await runner.runStep(step, context);

    expect(result.success).toBe(false);
    expect(result.checkResult?.passed).toBe(false);
    // Both oracles called on each of 3 retry attempts
    expect(stagehand.extract).toHaveBeenCalledTimes(3);
  });

  it('b-test fail + extract() throws → returns fail (error = safe default after retries)', async () => {
    const tester = createMockTester(false); // b-test says fail
    const stagehand = createMockStagehand(undefined, new Error('extract API error'));
    const page = createMockPage();

    const step = makeSemanticCheckStep('The modal is closed');
    const context = makeContext({ page, stagehand, tester });

    const result = await runner.runStep(step, context);

    expect(result.success).toBe(false);
    expect(result.checkResult?.passed).toBe(false);
    // extract() was called but threw on each of 3 retry attempts
    expect(stagehand.extract).toHaveBeenCalledTimes(3);
  });

  it('negation instruction handled correctly by b-test (the exact bug case)', async () => {
    // This is the exact instruction that caused the false negative.
    // With the new flow, b-test handles it correctly without regex negation detection.
    const tester = createMockTester(true); // b-test correctly sees the diff
    const stagehand = createMockStagehand({ passed: true });
    const page = createMockPage();

    const step = makeSemanticCheckStep(
      'The user is signed in and can see the main application page, no longer on the sign-in or sign-up form'
    );
    const context = makeContext({ page, stagehand, tester });

    const result = await runner.runStep(step, context);

    expect(result.success).toBe(true);
    expect(result.checkResult?.passed).toBe(true);
    // No extract() call needed since b-test passed
    expect(stagehand.extract).not.toHaveBeenCalled();
  });

  it('deterministic checks skip both b-test and extract()', async () => {
    const tester = createMockTester(true);
    const stagehand = createMockStagehand({ passed: true });
    const page = createMockPage();
    page.url = vi.fn(() => 'http://localhost:3000/dashboard');

    const step = makeDeterministicCheckStep('URL contains /dashboard');
    const context = makeContext({ page, stagehand, tester });

    const result = await runner.runStep(step, context);

    expect(result.success).toBe(true);
    expect(result.checkResult?.checkType).toBe('deterministic');
    // Neither b-test nor extract() should be called for deterministic checks
    expect(tester.snapshot).not.toHaveBeenCalled();
    expect(tester.assert).not.toHaveBeenCalled();
    expect(stagehand.extract).not.toHaveBeenCalled();
  });

  // --- Page transition tests ---

  it('page transition: extract() pass → returns pass (extract primary)', async () => {
    const tester = createMockTester(false); // b-test would fail (not needed)
    const stagehand = createMockStagehand({ passed: true }); // extract says pass
    const page = createMockPage();

    // Simulate page transition: set preActUrl to /signup, page.url() returns /dashboard
    (runner as any).preActUrl = 'http://localhost:3000/signup';
    page.url = vi.fn(() => 'http://localhost:3000/dashboard');

    const step = makeSemanticCheckStep('The page displays a button to create a job posting');
    const context = makeContext({ page, stagehand, tester });

    const result = await runner.runStep(step, context);

    expect(result.success).toBe(true);
    expect(result.checkResult?.passed).toBe(true);
    expect(result.checkResult?.actual).toContain('extract()');
    expect(result.checkResult?.actual).toContain('page transition');
    // extract() was primary and passed — b-test should NOT be called
    expect(tester.assert).not.toHaveBeenCalled();
    expect(stagehand.extract).toHaveBeenCalledTimes(1);
  });

  it('page transition: extract() fail + b-test pass → returns pass (b-test rescue)', async () => {
    const tester = createMockTester(true); // b-test says pass (rescue)
    const stagehand = createMockStagehand({ passed: false }); // extract says fail
    const page = createMockPage();

    (runner as any).preActUrl = 'http://localhost:3000/login';
    page.url = vi.fn(() => 'http://localhost:3000/home');

    const step = makeSemanticCheckStep('The user is logged in and sees the home page');
    const context = makeContext({ page, stagehand, tester });

    const result = await runner.runStep(step, context);

    expect(result.success).toBe(true);
    expect(result.checkResult?.passed).toBe(true);
    expect(result.checkResult?.actual).toContain('b-test');
    expect(result.checkResult?.actual).toContain('extract false negative mitigated');
    // Both were called: extract first (primary), then b-test (rescue)
    expect(stagehand.extract).toHaveBeenCalledTimes(1);
    expect(tester.assert).toHaveBeenCalledTimes(1);
  });

  it('page transition: both fail → returns fail (confirmed after retries)', async () => {
    const tester = createMockTester(false); // b-test says fail
    const stagehand = createMockStagehand({ passed: false }); // extract says fail
    const page = createMockPage();

    (runner as any).preActUrl = 'http://localhost:3000/signup';
    page.url = vi.fn(() => 'http://localhost:3000/dashboard');

    const step = makeSemanticCheckStep('The page shows a welcome banner');
    const context = makeContext({ page, stagehand, tester });

    const result = await runner.runStep(step, context);

    expect(result.success).toBe(false);
    expect(result.checkResult?.passed).toBe(false);
    // Both oracles called on each of 3 retry attempts
    expect(stagehand.extract).toHaveBeenCalledTimes(3);
    expect(tester.assert).toHaveBeenCalledTimes(3);
  });

  it('same-page check still uses b-test as primary (no transition)', async () => {
    const tester = createMockTester(true); // b-test says pass
    const stagehand = createMockStagehand({ passed: true });
    const page = createMockPage();

    // Same URL: no transition
    (runner as any).preActUrl = 'http://localhost:3000/app';
    page.url = vi.fn(() => 'http://localhost:3000/app');

    const step = makeSemanticCheckStep('A new todo item appears in the list');
    const context = makeContext({ page, stagehand, tester });

    const result = await runner.runStep(step, context);

    expect(result.success).toBe(true);
    expect(result.checkResult?.passed).toBe(true);
    // b-test was primary and passed — extract() should NOT be called
    expect(tester.assert).toHaveBeenCalledTimes(1);
    expect(stagehand.extract).not.toHaveBeenCalled();
  });

  it('quoted text fast path works without LLM calls', async () => {
    const tester = createMockTester(true);
    const stagehand = createMockStagehand({ passed: true });
    const page = createMockPage();
    // Mock locator to find the text
    // Mock evaluate to return true (text found on page)
    page.evaluate = vi.fn(async () => true);

    const step = makeSemanticCheckStep('The text "Buy groceries" appears on the page');
    const context = makeContext({ page, stagehand, tester });

    const result = await runner.runStep(step, context);

    expect(result.success).toBe(true);
    expect(result.checkResult?.checkType).toBe('deterministic');
    expect(result.checkResult?.actual).toContain('Buy groceries');
    // No LLM calls needed
    expect(tester.assert).not.toHaveBeenCalled();
    expect(stagehand.extract).not.toHaveBeenCalled();
  });
});
