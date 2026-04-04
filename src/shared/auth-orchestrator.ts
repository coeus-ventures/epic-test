// ============================================================================
// AUTH BEHAVIOR IDENTIFICATION & FLOW
// ============================================================================

import type { HarborBehavior, BehaviorContext, BehaviorRunner, ExampleResult } from "./types";
import { VerificationContext } from "./verification-context";
import { CredentialTracker, processStepsWithCredentials } from "./credential-tracker";

/** Known auth behavior ID patterns */
const AUTH_PATTERNS = ['sign-up', 'signup', 'sign-in', 'signin', 'sign-out', 'signout'];

/** Auth behaviors execute in this order: create account → log out → log back in */
export const AUTH_ORDER = ['sign-up', 'sign-out', 'sign-in'] as const;

export function isAuthBehavior(behaviorId: string): boolean {
  const lower = behaviorId.toLowerCase();
  return AUTH_PATTERNS.some(p => lower === p);
}

/** Default timeout per behavior (2 minutes) */
export const DEFAULT_BEHAVIOR_TIMEOUT_MS = 120_000;

export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutError)), ms)),
  ]);
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

/**
 * Run auth behaviors in sequence: Sign Up → Sign Out → Sign In.
 *
 * Only Sign Up clears browser state. All subsequent auth behaviors preserve
 * the session. If Sign Up fails, everything downstream is skipped.
 *
 * Each behavior's scenarios run sequentially via `runAuthBehaviorScenarios`.
 */
export async function runAuthBehaviorsSequence(
  allBehaviors: Map<string, HarborBehavior>,
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: BehaviorRunner,
  behaviorTimeoutMs: number
): Promise<BehaviorContext[]> {
  const authBehaviors = AUTH_ORDER
    .map(id => allBehaviors.get(id))
    .filter((b): b is HarborBehavior => b !== undefined);

  if (authBehaviors.length === 0) return [];

  console.log(`\n=== Auth Flow: ${authBehaviors.map(b => b.title).join(' → ')} ===\n`);

  const results: BehaviorContext[] = [];

  for (let i = 0; i < authBehaviors.length; i++) {
    const behavior = authBehaviors[i];
    const isFirst = i === 0;

    const result = await runSingleAuthBehavior(
      behavior, isFirst, context, credentialTracker, runner, behaviorTimeoutMs,
    );

    context.markResult(behavior.id, result);
    results.push(result);
  }

  return results;
}

// ============================================================================
// PER-BEHAVIOR EXECUTION
// ============================================================================

/** Decide whether to skip, fail-fast, or run a single auth behavior. */
async function runSingleAuthBehavior(
  behavior: HarborBehavior,
  isFirst: boolean,
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: BehaviorRunner,
  behaviorTimeoutMs: number,
): Promise<BehaviorContext> {
  if (!isFirst) {
    const signUpResult = context.getResult('sign-up');
    if (signUpResult && signUpResult.status !== 'pass') return skipResult(behavior);
  }

  if (behavior.examples.length === 0) return noExamplesResult(behavior);

  const startTime = Date.now();
  try {
    return await runAuthBehaviorScenarios(behavior, isFirst, runner, credentialTracker, behaviorTimeoutMs);
  } catch (error) {
    return errorResult(behavior, error, startTime);
  }
}

/**
 * Run all scenarios for a single auth behavior, returning the aggregated result.
 *
 * - Sign Up (isFirst=true, j=0): clears browser state
 * - Sign In j>0: reloads page between scenarios for clean form state
 * - Credentials are captured after Sign Up's first scenario
 */
async function runAuthBehaviorScenarios(
  behavior: HarborBehavior,
  isFirst: boolean,
  runner: BehaviorRunner,
  credentialTracker: CredentialTracker,
  behaviorTimeoutMs: number,
): Promise<BehaviorContext> {
  let firstError: string | undefined;
  let totalDuration = 0;
  let failed = false;

  for (let j = 0; j < behavior.examples.length; j++) {
    const example = behavior.examples[j];
    const processedSteps = processStepsWithCredentials(behavior, example.steps, credentialTracker, example.name);

    const clearSession = isFirst && j === 0;
    const reloadPage = behavior.id === 'sign-in' && j > 0;
    const creds = credentialTracker.getCredentials();

    console.log(`Auth [${behavior.id}][${j}/${behavior.examples.length - 1}]: ${processedSteps.length} steps, clearSession=${clearSession}, reloadPage=${reloadPage}, email=${creds.email ?? '(none)'}`);

    const result: ExampleResult = await withTimeout(
      runner.runExample({ ...example, steps: processedSteps }, { clearSession, reloadPage }),
      behaviorTimeoutMs,
      `Behavior "${behavior.title}" timed out after ${behaviorTimeoutMs / 1000}s`,
    );

    captureCredentialsAfterSignUp(behavior, j, processedSteps, credentialTracker);

    totalDuration += result.duration;
    if (!result.success && !failed) {
      failed = true;
      firstError = result.failedAt?.context.error;
    }
  }

  return {
    behaviorId: behavior.id,
    behaviorName: behavior.title,
    status: failed ? 'fail' : 'pass',
    error: firstError,
    duration: totalDuration,
  };
}

// ============================================================================
// RESULT BUILDERS
// ============================================================================

function captureCredentialsAfterSignUp(
  behavior: HarborBehavior,
  scenarioIndex: number,
  steps: { type: string; instruction: string }[],
  credentialTracker: CredentialTracker,
): void {
  if (scenarioIndex !== 0) return;
  if (!behavior.id.includes('sign-up') && !behavior.id.includes('signup')) return;

  for (const step of steps) {
    if (step.type === 'Act') credentialTracker.captureFromStep(step.instruction);
  }
}

function skipResult(behavior: HarborBehavior): BehaviorContext {
  return {
    behaviorId: behavior.id,
    behaviorName: behavior.title,
    status: 'dependency_failed',
    failedDependency: 'Sign Up',
    duration: 0,
  };
}

function noExamplesResult(behavior: HarborBehavior): BehaviorContext {
  return {
    behaviorId: behavior.id,
    behaviorName: behavior.title,
    status: 'fail',
    error: `No examples found for behavior: ${behavior.title}`,
    duration: 0,
  };
}

function errorResult(behavior: HarborBehavior, error: unknown, startTime: number): BehaviorContext {
  const msg = error instanceof Error ? error.message : String(error);
  return {
    behaviorId: behavior.id,
    behaviorName: behavior.title,
    status: 'fail',
    error: msg.includes('timed out') ? msg : `Unexpected error: ${msg}`,
    duration: Date.now() - startTime,
  };
}
