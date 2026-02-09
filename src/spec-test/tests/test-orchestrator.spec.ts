import { describe, it, expect, vi } from 'vitest';
import type { ExampleResult, HarborBehavior } from '../types';

// Mock fs/promises before importing the module
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

// Mock parsing to control behavior definitions
vi.mock('../parsing', async (importOriginal) => {
  const original = await importOriginal<typeof import('../parsing')>();
  return {
    ...original,
    parseHarborBehaviorsWithDependencies: vi.fn(),
  };
});

// Mock verification-runner
vi.mock('../verification-runner', () => ({
  verifyBehaviorWithDependencies: vi.fn(),
}));

// Mock auth-orchestrator partially — keep real isAuthBehavior, mock runAuthBehaviorsSequence
vi.mock('../auth-orchestrator', async (importOriginal) => {
  const original = await importOriginal<typeof import('../auth-orchestrator')>();
  return {
    ...original,
    runAuthBehaviorsSequence: vi.fn(),
  };
});

import { readFile } from 'fs/promises';
import { parseHarborBehaviorsWithDependencies } from '../parsing';
import { verifyBehaviorWithDependencies } from '../verification-runner';
import { runAuthBehaviorsSequence } from '../auth-orchestrator';
import { verifyAllBehaviors } from '../orchestrator';

