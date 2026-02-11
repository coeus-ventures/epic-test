import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpecTestRunner } from '../runner';
import type { SpecStep, StepContext, TestableSpec } from '../types';
import path from "path";
import os from "os";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";

// --- Mock factories for semantic check tests ---

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

function createMockTester(assertResult: boolean) {
  return {
    snapshot: vi.fn(),
    assert: vi.fn(async () => assertResult),
    clearSnapshots: vi.fn(),
  } as any;
}

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

// --- runStep: act with navigation detection ---

describe('SpecTestRunner', () => {
  describe('runStep — act with navigation detection', () => {
    it('should handle direct navigation via URL in instruction', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/login'),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };
      const mockStagehand = {
        act: vi.fn(),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Navigate to /dashboard' };
      const context: StepContext = {
        stepIndex: 0,
        totalSteps: 1,
        previousResults: [],
        page: mockPage as any,
        stagehand: mockStagehand as any,
        tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(mockPage.goto).toHaveBeenCalledWith('/dashboard');
      expect(mockStagehand.act).not.toHaveBeenCalled();
    });

    it('should handle page refresh instructions', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/dashboard'),
        reload: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };
      const mockStagehand = {
        act: vi.fn(),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Refresh the page' };
      const context: StepContext = {
        stepIndex: 0,
        totalSteps: 1,
        previousResults: [],
        page: mockPage as any,
        stagehand: mockStagehand as any,
        tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(mockPage.reload).toHaveBeenCalled();
      expect(mockStagehand.act).not.toHaveBeenCalled();
    });
  });

  // --- runStep: redundant navigation fallback ---

  describe('runStep — redundant navigation fallback', () => {
    it('should treat failed nav act as no-op when URL contains target', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/contacts'),
        evaluate: vi.fn().mockResolvedValue([]),
      };
      const mockStagehand = {
        act: vi.fn().mockRejectedValue(new Error('Could not find element')),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
        observe: vi.fn().mockResolvedValue([]),
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Click the Contacts button in the navigation' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
    });

    it('should still fail when URL does NOT match target', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/dashboard'),
        evaluate: vi.fn().mockResolvedValue([]),
      };
      const mockStagehand = {
        act: vi.fn().mockRejectedValue(new Error('Could not find element')),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
        observe: vi.fn().mockResolvedValue([]),
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Click the Contacts button in the navigation' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(false);
    });

    it('should not trigger fallback for non-navigation act steps', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/contacts'),
        evaluate: vi.fn().mockResolvedValue([]),
      };
      const mockStagehand = {
        act: vi.fn().mockRejectedValue(new Error('Could not find element')),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
        observe: vi.fn().mockResolvedValue([]),
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Click the Submit button' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(false);
    });
  });

  // --- runStep: modal dismissal recovery ---

  describe('runStep — modal dismissal recovery', () => {
    it('should press Escape and retry after all retries fail', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/channels'),
        evaluate: vi.fn().mockResolvedValue([]),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
        title: vi.fn().mockResolvedValue('Test'),
      };
      const mockStagehand = {
        act: vi.fn()
          .mockRejectedValueOnce(new Error('Element blocked by overlay'))
          .mockResolvedValue(undefined), // succeeds after Escape
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
        observe: vi.fn().mockResolvedValue([]),
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Type "hello" into the message input' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Escape');
      expect(result.success).toBe(true);
    });

    it('should still fail if Escape dismissal does not help', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/channels'),
        evaluate: vi.fn().mockResolvedValue([]),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
        title: vi.fn().mockResolvedValue('Test'),
      };
      const mockStagehand = {
        act: vi.fn().mockRejectedValue(new Error('Element not found')),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
        observe: vi.fn().mockResolvedValue([]),
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Type "hello" into the message input' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Escape');
      expect(result.success).toBe(false);
    });

    it('should not press Escape if retries succeed normally', async () => {
      let callCount = 0;
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/channels'),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      };
      const mockStagehand = {
        act: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) throw new Error('timeout error');
          return undefined;
        }),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Click the send button' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(mockPage.keyboard.press).not.toHaveBeenCalled();
    });
  });

  // --- runStep: post-save wait ---

  describe('runStep — post-save wait and form dismissal', () => {
    it('should wait and retry save when form is still visible after save action', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/products'),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        // First evaluate call: form check returns true (form still open), second: for other checks
        evaluate: vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false),
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Click the "Save" button' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      // act called twice: initial + retry after form detected still open
      expect(mockStagehand.act).toHaveBeenCalledTimes(2);
      expect(mockPage.waitForLoadState).toHaveBeenCalled();
    });

    it('should NOT trigger post-save wait for non-save actions', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/products'),
        evaluate: vi.fn().mockResolvedValue(false),
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Click the "Add Contact" button' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      // act called once — no save retry
      expect(mockStagehand.act).toHaveBeenCalledTimes(1);
    });

    it('should skip retry when form is dismissed after save (no form detected)', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/products'),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(false), // form not visible
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Click "Submit" to save the form' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      // act called once — form was dismissed, no retry needed
      expect(mockStagehand.act).toHaveBeenCalledTimes(1);
    });
  });

  // --- runStep: check with deterministic text fast-path ---

  describe('runStep — check with deterministic text fast-path', () => {
    it('should return deterministic pass when quoted text is found on page', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/dashboard'),
        evaluate: vi.fn().mockResolvedValue(true),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        assert: vi.fn().mockResolvedValue(true),
      };
      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
        extract: vi.fn(),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = 'http://localhost:8080/dashboard';

      const step: SpecStep = {
        type: 'check',
        instruction: 'Should see "Welcome back"',
        checkType: 'semantic',
      };
      const context: StepContext = {
        stepIndex: 1,
        totalSteps: 2,
        previousResults: [],
        page: mockPage as any,
        stagehand: mockStagehand as any,
        tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(result.checkResult?.checkType).toBe('deterministic');
      expect(mockTester.assert).not.toHaveBeenCalled();
    });
  });

  // --- Semantic check: b-test + extract() double-check ---

  describe('semantic check: b-test + extract() double-check', () => {
    let runner: SpecTestRunner;

    beforeEach(() => {
      runner = new SpecTestRunner({
        baseUrl: 'http://localhost:3000',
      });
      (runner as any).stagehand = createMockStagehand();
      (runner as any).tester = createMockTester(true);
    });

    it('b-test pass → returns pass (no extract call)', async () => {
      const tester = createMockTester(true);
      const stagehand = createMockStagehand({ passed: true });
      const page = createMockPage();

      const step = makeSemanticCheckStep('The user is signed in and can see the dashboard');
      const context = makeContext({ page, stagehand, tester });

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(result.checkResult?.passed).toBe(true);
      expect(stagehand.extract).not.toHaveBeenCalled();
    });

    it('b-test fail + extract() pass → returns pass (false negative mitigated)', async () => {
      const tester = createMockTester(false);
      const stagehand = createMockStagehand({ passed: true });
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
      expect(stagehand.extract).toHaveBeenCalledTimes(1);
    });

    it('b-test fail + extract() fail → returns fail (confirmed failure after retries)', async () => {
      const tester = createMockTester(false);
      const stagehand = createMockStagehand({ passed: false });
      const page = createMockPage();

      const step = makeSemanticCheckStep('The todo list shows 5 items');
      const context = makeContext({ page, stagehand, tester });

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(false);
      expect(result.checkResult?.passed).toBe(false);
      expect(stagehand.extract).toHaveBeenCalledTimes(3);
    });

    it('b-test fail + extract() throws → returns fail (error = safe default after retries)', async () => {
      const tester = createMockTester(false);
      const stagehand = createMockStagehand(undefined, new Error('extract API error'));
      const page = createMockPage();

      const step = makeSemanticCheckStep('The modal is closed');
      const context = makeContext({ page, stagehand, tester });

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(false);
      expect(result.checkResult?.passed).toBe(false);
      expect(stagehand.extract).toHaveBeenCalledTimes(3);
    });

    it('negation instruction handled correctly by b-test (the exact bug case)', async () => {
      const tester = createMockTester(true);
      const stagehand = createMockStagehand({ passed: true });
      const page = createMockPage();

      const step = makeSemanticCheckStep(
        'The user is signed in and can see the main application page, no longer on the sign-in or sign-up form'
      );
      const context = makeContext({ page, stagehand, tester });

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(result.checkResult?.passed).toBe(true);
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
      expect(tester.snapshot).not.toHaveBeenCalled();
      expect(tester.assert).not.toHaveBeenCalled();
      expect(stagehand.extract).not.toHaveBeenCalled();
    });

    // Page transition tests

    it('page transition: extract() pass → returns pass (extract primary)', async () => {
      const tester = createMockTester(false);
      const stagehand = createMockStagehand({ passed: true });
      const page = createMockPage();

      (runner as any).preActUrl = 'http://localhost:3000/signup';
      page.url = vi.fn(() => 'http://localhost:3000/dashboard');

      const step = makeSemanticCheckStep('The page displays a button to create a job posting');
      const context = makeContext({ page, stagehand, tester });

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(result.checkResult?.passed).toBe(true);
      expect(result.checkResult?.actual).toContain('extract()');
      expect(result.checkResult?.actual).toContain('page transition');
      expect(tester.assert).not.toHaveBeenCalled();
      expect(stagehand.extract).toHaveBeenCalledTimes(1);
    });

    it('page transition: extract() fail + b-test pass → returns pass (b-test rescue)', async () => {
      const tester = createMockTester(true);
      const stagehand = createMockStagehand({ passed: false });
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
      expect(stagehand.extract).toHaveBeenCalledTimes(1);
      expect(tester.assert).toHaveBeenCalledTimes(1);
    });

    it('page transition: both fail → returns fail (confirmed after retries)', async () => {
      const tester = createMockTester(false);
      const stagehand = createMockStagehand({ passed: false });
      const page = createMockPage();

      (runner as any).preActUrl = 'http://localhost:3000/signup';
      page.url = vi.fn(() => 'http://localhost:3000/dashboard');

      const step = makeSemanticCheckStep('The page shows a welcome banner');
      const context = makeContext({ page, stagehand, tester });

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(false);
      expect(result.checkResult?.passed).toBe(false);
      expect(stagehand.extract).toHaveBeenCalledTimes(3);
      expect(tester.assert).toHaveBeenCalledTimes(3);
    });

    it('same-page check still uses b-test as primary (no transition)', async () => {
      const tester = createMockTester(true);
      const stagehand = createMockStagehand({ passed: true });
      const page = createMockPage();

      (runner as any).preActUrl = 'http://localhost:3000/app';
      page.url = vi.fn(() => 'http://localhost:3000/app');

      const step = makeSemanticCheckStep('A new todo item appears in the list');
      const context = makeContext({ page, stagehand, tester });

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(result.checkResult?.passed).toBe(true);
      expect(tester.assert).toHaveBeenCalledTimes(1);
      expect(stagehand.extract).not.toHaveBeenCalled();
    });

    it('quoted text fast path works without LLM calls', async () => {
      const tester = createMockTester(true);
      const stagehand = createMockStagehand({ passed: true });
      const page = createMockPage();
      page.evaluate = vi.fn(async () => true);

      const step = makeSemanticCheckStep('The text "Buy groceries" appears on the page');
      const context = makeContext({ page, stagehand, tester });

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(result.checkResult?.checkType).toBe('deterministic');
      expect(result.checkResult?.actual).toContain('Buy groceries');
      expect(tester.assert).not.toHaveBeenCalled();
      expect(stagehand.extract).not.toHaveBeenCalled();
    });

    it('quoted text NOT found falls through to semantic oracle (not immediate fail)', async () => {
      const tester = createMockTester(true);
      const stagehand = createMockStagehand({ passed: true });
      const page = createMockPage();
      page.evaluate = vi.fn(async () => false);

      const step = makeSemanticCheckStep('The text "David Lee" appears in the filtered results');
      const context = makeContext({ page, stagehand, tester });

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(result.checkResult?.checkType).toBe('semantic');
      expect(tester.assert).toHaveBeenCalled();
    });
  });

  // --- runExample: session management ---

  describe('runExample — session management', () => {
    it('should return failure when page is unavailable', async () => {
      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });

      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(null) },
      };
      const mockTester = {};
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      const example = {
        name: 'Test example',
        steps: [{ type: 'act' as const, instruction: 'Click button' }],
      };

      const result = await runner.runExample(example);

      expect(result.success).toBe(false);
      expect(result.failedAt).toBeDefined();
      expect(result.failedAt?.context.error).toContain('No active page');
    });

    it('should clear session when clearSession is true (default)', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
        assert: vi.fn().mockResolvedValue(true),
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      const example = {
        name: 'Test',
        steps: [{ type: 'check' as const, instruction: 'URL contains /dashboard', checkType: 'deterministic' as const }],
      };

      await runner.runExample(example);

      expect(mockPage.goto).toHaveBeenCalledWith('about:blank');
      expect(mockPage.goto).toHaveBeenCalledWith('http://localhost:8080');
      expect(mockPage.reload).toHaveBeenCalled();
    });

    it('should preserve session when clearSession is false', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/dashboard'),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
        assert: vi.fn().mockResolvedValue(true),
      };
      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false });

      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it('should soft-navigate to path when clearSession is false with navigateToPath', async () => {
      const mockPage = {
        url: vi.fn()
          .mockReturnValueOnce('http://localhost:8080/dashboard')
          .mockReturnValueOnce('http://localhost:8080/dashboard')
          .mockReturnValueOnce('http://localhost:8080/candidates'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };
      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false, navigateToPath: '/candidates' });

      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it('should skip navigation when already on the target URL', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/candidates'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };
      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false, navigateToPath: '/candidates' });

      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it('should skip navigation with trailing slash mismatch', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/tasks/'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };
      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false, navigateToPath: '/tasks' });

      expect(mockPage.evaluate).not.toHaveBeenCalled();
      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it('should skip navigation for parameterized routes like /products/:id', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/products/123'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };
      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false, navigateToPath: '/products/:id' });

      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it('should skip nested parameterized routes like /users/:userId/orders/:orderId', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/users/5/orders/99'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };
      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false, navigateToPath: '/users/:userId/orders/:orderId' });

      expect(mockPage.goto).not.toHaveBeenCalled();
      expect(mockPage.evaluate).not.toHaveBeenCalled();
    });

    it('should skip navigation when already in a child path of target (preserves dependency chain context)', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/projects/123/issues'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };
      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      // On /projects/123/issues, navigating to /projects should be skipped
      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false, navigateToPath: '/projects' });

      // Should NOT have navigated (no evaluate call for soft navigation)
      expect(mockPage.evaluate).not.toHaveBeenCalled();
      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it('should NOT skip navigation when on a different path that merely starts with same prefix', async () => {
      const mockPage = {
        url: vi.fn()
          .mockReturnValueOnce('http://localhost:8080/products-archive')
          .mockReturnValueOnce('http://localhost:8080/products-archive')
          .mockReturnValueOnce('http://localhost:8080/products'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };
      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      // On /products-archive, navigating to /products should NOT be skipped
      // (products-archive is not a child of /products)
      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false, navigateToPath: '/products' });

      // Should have navigated
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should NOT skip static routes like /products/new', async () => {
      const mockPage = {
        url: vi.fn()
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/products/new'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };
      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false, navigateToPath: '/products/new' });

      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should attempt auth recovery when redirected to sign-in', async () => {
      const mockPage = {
        url: vi.fn()
          .mockReturnValueOnce('http://localhost:8080/dashboard')
          .mockReturnValueOnce('http://localhost:8080/dashboard')
          .mockReturnValueOnce('http://localhost:8080/sign-in')
          .mockReturnValueOnce('http://localhost:8080/sign-in')
          .mockReturnValueOnce('http://localhost:8080/dashboard')
          .mockReturnValueOnce('http://localhost:8080/dashboard')
          .mockReturnValueOnce('http://localhost:8080/tasks'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, {
        clearSession: false,
        navigateToPath: '/tasks',
        credentials: { email: 'test@example.com', password: 'password123' },
      });

      expect(mockStagehand.act).toHaveBeenCalledWith(expect.stringContaining('test@example.com'));
      expect(mockStagehand.act).toHaveBeenCalledWith(expect.stringContaining('password123'));
      expect(mockStagehand.act).toHaveBeenCalledWith(expect.stringContaining('sign in'));
    });

    it('should detect /login as a sign-in redirect', async () => {
      const mockPage = {
        url: vi.fn()
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/login')
          .mockReturnValueOnce('http://localhost:8080/login')
          .mockReturnValueOnce('http://localhost:8080/tasks')
          .mockReturnValueOnce('http://localhost:8080/tasks')
          .mockReturnValueOnce('http://localhost:8080/tasks'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, {
        clearSession: false,
        navigateToPath: '/tasks',
        credentials: { email: 'user@test.com', password: 'secret' },
      });

      expect(mockStagehand.act).toHaveBeenCalledWith(expect.stringContaining('user@test.com'));
      expect(mockStagehand.act).toHaveBeenCalledTimes(3);
    });

    it('should detect /auth as a sign-in redirect', async () => {
      const mockPage = {
        url: vi.fn()
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/auth')
          .mockReturnValueOnce('http://localhost:8080/auth')
          .mockReturnValueOnce('http://localhost:8080/tasks')
          .mockReturnValueOnce('http://localhost:8080/tasks')
          .mockReturnValueOnce('http://localhost:8080/tasks'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, {
        clearSession: false,
        navigateToPath: '/tasks',
        credentials: { email: 'a@b.com', password: 'pw' },
      });

      expect(mockStagehand.act).toHaveBeenCalledTimes(3);
    });

    it('should skip auth recovery when no credentials provided', async () => {
      const mockPage = {
        url: vi.fn()
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/sign-in'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, {
        clearSession: false,
        navigateToPath: '/tasks',
      });

      expect(mockStagehand.act).not.toHaveBeenCalled();
    });

    it('should navigate to target after auth if not already there', async () => {
      const mockPage = {
        url: vi.fn()
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/sign-in')
          .mockReturnValueOnce('http://localhost:8080/sign-in')
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/dashboard'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, {
        clearSession: false,
        navigateToPath: '/dashboard',
        credentials: { email: 'a@b.com', password: 'pw' },
      });

      const evaluateCalls = mockPage.evaluate.mock.calls.filter(
        (call: any[]) => typeof call[1] === 'string' && call[1].includes('localhost')
      );
      expect(evaluateCalls.length).toBe(2);
    });

    it('should gracefully handle auth recovery failure', async () => {
      const mockPage = {
        url: vi.fn()
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/')
          .mockReturnValueOnce('http://localhost:8080/sign-in')
          .mockReturnValueOnce('http://localhost:8080/sign-in'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockStagehand = {
        act: vi.fn().mockRejectedValue(new Error('Could not find email field')),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await expect(
        runner.runExample({ name: 'Test', steps: [] }, {
          clearSession: false,
          navigateToPath: '/tasks',
          credentials: { email: 'a@b.com', password: 'pw' },
        })
      ).resolves.toBeDefined();
    });

    it('should execute page.reload when reloadPage option is true', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };
      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false, reloadPage: true });

      expect(mockPage.reload).toHaveBeenCalled();
      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle');
    });

    it('should NOT call page.reload when reloadPage is false', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        clearSnapshots: vi.fn(),
      };
      const mockStagehand = {
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false, reloadPage: false });

      expect(mockPage.reload).not.toHaveBeenCalled();
    });
  });

  // --- close ---

  describe('close', () => {
    it('should handle close when not initialized', async () => {
      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      await expect(runner.close()).resolves.not.toThrow();
    });

    it('should clean up stagehand and tester on close', async () => {
      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      const mockStagehand = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
      };

      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await runner.close();

      expect(mockStagehand.close).toHaveBeenCalled();
      expect(mockTester.clearSnapshots).toHaveBeenCalled();
      expect((runner as any).stagehand).toBeNull();
      expect((runner as any).tester).toBeNull();
    });

    it('should handle close timeout gracefully', { timeout: 15000 }, async () => {
      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      const mockStagehand = {
        close: vi.fn().mockImplementation(() => new Promise(() => {})),
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
      };

      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      await expect(runner.close()).resolves.not.toThrow();
    });
  });

  // --- isRetryableError ---

  describe('isRetryableError (via executeActWithRetry)', () => {
    it('should retry on schema errors', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080'),
        title: vi.fn().mockResolvedValue('Test'),
        // Return [] for error context evaluations, false for form-still-open check
        evaluate: vi.fn().mockResolvedValue(false),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      const mockStagehand = {
        act: vi.fn()
          .mockRejectedValueOnce(new Error('schema validation failed'))
          .mockRejectedValueOnce(new Error('schema validation failed'))
          .mockResolvedValue(undefined),
        context: {
          activePage: vi.fn().mockReturnValue(mockPage),
        },
        observe: vi.fn().mockResolvedValue([]),
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Click submit' };
      const context: StepContext = {
        stepIndex: 0,
        totalSteps: 1,
        previousResults: [],
        page: mockPage as any,
        stagehand: mockStagehand as any,
        tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(mockStagehand.act).toHaveBeenCalledTimes(3);
    });
  });

  // --- runFromSpec ---

  describe('runFromSpec', () => {
    it('should throw when example name not found', async () => {
      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });

      const spec = {
        name: 'Test Spec',
        examples: [{ name: 'Login', steps: [] }],
      };

      await expect(
        runner.runFromSpec(spec, 'NonExistent')
      ).rejects.toThrow('Example "NonExistent" not found');
    });

    it('should throw when no examples exist', async () => {
      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });

      const spec = {
        name: 'Empty Spec',
        examples: [],
      };

      await expect(
        runner.runFromSpec(spec)
      ).rejects.toThrow('No examples found in specification');
    });
  });

  // --- Caching Configuration ---

  describe('Caching Configuration', () => {
    const testCacheDir = "./test-cache-temp";

    afterEach(() => {
      if (existsSync(testCacheDir)) {
        rmSync(testCacheDir, { recursive: true, force: true });
      }
    });

    it("should return cacheDir when configured", () => {
      const runner = new SpecTestRunner({
        baseUrl: "http://localhost:8080",
        cacheDir: "./cache/tests",
      });

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

  // --- Cache Management ---

  describe("Cache Management", () => {
    const testCacheDir = path.join(os.tmpdir(), "epic-test-cache-mgmt-temp");

    afterEach(() => {
      if (existsSync(testCacheDir)) {
        rmSync(testCacheDir, { recursive: true, force: true });
      }
    });

    it("should clear cache directory when clearCache is called", () => {
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
});
