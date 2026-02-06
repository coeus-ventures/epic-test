import { describe, it, expect, vi } from 'vitest';
import { verifyBehaviorWithDependencies, processStepsWithCredentials } from '../index';
import { VerificationContext, CredentialTracker } from '../index';
import type { HarborBehavior, ExampleResult, SpecStep } from '../types';

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

describe('CredentialTracker', () => {
  it('generates unique emails across chains via executionCounter', () => {
    const tracker = new CredentialTracker();

    // Chain 1
    const email1 = tracker.uniquifyEmail('user@test.com');
    expect(email1).toBe('user_1@test.com');

    // Reset between chains (clears credentials, keeps counter)
    tracker.reset();

    // Chain 2
    const email2 = tracker.uniquifyEmail('user@test.com');
    expect(email2).toBe('user_2@test.com');

    // Chain 3
    tracker.reset();
    const email3 = tracker.uniquifyEmail('user@test.com');
    expect(email3).toBe('user_3@test.com');
  });

  it('reset clears credentials but preserves counter', () => {
    const tracker = new CredentialTracker();

    tracker.captureFromStep('Type "user@test.com" into the email input field');
    tracker.captureFromStep('Type "pass123" into the password input field');
    expect(tracker.hasCredentials()).toBe(true);

    tracker.reset();
    expect(tracker.hasCredentials()).toBe(false);
    expect(tracker.getCredentials()).toEqual({ email: null, password: null });

    // Counter preserved — next uniquify continues from where it left off
    const email = tracker.uniquifyEmail('user@test.com');
    expect(email).toBe('user_1@test.com');
  });

  it('captures and injects credentials correctly', () => {
    const tracker = new CredentialTracker();

    tracker.captureFromStep('Type "alice@test.com" into the email input field');
    tracker.captureFromStep('Type "secret" into the password input field');

    expect(tracker.getCredentials()).toEqual({ email: 'alice@test.com', password: 'secret' });

    const injected = tracker.injectIntoStep('Type "other@test.com" into the email input field');
    expect(injected).toBe('Type "alice@test.com" into the email input field');

    const injectedPw = tracker.injectIntoStep('Type "wrongpw" into the password input field');
    expect(injectedPw).toBe('Type "secret" into the password input field');
  });
});

describe('processStepsWithCredentials', () => {
  it('uniquifies email in sign-up steps', () => {
    const tracker = new CredentialTracker();
    const behavior: HarborBehavior = {
      id: 'sign-up',
      title: 'Sign Up',
      dependencies: [],
      examples: []
    };
    const steps: SpecStep[] = [
      { type: 'act', instruction: 'Navigate to http://localhost:3000' },
      { type: 'act', instruction: 'Type "user@test.com" into the email input field' },
      { type: 'act', instruction: 'Type "password123" into the password input field' },
      { type: 'act', instruction: 'Click the "Sign Up" button' },
    ];

    const result = processStepsWithCredentials(behavior, steps, tracker);

    // Email should be uniquified
    expect(result[1].instruction).toBe('Type "user_1@test.com" into the email input field');
    // Password and other steps unchanged
    expect(result[2].instruction).toBe('Type "password123" into the password input field');
    expect(result[0].instruction).toBe('Navigate to http://localhost:3000');
  });

  it('each chain gets a different unique email', () => {
    const tracker = new CredentialTracker();
    const behavior: HarborBehavior = {
      id: 'sign-up',
      title: 'Sign Up',
      dependencies: [],
      examples: []
    };
    const steps: SpecStep[] = [
      { type: 'act', instruction: 'Type "user@test.com" into the email input field' },
    ];

    // Chain 1
    const chain1 = processStepsWithCredentials(behavior, steps, tracker);
    expect(chain1[0].instruction).toContain('user_1@test.com');

    // Chain 2 (reset credentials, counter persists)
    tracker.reset();
    const chain2 = processStepsWithCredentials(behavior, steps, tracker);
    expect(chain2[0].instruction).toContain('user_2@test.com');

    // Chain 3
    tracker.reset();
    const chain3 = processStepsWithCredentials(behavior, steps, tracker);
    expect(chain3[0].instruction).toContain('user_3@test.com');
  });

  it('injects captured credentials into non-signup behaviors', () => {
    const tracker = new CredentialTracker();

    // Simulate Sign Up capturing credentials
    tracker.captureFromStep('Type "user_1@test.com" into the email input field');
    tracker.captureFromStep('Type "password123" into the password input field');

    const signIn: HarborBehavior = {
      id: 'sign-in',
      title: 'Sign In',
      dependencies: [{ behaviorId: 'sign-up' }],
      examples: []
    };
    const steps: SpecStep[] = [
      { type: 'act', instruction: 'Navigate to http://localhost:3000' },
      { type: 'act', instruction: 'Type "default@test.com" into the email input field' },
      { type: 'act', instruction: 'Type "default" into the password input field' },
      { type: 'act', instruction: 'Click the "Sign In" button' },
    ];

    const result = processStepsWithCredentials(signIn, steps, tracker);

    // Credentials should be injected from tracker
    expect(result[1].instruction).toBe('Type "user_1@test.com" into the email input field');
    expect(result[2].instruction).toBe('Type "password123" into the password input field');
  });

  it('does not inject credentials into invalid sign-in behaviors', () => {
    const tracker = new CredentialTracker();

    // Simulate Sign Up capturing credentials
    tracker.captureFromStep('Type "user_1@test.com" into the email input field');
    tracker.captureFromStep('Type "password123" into the password input field');

    const invalidSignIn: HarborBehavior = {
      id: 'invalid-sign-in',
      title: 'Invalid Sign In',
      dependencies: [{ behaviorId: 'sign-up' }],
      examples: []
    };
    const steps: SpecStep[] = [
      { type: 'act', instruction: 'Navigate to http://localhost:3000' },
      { type: 'act', instruction: 'Type "wrong@email.com" into the email input field' },
      { type: 'act', instruction: 'Type "wrongpassword" into the password input field' },
      { type: 'act', instruction: 'Click the "Sign In" button' },
    ];

    const result = processStepsWithCredentials(invalidSignIn, steps, tracker);

    // Credentials should NOT be injected — behavior uses intentionally wrong credentials
    expect(result[1].instruction).toBe('Type "wrong@email.com" into the email input field');
    expect(result[2].instruction).toBe('Type "wrongpassword" into the password input field');
  });
});
