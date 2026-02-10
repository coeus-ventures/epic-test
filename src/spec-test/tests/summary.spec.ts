import { describe, it, expect } from 'vitest';
import { calculateReward, generateSummary, aggregateResults } from '../index';
import type { BehaviorContext } from '../types';

describe('calculateReward', () => {
  it('calculates reward as passed/total', () => {
    const results: BehaviorContext[] = [
      { behaviorId: 'sign-up', behaviorName: 'Sign Up', status: 'pass', duration: 5000 },
      { behaviorId: 'sign-in', behaviorName: 'Sign In', status: 'pass', duration: 3000 },
      { behaviorId: 'add-task', behaviorName: 'Add Task', status: 'fail', duration: 2000 },
      { behaviorId: 'delete-task', behaviorName: 'Delete Task', status: 'dependency_failed', duration: 0, failedDependency: 'Add Task' }
    ];

    const reward = calculateReward(results);

    // 2 passed out of 4 total = 0.5
    expect(reward).toBe(0.5);
  });

  it('returns 0 when no behaviors pass', () => {
    const results: BehaviorContext[] = [
      { behaviorId: 'sign-up', behaviorName: 'Sign Up', status: 'fail', duration: 5000 },
      { behaviorId: 'sign-in', behaviorName: 'Sign In', status: 'dependency_failed', duration: 0, failedDependency: 'Sign Up' }
    ];

    const reward = calculateReward(results);

    expect(reward).toBe(0);
  });

  it('returns 1 when all behaviors pass', () => {
    const results: BehaviorContext[] = [
      { behaviorId: 'sign-up', behaviorName: 'Sign Up', status: 'pass', duration: 5000 },
      { behaviorId: 'sign-in', behaviorName: 'Sign In', status: 'pass', duration: 3000 }
    ];

    const reward = calculateReward(results);

    expect(reward).toBe(1);
  });

  it('returns 0 for empty array', () => {
    const reward = calculateReward([]);

    expect(reward).toBe(0);
  });
});

describe('aggregateResults', () => {
  it('counts statuses correctly', () => {
    const results: BehaviorContext[] = [
      { behaviorId: 'sign-up', behaviorName: 'Sign Up', status: 'pass', duration: 5000 },
      { behaviorId: 'sign-in', behaviorName: 'Sign In', status: 'fail', duration: 3000 },
      { behaviorId: 'add-task', behaviorName: 'Add Task', status: 'dependency_failed', duration: 0, failedDependency: 'Sign In' },
      { behaviorId: 'delete-task', behaviorName: 'Delete Task', status: 'dependency_failed', duration: 0, failedDependency: 'Sign In' }
    ];

    const aggregated = aggregateResults(results);

    expect(aggregated.passed).toBe(1);
    expect(aggregated.failed).toBe(1);
    expect(aggregated.dependency_failed).toBe(2);
    expect(aggregated.total).toBe(4);
    expect(aggregated.reward).toBe(0.25);
  });

  it('handles all-pass scenario', () => {
    const results: BehaviorContext[] = [
      { behaviorId: 'sign-up', behaviorName: 'Sign Up', status: 'pass', duration: 5000 },
      { behaviorId: 'sign-in', behaviorName: 'Sign In', status: 'pass', duration: 3000 }
    ];

    const aggregated = aggregateResults(results);

    expect(aggregated.passed).toBe(2);
    expect(aggregated.failed).toBe(0);
    expect(aggregated.dependency_failed).toBe(0);
    expect(aggregated.total).toBe(2);
    expect(aggregated.reward).toBe(1);
  });
});

describe('generateSummary', () => {
  it('generates summary for mixed results', () => {
    const results: BehaviorContext[] = [
      { behaviorId: 'sign-up', behaviorName: 'Sign Up', status: 'pass', duration: 5000 },
      { behaviorId: 'sign-in', behaviorName: 'Sign In', status: 'fail', duration: 3000, error: 'Login failed' },
      { behaviorId: 'add-task', behaviorName: 'Add Task', status: 'dependency_failed', duration: 0, failedDependency: 'Sign In' }
    ];

    const summary = generateSummary(results);

    expect(summary).toContain('1 behavior passed');
    expect(summary).toContain('1 failed (Sign In)');
    expect(summary).toContain('1 failed due to dependencies');
  });

  it('generates summary for all pass', () => {
    const results: BehaviorContext[] = [
      { behaviorId: 'sign-up', behaviorName: 'Sign Up', status: 'pass', duration: 5000 },
      { behaviorId: 'sign-in', behaviorName: 'Sign In', status: 'pass', duration: 3000 }
    ];

    const summary = generateSummary(results);

    expect(summary).toContain('2 behaviors passed');
    expect(summary).not.toContain('failed');
  });

  it('generates summary for all failed', () => {
    const results: BehaviorContext[] = [
      { behaviorId: 'sign-up', behaviorName: 'Sign Up', status: 'fail', duration: 5000 },
      { behaviorId: 'sign-in', behaviorName: 'Sign In', status: 'dependency_failed', duration: 0, failedDependency: 'Sign Up' }
    ];

    const summary = generateSummary(results);

    expect(summary).toContain('0 behaviors passed');
    expect(summary).toContain('1 failed (Sign Up)');
    expect(summary).toContain('1 failed due to dependencies');
  });
});
