// ============================================================================
// AUTH BEHAVIOR IDENTIFICATION & FLOW
// ============================================================================

import type { HarborBehavior, BehaviorContext, BehaviorRunner } from "./types";
import { VerificationContext } from "./verification-context";
import { CredentialTracker, processStepsWithCredentials } from "./credential-tracker";

/** Known auth behavior ID patterns */
const AUTH_PATTERNS = ['sign-up', 'signup', 'sign-in', 'signin', 'sign-out', 'signout', 'invalid-sign-in'];

export function isAuthBehavior(behaviorId: string): boolean {
  const lower = behaviorId.toLowerCase();
  return AUTH_PATTERNS.some(p => lower === p || lower.includes(p));
}

/** Default timeout per behavior (2 minutes) */
export const DEFAULT_BEHAVIOR_TIMEOUT_MS = 120_000;

export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutError)), ms)),
  ]);
}

/**
 * Run auth behaviors in sequence: Sign Up → Sign Out → Invalid Sign In → Sign In
 *
 * This is a dedicated flow because auth behaviors have unique requirements:
 * - Sign Up creates the account and logs the user in
 * - Sign Out needs the user to already be logged in (no login preamble)
 * - Invalid Sign In needs the user to be logged out
 * - Sign In needs the user to be logged out with valid credentials available
 *
 * The key insight: after Sign Up, the user IS signed in. So Sign Out can
 * execute directly. After Sign Out, the user is signed out, so Invalid Sign In
 * and Sign In can execute directly.
 *
 * Session management:
 * - Only Sign Up clears browser state (fresh start)
 * - All subsequent auth behaviors preserve state (no page.goto, no clearing)
 */
export async function runAuthBehaviorsSequence(
  allBehaviors: Map<string, HarborBehavior>,
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: BehaviorRunner,
  behaviorTimeoutMs: number
): Promise<BehaviorContext[]> {
  const results: BehaviorContext[] = [];

  // Auth behaviors in execution order
  const authOrder = ['sign-up', 'sign-out', 'invalid-sign-in', 'sign-in'];

  const authBehaviors: HarborBehavior[] = [];
  for (const id of authOrder) {
    const behavior = allBehaviors.get(id);
    if (behavior) authBehaviors.push(behavior);
  }

  if (authBehaviors.length === 0) return results;

  console.log(`\n=== Auth Flow: ${authBehaviors.map(b => b.title).join(' → ')} ===\n`);

  for (let i = 0; i < authBehaviors.length; i++) {
    const behavior = authBehaviors[i];
    const isFirst = i === 0;
    const behaviorStart = Date.now();

    // If Sign Up failed, skip all subsequent auth behaviors
    if (!isFirst) {
      const signUpResult = context.getResult('sign-up');
      if (signUpResult && signUpResult.status !== 'pass') {
        const failResult: BehaviorContext = {
          behaviorId: behavior.id,
          behaviorName: behavior.title,
          status: 'dependency_failed',
          failedDependency: 'Sign Up',
          duration: 0,
        };
        context.markResult(behavior.id, failResult);
        results.push(failResult);
        continue;
      }
    }

    try {
      const example = behavior.examples[0];
      if (!example) {
        const failResult: BehaviorContext = {
          behaviorId: behavior.id,
          behaviorName: behavior.title,
          status: 'fail',
          error: `No examples found for behavior: ${behavior.title}`,
          duration: 0,
        };
        context.markResult(behavior.id, failResult);
        results.push(failResult);
        continue;
      }

      // Process steps with credentials
      const processedSteps = processStepsWithCredentials(behavior, example.steps, credentialTracker);

      const creds = credentialTracker.getCredentials();
      console.log(`Auth [${behavior.id}]: ${processedSteps.length} steps, clearSession=${isFirst}, email=${creds.email ?? '(none)'}`);

      const exampleToRun = { ...example, steps: processedSteps };

      // Reload page before Sign In if Invalid Sign In ran before it (cleans dirty form)
      const prevBehaviorId = i > 0 ? authBehaviors[i - 1].id : '';
      const needsReload = behavior.id === 'sign-in' && prevBehaviorId === 'invalid-sign-in';

      const exampleResult = await withTimeout(
        runner.runExample(exampleToRun, { clearSession: isFirst, reloadPage: needsReload }),
        behaviorTimeoutMs,
        `Behavior "${behavior.title}" timed out after ${behaviorTimeoutMs / 1000}s`
      );

      // Capture credentials after Sign Up
      if (behavior.id.includes('sign-up') || behavior.id.includes('signup')) {
        for (const step of processedSteps) {
          if (step.type === 'act') {
            credentialTracker.captureFromStep(step.instruction);
          }
        }
      }

      const result: BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: exampleResult.success ? 'pass' : 'fail',
        error: exampleResult.failedAt?.context.error,
        duration: exampleResult.duration,
      };

      context.markResult(behavior.id, result);
      results.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failResult: BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: 'fail',
        error: errorMessage.includes('timed out') ? errorMessage : `Unexpected error: ${errorMessage}`,
        duration: Date.now() - behaviorStart,
      };
      context.markResult(behavior.id, failResult);
      results.push(failResult);
    }
  }

  return results;
}
