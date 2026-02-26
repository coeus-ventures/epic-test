import { describe, it, expect, vi } from 'vitest';
import { isAuthBehavior, withTimeout, runAuthBehaviorsSequence, DEFAULT_BEHAVIOR_TIMEOUT_MS } from '../index';
import { VerificationContext } from '../verification-context';
import { CredentialTracker } from '../credential-tracker';
import type { HarborBehavior, ExampleResult, BehaviorRunner } from '../types';

describe('isAuthBehavior', () => {
  it('should match exact auth pattern IDs', () => {
    expect(isAuthBehavior('sign-up')).toBe(true);
    expect(isAuthBehavior('signup')).toBe(true);
    expect(isAuthBehavior('sign-in')).toBe(true);
    expect(isAuthBehavior('signin')).toBe(true);
    expect(isAuthBehavior('sign-out')).toBe(true);
    expect(isAuthBehavior('signout')).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isAuthBehavior('Sign-Up')).toBe(true);
    expect(isAuthBehavior('SIGN-IN')).toBe(true);
    expect(isAuthBehavior('SignOut')).toBe(true);
  });

  it('should not match non-auth behavior IDs', () => {
    expect(isAuthBehavior('add-task')).toBe(false);
    expect(isAuthBehavior('create-project')).toBe(false);
    expect(isAuthBehavior('view-dashboard')).toBe(false);
    expect(isAuthBehavior('edit-profile')).toBe(false);
  });

  it('should not match IDs that contain auth patterns as substrings', () => {
    expect(isAuthBehavior('user-sign-up-flow')).toBe(false);
    expect(isAuthBehavior('my-signin-page')).toBe(false);
    expect(isAuthBehavior('invalid-sign-in')).toBe(false);
  });
});

describe('withTimeout', () => {
  it('should resolve when promise completes before timeout', async () => {
    const result = await withTimeout(
      Promise.resolve('done'),
      1000,
      'Timed out'
    );
    expect(result).toBe('done');
  });

  it('should reject with timeout error when promise exceeds timeout', async () => {
    const slowPromise = new Promise<string>(resolve =>
      setTimeout(() => resolve('late'), 500)
    );

    await expect(
      withTimeout(slowPromise, 50, 'Operation timed out after 0.05s')
    ).rejects.toThrow('Operation timed out after 0.05s');
  });

  it('should propagate original promise rejection', async () => {
    const failingPromise = Promise.reject(new Error('Original error'));

    await expect(
      withTimeout(failingPromise, 5000, 'Should not timeout')
    ).rejects.toThrow('Original error');
  });
});

describe('DEFAULT_BEHAVIOR_TIMEOUT_MS', () => {
  it('should be 120000 (2 minutes)', () => {
    expect(DEFAULT_BEHAVIOR_TIMEOUT_MS).toBe(120_000);
  });
});

