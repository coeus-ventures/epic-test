import { describe, it, expect } from 'vitest';
import { processStepsWithCredentials } from '../index';
import { CredentialTracker } from '../credential-tracker';
import type { HarborBehavior, SpecStep } from '../types';

describe('CredentialTracker', () => {
  it('generates unique emails across chains via executionCounter', () => {
    const tracker = new CredentialTracker();

    // Chain 1
    const email1 = tracker.uniquifyEmail('user@test.com');
    expect(email1).toMatch(/^user_\d+@test\.com$/);

    // Reset between chains (clears credentials, keeps counter)
    tracker.reset();

    // Chain 2 — must be different from chain 1
    const email2 = tracker.uniquifyEmail('user@test.com');
    expect(email2).toMatch(/^user_\d+@test\.com$/);
    expect(email2).not.toBe(email1);

    // Chain 3 — must be different from both
    tracker.reset();
    const email3 = tracker.uniquifyEmail('user@test.com');
    expect(email3).toMatch(/^user_\d+@test\.com$/);
    expect(email3).not.toBe(email1);
    expect(email3).not.toBe(email2);
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
    expect(email).toMatch(/^user_\d+@test\.com$/);
  });

  it('produces different emails across separate tracker instances', () => {
    const tracker1 = new CredentialTracker();
    const tracker2 = new CredentialTracker();

    const email1 = tracker1.uniquifyEmail('user@test.com');
    const email2 = tracker2.uniquifyEmail('user@test.com');

    // Random seed makes collision extremely unlikely
    expect(email1).not.toBe(email2);
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

    // Email should be uniquified with a numeric suffix
    expect(result[1].instruction).toMatch(/Type "user_\d+@test\.com" into the email input field/);
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
    const email1 = chain1[0].instruction;

    // Chain 2 (reset credentials, counter persists)
    tracker.reset();
    const chain2 = processStepsWithCredentials(behavior, steps, tracker);
    const email2 = chain2[0].instruction;

    // Chain 3
    tracker.reset();
    const chain3 = processStepsWithCredentials(behavior, steps, tracker);
    const email3 = chain3[0].instruction;

    // All must be different
    expect(email1).not.toBe(email2);
    expect(email2).not.toBe(email3);
    expect(email1).not.toBe(email3);
  });

  it('injects captured credentials into non-signup behaviors', () => {
    const tracker = new CredentialTracker();

    // Simulate Sign Up capturing credentials
    tracker.captureFromStep('Type "user_123456@test.com" into the email input field');
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
    expect(result[1].instruction).toBe('Type "user_123456@test.com" into the email input field');
    expect(result[2].instruction).toBe('Type "password123" into the password input field');
  });

  it('does not inject credentials into invalid sign-in behaviors', () => {
    const tracker = new CredentialTracker();

    // Simulate Sign Up capturing credentials
    tracker.captureFromStep('Type "user_123456@test.com" into the email input field');
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
