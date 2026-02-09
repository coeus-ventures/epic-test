// ============================================================================
// TOP-LEVEL VERIFICATION ORCHESTRATOR
// ============================================================================

import { readFile } from "fs/promises";
import type { BehaviorContext, BehaviorRunner, VerificationSummary } from "./types";
import { parseHarborBehaviorsWithDependencies } from "./parsing";
import { VerificationContext } from "./verification-context";
import { CredentialTracker } from "./credential-tracker";
import { createVerificationSummary } from "./summary";
import { verifyBehaviorWithDependencies } from "./verification-runner";
import { isAuthBehavior, runAuthBehaviorsSequence, withTimeout, DEFAULT_BEHAVIOR_TIMEOUT_MS } from "./auth-orchestrator";

/**
 * Verify all behaviors from an instruction.md file.
 *
 * Execution strategy:
 * 1. Auth behaviors run first in a dedicated sequence (shared session)
 * 2. Non-auth behaviors run independently, each with its own fresh chain
 *    (Sign Up → target behavior, fresh browser state per chain)
 */
export async function verifyAllBehaviors(
  instructionPath: string,
  runner: BehaviorRunner,
  behaviorTimeoutMs: number = DEFAULT_BEHAVIOR_TIMEOUT_MS
): Promise<VerificationSummary> {
  const startTime = Date.now();

  const content = await readFile(instructionPath, 'utf-8');
  const allBehaviors = parseHarborBehaviorsWithDependencies(content);

  const context = new VerificationContext();
  const credentialTracker = new CredentialTracker();

  // 1. Auth behaviors in dedicated sequence
  const authResults = await runAuthBehaviorsSequence(
    allBehaviors, context, credentialTracker, runner, behaviorTimeoutMs
  );

  // 2. Non-auth behaviors with independent chains
  const nonAuthResults: BehaviorContext[] = [];
  for (const behavior of allBehaviors.values()) {
    if (isAuthBehavior(behavior.id)) continue;

    // Fresh credentials for each chain
    credentialTracker.reset();

    const behaviorStart = Date.now();
    try {
      const result = await withTimeout(
        verifyBehaviorWithDependencies(behavior, allBehaviors, context, credentialTracker, runner),
        behaviorTimeoutMs,
        `Behavior "${behavior.title}" timed out after ${behaviorTimeoutMs / 1000}s`
      );
      context.markResult(behavior.id, result);
      nonAuthResults.push(result);
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
      nonAuthResults.push(failResult);
    }
  }

  const results = [...authResults, ...nonAuthResults];
  return createVerificationSummary(results, Date.now() - startTime);
}
