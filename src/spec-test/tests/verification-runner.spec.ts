import { describe, it, expect, vi } from 'vitest';
import { verifyBehaviorWithDependencies } from '../index';
import { VerificationContext, CredentialTracker } from '../index';
import type { HarborBehavior, ExampleResult } from '../types';

describe('verifyBehaviorWithDependencies', () => {
  // Mock SpecTestRunner
  const createMockRunner = (shouldSucceed: boolean) => {
    return {
      runExample: vi.fn(async (): Promise<ExampleResult> => ({
        example: { name: 'test', steps: [] },
        success: shouldSucceed,
        steps: [],
        duration: 1000,
        failedAt: shouldSucceed ? undefined : {
          stepIndex: 0,
          step: { type: 'act', instruction: 'test' },
          context: {
            pageSnapshot: '',
            pageUrl: '',
            failedStep: { type: 'act', instruction: 'test' },
            error: 'Test error',
            availableElements: [],
            suggestions: []
          }
        }
      }))
    } as any;
  };

  it('skips behavior if dependency failed as target', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    const signUp: HarborBehavior = {
      id: 'sign-up',
      title: 'Sign Up',
      dependencies: [],
      examples: [{ name: 'test', steps: [] }]
    };
    const signIn: HarborBehavior = {
      id: 'sign-in',
      title: 'Sign In',
      dependencies: [{ behaviorId: 'sign-up' }],
      examples: [{ name: 'test', steps: [] }]
    };

    behaviors.set('sign-up', signUp);
    behaviors.set('sign-in', signIn);

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(true);

    // Mark Sign Up as failed (it failed on its own target test)
    context.markResult('sign-up', {
      behaviorId: 'sign-up',
      behaviorName: 'Sign Up',
      status: 'fail',
      duration: 1000
    });

    // Sign In should be skipped — no point testing if Sign Up can't work
    const result = await verifyBehaviorWithDependencies(
      signIn,
      behaviors,
      context,
      credentialTracker,
      runner
    );

    expect(result.status).toBe('dependency_failed');
    expect(result.failedDependency).toContain('Sign Up');
    expect(runner.runExample).not.toHaveBeenCalled();
  });

  it('executes full chain for behavior with dependencies', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    const signUp: HarborBehavior = {
      id: 'sign-up',
      title: 'Sign Up',
      dependencies: [],
      examples: [{ name: 'test', steps: [] }]
    };
    const signIn: HarborBehavior = {
      id: 'sign-in',
      title: 'Sign In',
      dependencies: [{ behaviorId: 'sign-up' }],
      examples: [{ name: 'test', steps: [] }]
    };

    behaviors.set('sign-up', signUp);
    behaviors.set('sign-in', signIn);

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(true);

    // Verify Sign In (should run Sign Up first, then Sign In)
    const result = await verifyBehaviorWithDependencies(
      signIn,
      behaviors,
      context,
      credentialTracker,
      runner
    );

    expect(result.status).toBe('pass');
    expect(runner.runExample).toHaveBeenCalledTimes(2); // Sign Up + Sign In
  });

  it('returns dependency_failed if dependency fails during execution', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    const signUp: HarborBehavior = {
      id: 'sign-up',
      title: 'Sign Up',
      dependencies: [],
      examples: [{ name: 'test', steps: [] }]
    };
    const signIn: HarborBehavior = {
      id: 'sign-in',
      title: 'Sign In',
      dependencies: [{ behaviorId: 'sign-up' }],
      examples: [{ name: 'test', steps: [] }]
    };

    behaviors.set('sign-up', signUp);
    behaviors.set('sign-in', signIn);

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(false); // Sign Up will fail

    // Verify Sign In
    const result = await verifyBehaviorWithDependencies(
      signIn,
      behaviors,
      context,
      credentialTracker,
      runner
    );

    expect(result.status).toBe('dependency_failed');
    expect(result.failedDependency).toBe('Sign Up');
  });

  it('returns fail if target behavior fails', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    const signUp: HarborBehavior = {
      id: 'sign-up',
      title: 'Sign Up',
      dependencies: [],
      examples: [{ name: 'test', steps: [] }]
    };

    behaviors.set('sign-up', signUp);

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(false); // Will fail

    const result = await verifyBehaviorWithDependencies(
      signUp,
      behaviors,
      context,
      credentialTracker,
      runner
    );

    expect(result.status).toBe('fail');
    expect(result.error).toBeDefined();
  });

  it('re-executes all dependencies even if previously passed', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    const signUp: HarborBehavior = {
      id: 'sign-up',
      title: 'Sign Up',
      dependencies: [],
      examples: [{ name: 'test', steps: [] }]
    };
    const signIn: HarborBehavior = {
      id: 'sign-in',
      title: 'Sign In',
      dependencies: [{ behaviorId: 'sign-up' }],
      examples: [{ name: 'test', steps: [] }]
    };
    const addTask: HarborBehavior = {
      id: 'add-task',
      title: 'Add Task',
      dependencies: [{ behaviorId: 'sign-in' }],
      examples: [{ name: 'test', steps: [] }]
    };

    behaviors.set('sign-up', signUp);
    behaviors.set('sign-in', signIn);
    behaviors.set('add-task', addTask);

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();
    const runner = createMockRunner(true);

    // First verify Sign In (runs Sign Up + Sign In = 2 calls)
    await verifyBehaviorWithDependencies(
      signIn,
      behaviors,
      context,
      credentialTracker,
      runner
    );

    expect(runner.runExample).toHaveBeenCalledTimes(2);

    // Reset mock
    vi.clearAllMocks();

    // Verify Add Task — runs full chain again: Sign Up + Sign In + Add Task = 3 calls
    await verifyBehaviorWithDependencies(
      addTask,
      behaviors,
      context,
      credentialTracker,
      runner
    );

    expect(runner.runExample).toHaveBeenCalledTimes(3);
  });

  it('does not overwrite dependency pass status when it fails in another chain', async () => {
    const behaviors = new Map<string, HarborBehavior>();
    const signUp: HarborBehavior = {
      id: 'sign-up',
      title: 'Sign Up',
      dependencies: [],
      examples: [{ name: 'test', steps: [] }]
    };
    const signIn: HarborBehavior = {
      id: 'sign-in',
      title: 'Sign In',
      dependencies: [{ behaviorId: 'sign-up' }],
      examples: [{ name: 'test', steps: [] }]
    };

    behaviors.set('sign-up', signUp);
    behaviors.set('sign-in', signIn);

    const context = new VerificationContext();
    const credentialTracker = new CredentialTracker();

    // Sign Up passed as a target
    context.markResult('sign-up', {
      behaviorId: 'sign-up',
      behaviorName: 'Sign Up',
      status: 'pass',
      duration: 5000
    });

    // Sign In chain: Sign Up re-executes and fails
    const runner = createMockRunner(false);
    const result = await verifyBehaviorWithDependencies(
      signIn,
      behaviors,
      context,
      credentialTracker,
      runner
    );

    // Sign In gets dependency_failed with tracking
    expect(result.status).toBe('dependency_failed');
    expect(result.failedDependency).toBe('Sign Up');

    // Sign Up's status in context must still be 'pass'
    expect(context.getResult('sign-up')?.status).toBe('pass');
  });
});