describe('verifyAllBehaviors', () => {
  const mockReadFile = vi.mocked(readFile);
  const mockParse = vi.mocked(parseHarborBehaviorsWithDependencies);
  const mockRunAuth = vi.mocked(runAuthBehaviorsSequence);
  const mockVerifyBehavior = vi.mocked(verifyBehaviorWithDependencies);

  const mockRunner = {
    runExample: vi.fn(),
  };

  function makeBehavior(id: string, title: string): HarborBehavior {
    return {
      id,
      title,
      dependencies: [],
      examples: [{ name: title, steps: [{ type: 'act', instruction: 'Click button' }] }],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse instruction file and run auth behaviors first, then non-auth', async () => {
    const signUp = makeBehavior('sign-up', 'Sign Up');
    const addTask = makeBehavior('add-task', 'Add Task');

    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('sign-up', signUp);
    behaviors.set('add-task', addTask);

    mockReadFile.mockResolvedValue('## Behaviors\n### Sign Up\n...');
    mockParse.mockReturnValue(behaviors);
    mockRunAuth.mockResolvedValue([
      { behaviorId: 'sign-up', behaviorName: 'Sign Up', status: 'pass', duration: 500 },
    ]);
    mockVerifyBehavior.mockResolvedValue(
      { behaviorId: 'add-task', behaviorName: 'Add Task', status: 'pass', duration: 300 }
    );

    const summary = await verifyAllBehaviors('/path/to/instruction.md', mockRunner);

    // readFile called with the instruction path
    expect(mockReadFile).toHaveBeenCalledWith('/path/to/instruction.md', 'utf-8');

    // Auth behaviors run first
    expect(mockRunAuth).toHaveBeenCalledTimes(1);

    // Non-auth behavior verified after
    expect(mockVerifyBehavior).toHaveBeenCalledTimes(1);
    expect(mockVerifyBehavior.mock.calls[0][0].id).toBe('add-task');

    // Summary has correct totals
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.total).toBe(2);
    expect(summary.reward).toBe(1);
    expect(summary.behaviors).toHaveLength(2);
  });

  it('should skip auth behaviors in non-auth loop', async () => {
    const signUp = makeBehavior('sign-up', 'Sign Up');
    const signIn = makeBehavior('sign-in', 'Sign In');
    const viewDash = makeBehavior('view-dashboard', 'View Dashboard');

    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('sign-up', signUp);
    behaviors.set('sign-in', signIn);
    behaviors.set('view-dashboard', viewDash);

    mockReadFile.mockResolvedValue('content');
    mockParse.mockReturnValue(behaviors);
    mockRunAuth.mockResolvedValue([
      { behaviorId: 'sign-up', behaviorName: 'Sign Up', status: 'pass', duration: 100 },
      { behaviorId: 'sign-in', behaviorName: 'Sign In', status: 'pass', duration: 100 },
    ]);
    mockVerifyBehavior.mockResolvedValue(
      { behaviorId: 'view-dashboard', behaviorName: 'View Dashboard', status: 'pass', duration: 200 }
    );

    const summary = await verifyAllBehaviors('/path/to/instruction.md', mockRunner);

    // verifyBehaviorWithDependencies should only be called for non-auth behavior
    expect(mockVerifyBehavior).toHaveBeenCalledTimes(1);
    expect(mockVerifyBehavior.mock.calls[0][0].id).toBe('view-dashboard');

    expect(summary.total).toBe(3);
  });

  it('should return correct summary when behaviors fail', async () => {
    const signUp = makeBehavior('sign-up', 'Sign Up');
    const addTask = makeBehavior('add-task', 'Add Task');

    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('sign-up', signUp);
    behaviors.set('add-task', addTask);

    mockReadFile.mockResolvedValue('content');
    mockParse.mockReturnValue(behaviors);
    mockRunAuth.mockResolvedValue([
      { behaviorId: 'sign-up', behaviorName: 'Sign Up', status: 'fail', error: 'Signup failed', duration: 500 },
    ]);
    mockVerifyBehavior.mockResolvedValue(
      { behaviorId: 'add-task', behaviorName: 'Add Task', status: 'dependency_failed', failedDependency: 'Sign Up', duration: 0 }
    );

    const summary = await verifyAllBehaviors('/path/to/instruction.md', mockRunner);

    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.dependency_failed).toBe(1);
    expect(summary.total).toBe(2);
    expect(summary.reward).toBe(0);
  });

  it('should handle timeout for individual non-auth behaviors', async () => {
    const addTask = makeBehavior('add-task', 'Add Task');

    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('add-task', addTask);

    mockReadFile.mockResolvedValue('content');
    mockParse.mockReturnValue(behaviors);
    mockRunAuth.mockResolvedValue([]);
    mockVerifyBehavior.mockRejectedValue(new Error('Behavior "Add Task" timed out after 120s'));

    const summary = await verifyAllBehaviors('/path/to/instruction.md', mockRunner);

    expect(summary.failed).toBe(1);
    expect(summary.behaviors[0].error).toContain('timed out');
    expect(summary.behaviors[0].status).toBe('fail');
  });

  it('should handle unexpected errors in non-auth behaviors', async () => {
    const addTask = makeBehavior('add-task', 'Add Task');

    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('add-task', addTask);

    mockReadFile.mockResolvedValue('content');
    mockParse.mockReturnValue(behaviors);
    mockRunAuth.mockResolvedValue([]);
    mockVerifyBehavior.mockRejectedValue(new Error('Browser crashed'));

    const summary = await verifyAllBehaviors('/path/to/instruction.md', mockRunner);

    expect(summary.failed).toBe(1);
    expect(summary.behaviors[0].error).toContain('Unexpected error');
    expect(summary.behaviors[0].error).toContain('Browser crashed');
  });

  it('should handle empty behaviors map', async () => {
    mockReadFile.mockResolvedValue('# Empty doc');
    mockParse.mockReturnValue(new Map());
    mockRunAuth.mockResolvedValue([]);

    const summary = await verifyAllBehaviors('/path/to/instruction.md', mockRunner);

    expect(summary.total).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.reward).toBe(0);
    expect(summary.behaviors).toHaveLength(0);
  });

  it('should reset credential tracker for each non-auth behavior chain', async () => {
    const addTask = makeBehavior('add-task', 'Add Task');
    const editTask = makeBehavior('edit-task', 'Edit Task');

    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('add-task', addTask);
    behaviors.set('edit-task', editTask);

    mockReadFile.mockResolvedValue('content');
    mockParse.mockReturnValue(behaviors);
    mockRunAuth.mockResolvedValue([]);

    // Track the credentialTracker argument to verify reset is called
    const trackerStates: boolean[] = [];
    mockVerifyBehavior.mockImplementation(async (_behavior, _all, _ctx, credentialTracker) => {
      // After reset(), hasCredentials() should be false
      trackerStates.push(credentialTracker.hasCredentials());
      return {
        behaviorId: _behavior.id,
        behaviorName: _behavior.title,
        status: 'pass' as const,
        duration: 100,
      };
    });

    await verifyAllBehaviors('/path/to/instruction.md', mockRunner);

    // Each non-auth behavior gets a fresh (reset) credential tracker
    expect(trackerStates).toEqual([false, false]);
  });

  it('should use custom timeout when provided', async () => {
    const addTask = makeBehavior('add-task', 'Add Task');

    const behaviors = new Map<string, HarborBehavior>();
    behaviors.set('add-task', addTask);

    mockReadFile.mockResolvedValue('content');
    mockParse.mockReturnValue(behaviors);
    mockRunAuth.mockResolvedValue([]);
    mockVerifyBehavior.mockResolvedValue(
      { behaviorId: 'add-task', behaviorName: 'Add Task', status: 'pass', duration: 100 }
    );

    await verifyAllBehaviors('/path/to/instruction.md', mockRunner, 30000);

    // Auth sequence gets the custom timeout
    expect(mockRunAuth.mock.calls[0][4]).toBe(30000);
  });
});