describe('runAuthBehaviorsSequence', () => {
  const createMockRunner = (shouldSucceed: boolean) => ({
    runExample: vi.fn<BehaviorRunner['runExample']>(async (): Promise<ExampleResult> => ({
      example: { name: 'test', steps: [] },
      success: shouldSucceed,
      steps: [],
      duration: 100,
      failedAt: shouldSucceed ? undefined : {
        stepIndex: 0,
        step: { type: 'act' as const, instruction: 'test' },
        context: {
          pageSnapshot: '',
          pageUrl: '',
          failedStep: { type: 'act' as const, instruction: 'test' },
          error: 'Test error',
          availableElements: [],
          suggestions: [],
        },
      },
    })),
  });

  function makeBehavior(id: string, title: string, exampleCount = 1): HarborBehavior {
    const examples = Array.from({ length: exampleCount }, (_, i) => ({
      name: `Execute ${title} ${i + 1}`,
      steps: [
        { type: 'act' as const, instruction: 'Act: Navigate to http://localhost:3000' },
        { type: 'act' as const, instruction: 'Act: Click button' },
      ],
    }));
    return { id, title, dependencies: [], examples };
  }

  it('should execute auth behaviors in the correct order (Sign Up → Sign Out → Sign In)', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('sign-up', makeBehavior('sign-up', 'Sign Up'));
    behaviors.set('sign-out', makeBehavior('sign-out', 'Sign Out'));
    behaviors.set('sign-in', makeBehavior('sign-in', 'Sign In'));

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(true);

    const results = await runAuthBehaviorsSequence(
      behaviors, context, credentialTracker, runner, 60000
    );

    expect(results).toHaveLength(3);
    expect(results[0].behaviorId).toBe('sign-up');
    expect(results[1].behaviorId).toBe('sign-out');
    expect(results[2].behaviorId).toBe('sign-in');

    expect(results.every(r => r.status === 'pass')).toBe(true);

    // 3 behaviors × 1 example each = 3 calls
    expect(runner.runExample).toHaveBeenCalledTimes(3);

    expect(runner.runExample.mock.calls[0][1]).toEqual({ clearSession: true, reloadPage: false });
    expect(runner.runExample.mock.calls[1][1]).toEqual({ clearSession: false, reloadPage: false });
    // Sign In first example: no reload (inherits state from Sign Out)
    expect(runner.runExample.mock.calls[2][1]).toEqual({ clearSession: false, reloadPage: false });
  });

  it('should run multiple Sign In scenarios with reload between them', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('sign-up', makeBehavior('sign-up', 'Sign Up'));
    behaviors.set('sign-out', makeBehavior('sign-out', 'Sign Out'));
    // Sign In with 2 scenarios (wrong credentials + valid credentials)
    behaviors.set('sign-in', makeBehavior('sign-in', 'Sign In', 2));

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(true);

    const results = await runAuthBehaviorsSequence(
      behaviors, context, credentialTracker, runner, 60000
    );

    expect(results).toHaveLength(3);
    expect(results[2].behaviorId).toBe('sign-in');
    expect(results[2].status).toBe('pass');

    // 1 Sign Up + 1 Sign Out + 2 Sign In scenarios = 4 calls
    expect(runner.runExample).toHaveBeenCalledTimes(4);

    // Sign Up: clearSession, no reload
    expect(runner.runExample.mock.calls[0][1]).toEqual({ clearSession: true, reloadPage: false });
    // Sign Out: no clear, no reload
    expect(runner.runExample.mock.calls[1][1]).toEqual({ clearSession: false, reloadPage: false });
    // Sign In scenario 1: no clear, no reload (inherits state from Sign Out)
    expect(runner.runExample.mock.calls[2][1]).toEqual({ clearSession: false, reloadPage: false });
    // Sign In scenario 2: no clear, reload (clean form state)
    expect(runner.runExample.mock.calls[3][1]).toEqual({ clearSession: false, reloadPage: true });
  });

  it('should skip subsequent auth behaviors when sign-up fails', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('sign-up', makeBehavior('sign-up', 'Sign Up'));
    behaviors.set('sign-out', makeBehavior('sign-out', 'Sign Out'));
    behaviors.set('sign-in', makeBehavior('sign-in', 'Sign In'));

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(false);

    const results = await runAuthBehaviorsSequence(
      behaviors, context, credentialTracker, runner, 60000
    );

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe('fail');
    expect(results[0].behaviorId).toBe('sign-up');
    expect(results[1].status).toBe('dependency_failed');
    expect(results[1].failedDependency).toBe('Sign Up');
    expect(results[2].status).toBe('dependency_failed');

    expect(runner.runExample).toHaveBeenCalledTimes(1);
  });

  it('should return empty array when no auth behaviors exist', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('add-task', makeBehavior('add-task', 'Add Task'));
    behaviors.set('edit-task', makeBehavior('edit-task', 'Edit Task'));

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(true);

    const results = await runAuthBehaviorsSequence(
      behaviors, context, credentialTracker, runner, 60000
    );

    expect(results).toHaveLength(0);
    expect(runner.runExample).not.toHaveBeenCalled();
  });

  it('should handle timeout per behavior', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('sign-up', makeBehavior('sign-up', 'Sign Up'));

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = {
      runExample: vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return {
          example: { name: 'test', steps: [] },
          success: true,
          steps: [],
          duration: 200,
        };
      }),
    };

    const results = await runAuthBehaviorsSequence(
      behaviors, context, credentialTracker, runner, 50
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('fail');
    expect(results[0].error).toContain('timed out');
  });

  it('should mark results in verification context', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('sign-up', makeBehavior('sign-up', 'Sign Up'));
    behaviors.set('sign-in', makeBehavior('sign-in', 'Sign In'));

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(true);

    await runAuthBehaviorsSequence(
      behaviors, context, credentialTracker, runner, 60000
    );

    expect(context.getResult('sign-up')?.status).toBe('pass');
    expect(context.getResult('sign-in')?.status).toBe('pass');
  });

  it('should handle behavior with no examples', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    const emptyBehavior: HarborBehavior = {
      id: 'sign-up',
      title: 'Sign Up',
      dependencies: [],
      examples: [],
    };
    behaviors.set('sign-up', emptyBehavior);

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(true);

    const results = await runAuthBehaviorsSequence(
      behaviors, context, credentialTracker, runner, 60000
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('fail');
    expect(results[0].error).toContain('No examples found');
  });

  it('should reload for sign-in scenarios after the first (ensures clean form state)', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('sign-up', makeBehavior('sign-up', 'Sign Up'));
    behaviors.set('sign-out', makeBehavior('sign-out', 'Sign Out'));
    behaviors.set('sign-in', makeBehavior('sign-in', 'Sign In', 2));

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(true);

    await runAuthBehaviorsSequence(
      behaviors, context, credentialTracker, runner, 60000
    );

    // Sign In scenario 1: no reload (inherits from Sign Out)
    expect(runner.runExample.mock.calls[2][1]).toMatchObject({ clearSession: false, reloadPage: false });
    // Sign In scenario 2: reload (clean form state after wrong credentials scenario)
    expect(runner.runExample.mock.calls[3][1]).toMatchObject({ clearSession: false, reloadPage: true });
  });

  it('should only run auth behaviors found in authOrder', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('sign-up', makeBehavior('sign-up', 'Sign Up'));
    behaviors.set('add-task', makeBehavior('add-task', 'Add Task'));
    behaviors.set('sign-in', makeBehavior('sign-in', 'Sign In'));

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(true);

    const results = await runAuthBehaviorsSequence(
      behaviors, context, credentialTracker, runner, 60000
    );

    expect(results).toHaveLength(2);
    expect(results[0].behaviorId).toBe('sign-up');
    expect(results[1].behaviorId).toBe('sign-in');
  });

  it('should fail Sign In if any scenario fails', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('sign-up', makeBehavior('sign-up', 'Sign Up'));
    behaviors.set('sign-in', makeBehavior('sign-in', 'Sign In', 2));

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();

    let callCount = 0;
    const runner = {
      runExample: vi.fn<BehaviorRunner['runExample']>(async (): Promise<ExampleResult> => {
        callCount++;
        // Sign Up succeeds (call 1), Sign In scenario 1 fails (call 2), scenario 2 succeeds (call 3)
        const shouldFail = callCount === 2;
        return {
          example: { name: 'test', steps: [] },
          success: !shouldFail,
          steps: [],
          duration: 100,
          failedAt: shouldFail ? {
            stepIndex: 0,
            step: { type: 'act' as const, instruction: 'test' },
            context: {
              pageSnapshot: '',
              pageUrl: '',
              failedStep: { type: 'act' as const, instruction: 'test' },
              error: 'Wrong credentials error',
              availableElements: [],
              suggestions: [],
            },
          } : undefined,
        };
      }),
    };

    const results = await runAuthBehaviorsSequence(
      behaviors, context, credentialTracker, runner, 60000
    );

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('pass'); // Sign Up
    expect(results[1].status).toBe('fail'); // Sign In (first scenario failed)
    expect(results[1].error).toBe('Wrong credentials error');
  });
});
