// ============================================================================
// BEHAVIOR VERIFICATION — chain execution with dependency tracking
// ============================================================================

import type { HarborBehavior, BehaviorContext, ExampleResult, BehaviorRunner } from "./types";
import { VerificationContext } from "./verification-context";
import { CredentialTracker, processStepsWithCredentials } from "./credential-tracker";
import { buildDependencyChain } from "./dependency-chain";

/**
 * Verify a behavior along with its full dependency chain.
 *
 * Architecture (post-spec-update):
 * - Each behavior's steps start on its own page (no sign-in preamble)
 * - The chain is: Sign Up (creates account + logs in) → target behavior
 * - Only the first chain step (Sign Up) clears browser state
 * - Subsequent steps preserve localStorage/cookies via soft navigation
 * - Parameterized routes (e.g., /surveys/:id) resolve to parent path (/surveys)
 */
export async function verifyBehaviorWithDependencies(
  targetBehavior: HarborBehavior,
  allBehaviors: Map<string, HarborBehavior>,
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: BehaviorRunner
): Promise<BehaviorContext> {
  const startTime = Date.now();

  // Skip if any dependency already failed
  const skipCheck = context.shouldSkip(targetBehavior.dependencies.map(d => d.behaviorId));
  if (skipCheck.skip) {
    return {
      behaviorId: targetBehavior.id,
      behaviorName: targetBehavior.title,
      status: 'dependency_failed',
      failedDependency: skipCheck.reason,
      duration: 0,
    };
  }

  // Build full dependency chain (Sign Up → ... → target)
  const chain = buildDependencyChain(targetBehavior.id, allBehaviors);

  for (let chainIndex = 0; chainIndex < chain.length; chainIndex++) {
    const { behavior, scenarioName } = chain[chainIndex];
    const isFirstInChain = chainIndex === 0;

    // Pick scenario
    const example = scenarioName
      ? behavior.examples.find(e => e.name === scenarioName) ?? behavior.examples[0]
      : behavior.examples[0];

    if (!example) {
      return {
        behaviorId: targetBehavior.id,
        behaviorName: targetBehavior.title,
        status: 'fail',
        error: `No examples found for behavior: ${behavior.title}`,
        duration: Date.now() - startTime,
      };
    }

    // Process steps with credential handling
    const processedSteps = processStepsWithCredentials(behavior, example.steps, credentialTracker);

    const creds = credentialTracker.getCredentials();

    // Navigation strategy for dependency chains:
    // - First step (Sign Up): clears session, navigates to baseUrl via resetSession()
    // - All subsequent steps: navigate to their pagePath so they start on the right page.
    //   For parameterized routes (e.g., /surveys/:id), navigateToPagePath() resolves
    //   to the parent path (e.g., /surveys) — the behavior's steps handle instance selection.
    const skipNavigation = isFirstInChain || !behavior.pagePath;
    const navigateToPath = skipNavigation ? undefined : behavior.pagePath;

    console.log(`Chain [${chainIndex}/${chain.length - 1}] ${behavior.id}: ${processedSteps.length} steps, email=${creds.email ?? '(none)'}${navigateToPath ? `, navigateTo=${navigateToPath}` : ''}`);

    // Execute: only clear session for the first chain step.
    // For subsequent steps, navigate to the behavior's page path if available.
    const exampleToRun = { ...example, steps: processedSteps };
    let result: ExampleResult;
    try {
      result = await runner.runExample(exampleToRun, {
        clearSession: isFirstInChain,
        navigateToPath,
        credentials: credentialTracker.getCredentials(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (behavior.id !== targetBehavior.id) {
        return {
          behaviorId: targetBehavior.id,
          behaviorName: targetBehavior.title,
          status: 'dependency_failed',
          failedDependency: behavior.title,
          error: `Dependency "${behavior.title}" crashed: ${errorMessage}`,
          duration: Date.now() - startTime,
        };
      }
      return {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: 'fail',
        error: `Runner crash: ${errorMessage}`,
        duration: Date.now() - startTime,
      };
    }

    // Capture credentials after Sign Up (from processed steps to get uniquified email)
    if (behavior.id.includes('sign-up') || behavior.id.includes('signup')) {
      processedSteps
        .filter(s => s.type === 'act')
        .forEach(s => credentialTracker.captureFromStep(s.instruction));
    }

    // Handle failure
    if (!result.success) {
      if (behavior.id !== targetBehavior.id) {
        const depError = result.failedAt?.context.error;
        return {
          behaviorId: targetBehavior.id,
          behaviorName: targetBehavior.title,
          status: 'dependency_failed',
          failedDependency: behavior.title,
          error: depError
            ? `Dependency "${behavior.title}" failed: ${depError}`
            : `Dependency "${behavior.title}" failed`,
          duration: Date.now() - startTime,
        };
      }
      return {
        behaviorId: targetBehavior.id,
        behaviorName: targetBehavior.title,
        status: 'fail',
        error: result.failedAt?.context.error,
        duration: Date.now() - startTime,
      };
    }
  }

  return {
    behaviorId: targetBehavior.id,
    behaviorName: targetBehavior.title,
    status: 'pass',
    duration: Date.now() - startTime,
  };
}
