import { describe, it, expect, vi } from 'vitest';
import { SpecTestRunner } from '../runner';
import { isNavigationAction, isRefreshAction, extractExpectedText } from '../step-execution';
import type { SpecStep, StepContext } from '../types';

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
      // Inject mocks via private properties
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
      // Stagehand.act should NOT be called for direct navigation
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

  describe('runStep — check with deterministic text fast-path', () => {
    it('should return deterministic pass when quoted text is found on page', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/dashboard'),
        evaluate: vi.fn().mockResolvedValue(true), // text found
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
      // Should not call semantic oracle since deterministic passed
      expect(mockTester.assert).not.toHaveBeenCalled();
    });
  });

  describe('runExample — session management', () => {
    it('should return failure when page is unavailable', async () => {
      const runner = new SpecTestRunner({ baseUrl: 'http://localhost:8080' });

      // Simulate stagehand returning no active page
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

      // Should navigate to about:blank then baseUrl (hard reset)
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

      const example = {
        name: 'Test',
        steps: [],
      };

      await runner.runExample(example, { clearSession: false });

      // Should NOT navigate or clear anything
      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it('should navigate to path when clearSession is false with navigateToPath', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080/candidates'),
        goto: vi.fn().mockResolvedValue(undefined),
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

      const example = { name: 'Test', steps: [] };

      await runner.runExample(example, { clearSession: false, navigateToPath: '/candidates' });

      expect(mockPage.goto).toHaveBeenCalledWith('http://localhost:8080/candidates');
    });
  });

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
        close: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      };
      const mockTester = {
        clearSnapshots: vi.fn(),
      };

      (runner as any).stagehand = mockStagehand;
      (runner as any).tester = mockTester;

      // Should not hang — has 10s internal timeout
      await expect(runner.close()).resolves.not.toThrow();
    });
  });

  describe('isRetryableError (via executeActWithRetry)', () => {
    it('should retry on schema errors', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('http://localhost:8080'),
        title: vi.fn().mockResolvedValue('Test'),
        evaluate: vi.fn().mockResolvedValue([]),
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

      // Should eventually succeed after retries
      expect(result.success).toBe(true);
      expect(mockStagehand.act).toHaveBeenCalledTimes(3);
    });
  });

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
});
