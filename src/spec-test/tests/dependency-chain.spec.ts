import { describe, it, expect } from 'vitest';
import { buildDependencyChain } from '../index';
import type { HarborBehavior } from '../types';

describe('buildDependencyChain', () => {
  it('builds chain for behavior with no dependencies', () => {
    const behaviors = new Map<string, HarborBehavior>();

    const signUp: HarborBehavior = {
      id: 'sign-up',
      title: 'Sign Up',
      dependencies: [],
      examples: [{ name: 'test', steps: [] }]
    };

    behaviors.set('sign-up', signUp);

    const chain = buildDependencyChain('sign-up', behaviors);

    expect(chain).toHaveLength(1);
    expect(chain[0].behavior.id).toBe('sign-up');
  });

  it('builds chain for behavior with one dependency', () => {
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

    const chain = buildDependencyChain('sign-in', behaviors);

    expect(chain).toHaveLength(2);
    expect(chain[0].behavior.id).toBe('sign-up');
    expect(chain[1].behavior.id).toBe('sign-in');
  });

  it('builds chain for behavior with nested dependencies', () => {
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

    const deleteTask: HarborBehavior = {
      id: 'delete-task',
      title: 'Delete Task',
      dependencies: [{ behaviorId: 'add-task' }],
      examples: [{ name: 'test', steps: [] }]
    };

    behaviors.set('sign-up', signUp);
    behaviors.set('sign-in', signIn);
    behaviors.set('add-task', addTask);
    behaviors.set('delete-task', deleteTask);

    const chain = buildDependencyChain('delete-task', behaviors);

    expect(chain).toHaveLength(4);
    expect(chain[0].behavior.id).toBe('sign-up');
    expect(chain[1].behavior.id).toBe('sign-in');
    expect(chain[2].behavior.id).toBe('add-task');
    expect(chain[3].behavior.id).toBe('delete-task');
  });

  it('throws error if dependency not found', () => {
    const behaviors = new Map<string, HarborBehavior>();

    const signIn: HarborBehavior = {
      id: 'sign-in',
      title: 'Sign In',
      dependencies: [{ behaviorId: 'sign-up' }],
      examples: [{ name: 'test', steps: [] }]
    };

    behaviors.set('sign-in', signIn);

    expect(() => buildDependencyChain('sign-in', behaviors)).toThrow('Dependency "sign-up" not found');
  });

  it('throws error if target behavior not found', () => {
    const behaviors = new Map<string, HarborBehavior>();

    expect(() => buildDependencyChain('non-existent', behaviors)).toThrow('Behavior "non-existent" not found');
  });

  it('handles circular dependencies gracefully', () => {
    const behaviors = new Map<string, HarborBehavior>();

    // Create circular dependency: A -> B -> A
    const behaviorA: HarborBehavior = {
      id: 'behavior-a',
      title: 'Behavior A',
      dependencies: [{ behaviorId: 'behavior-b' }],
      examples: [{ name: 'test', steps: [] }]
    };

    const behaviorB: HarborBehavior = {
      id: 'behavior-b',
      title: 'Behavior B',
      dependencies: [{ behaviorId: 'behavior-a' }],
      examples: [{ name: 'test', steps: [] }]
    };

    behaviors.set('behavior-a', behaviorA);
    behaviors.set('behavior-b', behaviorB);

    // Should not infinite loop - visited set prevents it
    const chain = buildDependencyChain('behavior-a', behaviors);

    // With circular dependencies, the chain should contain each behavior once
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.length).toBeLessThanOrEqual(2);
  });
});
