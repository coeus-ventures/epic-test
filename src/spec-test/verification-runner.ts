import type { HarborBehavior, BehaviorContext, SpecExample, ExampleResult, BehaviorRunner } from "./types";
import { VerificationContext } from "./verification-context";
import { CredentialTracker, processStepsWithCredentials } from "./credential-tracker";
import { buildDependencyChain } from "./dependency-chain";

/**
 * Verify a behavior along with its full dependency chain.
 *
 * Chain: Sign Up (creates account + logs in) → ... → target behavior.
 * Only the first chain step clears browser state; subsequent steps preserve
 * localStorage/cookies via soft navigation.
 */
export async function verifyBehaviorWithDependencies(
  targetBehavior: HarborBehavior,
  allBehaviors: Map<string, HarborBehavior>,
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: BehaviorRunner
): Promise<BehaviorContext> {
  const skipCheck = context.shouldSkip(targetBehavior.dependencies.map(d => d.behaviorId));
  if (skipCheck.skip) return skipResult(targetBehavior, skipCheck.reason!);

  const chain = buildDependencyChain(targetBehavior.id, allBehaviors);
  const startTime = Date.now();

  let isFirstInChain = true;
  for (const { behavior, scenarioName } of chain) {
    const example = resolveExample(behavior, scenarioName);
    if (!example) return failResult(targetBehavior, `No examples found for behavior: ${behavior.title}`, startTime);

    const result = await runChainStep(behavior, example, isFirstInChain, credentialTracker, runner);
    isFirstInChain = false;

    if (result instanceof Error) return crashResult(targetBehavior, behavior, result.message, startTime);
    captureSignUpCredentials(behavior, example, credentialTracker);
    if (!result.success) return stepFailureResult(targetBehavior, behavior, result, startTime);
  }

  return passResult(targetBehavior, startTime);
}

function resolveExample(behavior: HarborBehavior, scenarioName?: string): SpecExample | undefined {
  if (!scenarioName) return behavior.examples[0];
  return behavior.examples.find(e => e.name === scenarioName) ?? behavior.examples[0];
}

async function runChainStep(
  behavior: HarborBehavior,
  example: SpecExample,
  isFirstInChain: boolean,
  credentialTracker: CredentialTracker,
  runner: BehaviorRunner,
): Promise<ExampleResult | Error> {
  const processedSteps = processStepsWithCredentials(behavior, example.steps, credentialTracker, example.name);
  const navigateToPath = (isFirstInChain || !behavior.pagePath) ? undefined : behavior.pagePath;
  const creds = credentialTracker.getCredentials();

  console.log(`Chain: ${behavior.id} — ${processedSteps.length} steps, email=${creds.email ?? '(none)'}${navigateToPath ? `, navigateTo=${navigateToPath}` : ''}`);

  try {
    return await runner.runExample({ ...example, steps: processedSteps }, {
      clearSession: isFirstInChain,
      navigateToPath,
      credentials: creds,
    });
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function captureSignUpCredentials(behavior: HarborBehavior, example: SpecExample, credentialTracker: CredentialTracker): void {
  const isSignUp = behavior.id.includes('sign-up') || behavior.id.includes('signup');
  if (!isSignUp) return;

  example.steps
    .filter(s => s.type === 'Act')
    .forEach(s => credentialTracker.captureFromStep(s.instruction));
}

function skipResult(target: HarborBehavior, reason: string): BehaviorContext {
  return { behaviorId: target.id, behaviorName: target.title, status: 'dependency_failed', failedDependency: reason, duration: 0 };
}

function passResult(target: HarborBehavior, startTime: number): BehaviorContext {
  return { behaviorId: target.id, behaviorName: target.title, status: 'pass', duration: Date.now() - startTime };
}

function failResult(target: HarborBehavior, error: string | undefined, startTime: number): BehaviorContext {
  return { behaviorId: target.id, behaviorName: target.title, status: 'fail', error, duration: Date.now() - startTime };
}

function crashResult(target: HarborBehavior, dep: HarborBehavior, message: string, startTime: number): BehaviorContext {
  if (dep.id === target.id) return failResult(target, `Runner crash: ${message}`, startTime);
  return depFailResult(target, dep.title, `Dependency "${dep.title}" crashed: ${message}`, startTime);
}

function stepFailureResult(target: HarborBehavior, dep: HarborBehavior, result: ExampleResult, startTime: number): BehaviorContext {
  if (dep.id === target.id) return failResult(target, result.failedAt?.context.error, startTime);
  const depError = result.failedAt?.context.error;
  const message = depError ? `Dependency "${dep.title}" failed: ${depError}` : `Dependency "${dep.title}" failed`;
  return depFailResult(target, dep.title, message, startTime);
}

function depFailResult(target: HarborBehavior, depTitle: string, error: string, startTime: number): BehaviorContext {
  return { behaviorId: target.id, behaviorName: target.title, status: 'dependency_failed', failedDependency: depTitle, error, duration: Date.now() - startTime };
}
