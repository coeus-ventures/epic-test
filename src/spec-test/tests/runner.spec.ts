import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpecTestRunner } from '../runner';
import { detectPort, resetSession } from '../session-management';
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

  describe('runStep — post-save stabilization', () => {
    it('should wait for networkidle + delay after save action', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/products'),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue([]), // no empty required fields
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
      // act called once — no retry, just stabilization
      expect(mockStagehand.act).toHaveBeenCalledTimes(1);
      // waitForLoadState called for networkidle
      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 3000 });
      // Snapshots reset after form dismissal for clean check baseline
      expect(mockTester.clearSnapshots).toHaveBeenCalled();
    });

    it('should NOT trigger stabilization for non-save actions', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/products'),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
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
      // act called once — no save stabilization
      expect(mockStagehand.act).toHaveBeenCalledTimes(1);
      // waitForLoadState NOT called — not a save action
      expect(mockPage.waitForLoadState).not.toHaveBeenCalled();
    });

    it('should handle networkidle timeout gracefully', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/products'),
        waitForLoadState: vi.fn().mockRejectedValue(new Error('Timeout')),
        evaluate: vi.fn().mockResolvedValue([]), // no empty required fields
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

      // Still succeeds — networkidle timeout is non-fatal
      expect(result.success).toBe(true);
      expect(mockTester.clearSnapshots).toHaveBeenCalled();
    });
  });

  // --- runStep: auto-fill hook integration ---

  describe('runStep — auto-fill hook integration', () => {
    it('should call fillEmptyRequiredFields before save/submit actions', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/tickets'),
        evaluate: vi.fn()
          .mockResolvedValueOnce([]) // fillEmptyRequiredFields: no empty fields
          .mockResolvedValue([]),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
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

      const step: SpecStep = { type: 'act', instruction: 'Click the "Submit" button' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      await runner.runStep(step, context);

      // evaluate called = fillEmptyRequiredFields was invoked
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should NOT call fillEmptyRequiredFields for non-submit actions', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/tickets'),
        evaluate: vi.fn().mockResolvedValue([]),
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

      const step: SpecStep = { type: 'act', instruction: 'Click the "New Ticket" button' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      await runner.runStep(step, context);

      // evaluate may be called by dismissLeftoverModal (modal detection),
      // but NOT by fillEmptyRequiredFields (form filler scans for required fields)
      const formFillerCalls = mockPage.evaluate.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'function' && String(call[0]).includes('required')
      );
      expect(formFillerCalls).toHaveLength(0);
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
      const mockResponse = { ok: () => true };
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080'),
        goto: vi.fn().mockResolvedValue(mockResponse),
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

    it('should execute page.reload and clear form fields when reloadPage option is true', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080'),
        goto: vi.fn().mockResolvedValue(undefined),
        // First evaluate: React-compatible field clear, second: check if fields still filled (return false = all cleared)
        evaluate: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(false),
        reload: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
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

      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false, reloadPage: true });

      expect(mockPage.reload).toHaveBeenCalled();
      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle');
      // evaluate called for React-compatible clearing + fields-still-filled check
      expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
      // act NOT called — fields were cleared programmatically (no fallback needed)
      expect(mockStagehand.act).not.toHaveBeenCalled();
    });

    it('should use triple-click+delete fallback when fields resist programmatic clearing', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080'),
        goto: vi.fn().mockResolvedValue(undefined),
        // First evaluate: React-compatible clear, second: fields still have values (true)
        evaluate: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(true),
        reload: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
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

      await runner.runExample({ name: 'Test', steps: [] }, { clearSession: false, reloadPage: true });

      expect(mockPage.reload).toHaveBeenCalled();
      // act called for triple-click fallback on email and password fields
      expect(mockStagehand.act).toHaveBeenCalledWith(expect.stringContaining('Triple-click'));
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Delete');
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
        waitFor: vi.fn().mockResolvedValue(true), // Form dismissed immediately
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      // Use non-save instruction to isolate retry behavior from form dismissal
      const step: SpecStep = { type: 'act', instruction: 'Click the confirm button' };
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

  // --- runStep: observe-first select dispatch ---

  describe('runStep — observe-first select dispatch', () => {
    it('should use selectOption when observe returns method=selectOption (native <select>)', async () => {
      // This is the real scenario: Stagehand observe() returns method: "selectOption"
      // for native <select> elements, regardless of selector format (xpath, css, etc.).
      // The runner should trust this and use Playwright's selectOption() directly.
      const selectOptionFn = vi.fn().mockResolvedValue(undefined);
      const firstFn = vi.fn(() => ({ selectOption: selectOptionFn }));
      const locatorFn = vi.fn(() => ({ first: firstFn }));

      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/tickets'),
        locator: locatorFn,
      };
      const mockStagehand = {
        act: vi.fn(),
        observe: vi.fn().mockResolvedValue([
          // Real Stagehand returns xpath selectors + method field
          { selector: 'xpath=/html[1]/body[1]/div[1]/form[1]/select[1]', description: 'Priority dropdown', method: 'selectOption', arguments: ['High'] },
        ]),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = 'http://localhost:8080/tickets';

      const step: SpecStep = { type: 'act', instruction: 'Select "High" from the priority dropdown' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(mockStagehand.observe).toHaveBeenCalled();
      // Should use locator().first().selectOption() — NOT act()
      expect(locatorFn).toHaveBeenCalledWith('xpath=/html[1]/body[1]/div[1]/form[1]/select[1]');
      expect(selectOptionFn).toHaveBeenCalledWith({ label: 'High' });
      expect(mockStagehand.act).not.toHaveBeenCalled();
    });

    it('should use custom dropdown dispatch when observe method is not selectOption', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/tickets'),
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        observe: vi.fn().mockResolvedValue([
          // Custom dropdown — observe returns method: "click" (not selectOption)
          { selector: '#custom-dropdown', description: 'Status picker', method: 'click', arguments: [] },
        ]),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = 'http://localhost:8080/tickets';

      const step: SpecStep = { type: 'act', instruction: 'Select "Open" from the status dropdown' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      // act() called twice: open dropdown + click option
      expect(mockStagehand.act).toHaveBeenCalledTimes(2);
      expect(mockStagehand.act).toHaveBeenCalledWith(expect.stringContaining('open it'));
      expect(mockStagehand.act).toHaveBeenCalledWith(expect.stringContaining('"Open"'));
    });

    it('should fall through to trySelectFallback when observe returns no results', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/tickets'),
        evaluate: vi.fn().mockResolvedValue(true), // DOM fallback succeeds
      };
      const mockStagehand = {
        act: vi.fn(),
        observe: vi.fn().mockResolvedValue([]), // No observations
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = 'http://localhost:8080/tickets';

      const step: SpecStep = { type: 'act', instruction: 'Select "Open" from the status dropdown' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      expect(mockStagehand.observe).toHaveBeenCalled();
      expect(mockStagehand.act).not.toHaveBeenCalled();
    });
  });

  // --- runStep: SPA navigation detection ---

  describe('runStep — SPA navigation detection', () => {
    it('should detect SPA navigation and reset snapshots when URL changes after act', async () => {
      // Simulates: user clicks a ticket row → React Router navigates /tickets → /tickets/123
      // Stagehand returns success immediately, but the URL changes after the 2s delay.
      let currentUrl = 'http://localhost:8080/tickets';
      const mockPage = {
        url: vi.fn(() => currentUrl),
      };
      const mockStagehand = {
        act: vi.fn().mockImplementation(async () => {
          // Simulate React Router updating the URL after Stagehand's click
          currentUrl = 'http://localhost:8080/tickets/123';
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

      const step: SpecStep = { type: 'act', instruction: 'Click on the ticket "Billing inquiry"' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      // Snapshots should be reset twice: once before act (baseline), once after navigation
      expect(mockTester.clearSnapshots).toHaveBeenCalledTimes(2);
      expect(mockTester.snapshot).toHaveBeenCalledTimes(2);
    });

    it('should NOT reset snapshots when URL stays the same after act', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/tickets'),
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

      const step: SpecStep = { type: 'act', instruction: 'Click the "New Ticket" button' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      // Snapshots reset only once: before act (baseline). No navigation happened.
      expect(mockTester.clearSnapshots).toHaveBeenCalledTimes(1);
      expect(mockTester.snapshot).toHaveBeenCalledTimes(1);
    });

    it('should skip SPA navigation wait entirely for type/fill instructions', async () => {
      // Type/fill never triggers navigation — no reason to wait 2s
      let urlCallCount = 0;
      const mockPage = {
        url: vi.fn(() => {
          urlCallCount++;
          return 'http://localhost:8080/tickets';
        }),
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

      const step: SpecStep = { type: 'act', instruction: 'Type "Billing inquiry" into the subject field' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const start = Date.now();
      const result = await runner.runStep(step, context);
      const elapsed = Date.now() - start;

      expect(result.success).toBe(true);
      // Should complete fast — no 2s delay for type instructions
      expect(elapsed).toBeLessThan(1000);
    });
  });

  // --- runStep: modal lifecycle handling ---

  describe('runStep — modal lifecycle handling', () => {
    it('should wait for modal appearance after modal-trigger actions (edit/delete)', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/messages'),
        evaluate: vi.fn().mockResolvedValue(null), // No modal found by DOM poll
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        waitFor: vi.fn().mockResolvedValue(true), // Modal appeared via LLM
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Click the "Edit" button on the message' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      // DOM poll returns null (no modal), then LLM fallback fires with 1500ms timeout
      expect(mockTester.waitFor).toHaveBeenCalledWith(
        expect.stringContaining('modal'),
        1500
      );
    });

    it('should wait for modal dismissal after dismiss actions (confirm/cancel)', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/messages'),
        evaluate: vi.fn().mockResolvedValue(null), // No modal found by DOM poll
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        waitFor: vi.fn().mockResolvedValue(true),
      };

      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });
      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;
      (runner as any).preActUrl = null;

      const step: SpecStep = { type: 'act', instruction: 'Click "Confirm" to delete the message' };
      const context: StepContext = {
        stepIndex: 0, totalSteps: 1, previousResults: [],
        page: mockPage as any, stagehand: mockStagehand as any, tester: mockTester as any,
      };

      const result = await runner.runStep(step, context);

      expect(result.success).toBe(true);
      // DOM poll finds no modal → returns early (modal already dismissed)
      // Snapshots reset after modal dismissal
      expect(mockTester.clearSnapshots).toHaveBeenCalled();
    });

    it('should NOT wait for modals on non-modal actions', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/messages'),
      };
      const mockStagehand = {
        act: vi.fn().mockResolvedValue(undefined),
        context: { activePage: vi.fn().mockReturnValue(mockPage) },
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ success: true }),
        waitFor: vi.fn().mockResolvedValue(true),
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

      expect(result.success).toBe(true);
      // waitFor NOT called — typing is not a modal action
      expect(mockTester.waitFor).not.toHaveBeenCalled();
    });
  });

  // --- port auto-detection ---

  describe('detectPort', () => {
    it('should keep configured port when app responds on it', async () => {
      const mockResponse = { ok: () => true };
      const mockPage = {
        goto: vi.fn().mockResolvedValue(mockResponse),
      };

      const result = await detectPort(mockPage as any, 'http://localhost:3000');

      // baseUrl unchanged
      expect(result).toBe('http://localhost:3000');
      // Only one goto: the configured port probe
      expect(mockPage.goto).toHaveBeenCalledWith('http://localhost:3000', { timeout: 5000 });
    });

    it('should override baseUrl when app found on alternative port', async () => {
      const mockPage = {
        goto: vi.fn()
          // Configured port 3000 fails
          .mockRejectedValueOnce(new Error('Connection refused'))
          // Port 5173 succeeds
          .mockResolvedValue({ ok: () => true }),
      };

      const result = await detectPort(mockPage as any, 'http://localhost:3000');

      // baseUrl overridden to 5173
      expect(result).toBe('http://localhost:5173');
      // Tried 3000 first, then 5173
      expect(mockPage.goto).toHaveBeenCalledWith('http://localhost:3000', { timeout: 5000 });
      expect(mockPage.goto).toHaveBeenCalledWith('http://localhost:5173', { timeout: 3000 });
    });

    it('should only run once (portDetected flag)', async () => {
      const mockResponse = { ok: () => true };
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:3000'),
        goto: vi.fn().mockResolvedValue(mockResponse),
        evaluate: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };

      // First call: detectPort probes the port
      await detectPort(mockPage as any, 'http://localhost:3000');
      const gotoCallCountAfterDetect = mockPage.goto.mock.calls.length;

      // resetSession just does about:blank → baseUrl → clear → reload (no port probing)
      await resetSession(mockPage as any, 'http://localhost:3000');

      // goto called for about:blank + baseUrl in reset, but NOT for detectPort probe
      const newCalls = mockPage.goto.mock.calls.slice(gotoCallCountAfterDetect);
      const detectPortCalls = newCalls.filter(
        (call: any[]) => call[1]?.timeout !== undefined
      );
      expect(detectPortCalls).toHaveLength(0);
    });
  });
});
