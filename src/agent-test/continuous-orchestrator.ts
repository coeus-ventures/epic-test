import { readFile } from "fs/promises";
import type {
  HarborBehavior,
  BehaviorContext,
  BehaviorRunner,
  VerificationSummary,
  ExampleResult,
} from "../shared/types";
import { parseHarborBehaviorsWithDependencies } from "../shared/index";
import { VerificationContext } from "../shared/verification-context";
import {
  CredentialTracker,
  processStepsWithCredentials,
} from "../shared/credential-tracker";
import { createVerificationSummary } from "../shared/summary";
import {
  isAuthBehavior,
  withTimeout,
  DEFAULT_BEHAVIOR_TIMEOUT_MS,
} from "../shared/auth-orchestrator";

// ── MAIN ORCHESTRATOR ──────────────────────────────────────────────────

/**
 * Verify all behaviors in a continuous single-session flow.
 *
 * Parses → topologically sorts → auth first → non-auth in order → cascade skips.
 * Exactly N runExample() calls for N behaviors (no re-execution).
 */
export async function verifyAllBehaviorsContinuous(
  instructionPath: string,
  runner: BehaviorRunner,
  behaviorTimeoutMs: number = DEFAULT_BEHAVIOR_TIMEOUT_MS
): Promise<VerificationSummary> {
  const startTime = Date.now();

  const content = await readFile(instructionPath, "utf-8");
  const allBehaviors = parseHarborBehaviorsWithDependencies(content);

  const sorted = topologicalSort(allBehaviors);
  const { auth, nonAuth } = partitionBehaviors(sorted);

  const context = new VerificationContext();
  const credentialTracker = new CredentialTracker();
  const transitiveMap = buildTransitiveDependentsMap(allBehaviors);
  const skipSet = new Set<string>();

  console.log(`\nTopological order: ${sorted.map((b) => b.id).join(" → ")}`);
  console.log(`Auth behaviors: ${auth.map((b) => b.id).join(", ") || "(none)"}`);
  console.log(`Non-auth behaviors: ${nonAuth.map((b) => b.id).join(", ") || "(none)"}\n`);

  const authResults = await runAuthFlow(
    auth, context, credentialTracker, runner, transitiveMap, skipSet, behaviorTimeoutMs,
  );

  const nonAuthResults = await runNonAuthBehaviors(
    nonAuth, context, credentialTracker, runner, transitiveMap, skipSet, behaviorTimeoutMs,
  );

  return createVerificationSummary([...authResults, ...nonAuthResults], Date.now() - startTime);
}

// ── EXECUTION FLOWS ────────────────────────────────────────────────────

async function runAuthFlow(
  authBehaviors: HarborBehavior[],
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: BehaviorRunner,
  transitiveMap: Map<string, Set<string>>,
  skipSet: Set<string>,
  behaviorTimeoutMs: number,
): Promise<BehaviorContext[]> {
  if (authBehaviors.length === 0) return [];

  console.log(`\n=== Auth Flow (continuous): ${authBehaviors.map((b) => b.title).join(" → ")} ===\n`);

  const results: BehaviorContext[] = [];

  for (let i = 0; i < authBehaviors.length; i++) {
    const behavior = authBehaviors[i];
    const result = await runBehaviorWithCascade(
      behavior, context, transitiveMap, skipSet,
      () => runAuthBehaviorScenarios(behavior, i === 0, runner, credentialTracker, behaviorTimeoutMs),
    );
    results.push(result);
  }

  return results;
}

async function runNonAuthBehaviors(
  nonAuthBehaviors: HarborBehavior[],
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: BehaviorRunner,
  transitiveMap: Map<string, Set<string>>,
  skipSet: Set<string>,
  behaviorTimeoutMs: number,
): Promise<BehaviorContext[]> {
  console.log(`\n=== Non-Auth Behaviors (continuous): ${nonAuthBehaviors.length} behaviors ===\n`);

  const results: BehaviorContext[] = [];

  for (const behavior of nonAuthBehaviors) {
    // Non-auth behaviors also check dependency context (handles edge cases beyond skipSet)
    const depIds = behavior.dependencies.map((d) => d.behaviorId);
    const depCheck = context.shouldSkip(depIds);
    if (depCheck.skip) {
      const result = skipResult(behavior, depCheck.reason ?? "unknown");
      context.markResult(behavior.id, result);
      results.push(result);
      cascadeSkip(behavior.id, transitiveMap, skipSet);
      continue;
    }

    const result = await runBehaviorWithCascade(
      behavior, context, transitiveMap, skipSet,
      () => runNonAuthBehavior(behavior, runner, credentialTracker, behaviorTimeoutMs),
    );
    results.push(result);
  }

  return results;
}

// ── PER-BEHAVIOR EXECUTION ─────────────────────────────────────────────

/**
 * Shared wrapper: check skip → check examples → run → mark result → cascade on failure.
 * The actual execution logic is passed as `runFn`.
 */
async function runBehaviorWithCascade(
  behavior: HarborBehavior,
  context: VerificationContext,
  transitiveMap: Map<string, Set<string>>,
  skipSet: Set<string>,
  runFn: () => Promise<BehaviorContext>,
): Promise<BehaviorContext> {
  if (skipSet.has(behavior.id)) {
    const result = skipResult(behavior, findFailedDependency(behavior, context));
    context.markResult(behavior.id, result);
    return result;
  }

  if (behavior.examples.length === 0) {
    const result = noExamplesResult(behavior);
    context.markResult(behavior.id, result);
    cascadeSkip(behavior.id, transitiveMap, skipSet);
    return result;
  }

  const startTime = Date.now();
  try {
    const result = await runFn();
    context.markResult(behavior.id, result);
    if (result.status === "fail") cascadeSkip(behavior.id, transitiveMap, skipSet);
    return result;
  } catch (error) {
    const result = errorResult(behavior, error, startTime);
    context.markResult(behavior.id, result);
    cascadeSkip(behavior.id, transitiveMap, skipSet);
    return result;
  }
}

/** Run all scenarios for an auth behavior (Sign Up clears session, Sign In reloads between scenarios). */
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
    const reloadPage = behavior.id === "sign-in" && j > 0;
    const creds = credentialTracker.getCredentials();

    console.log(
      `Auth [${behavior.id}] example ${j}: ${processedSteps.length} steps, clearSession=${clearSession}, reloadPage=${reloadPage}, email=${creds.email ?? "(none)"}`,
    );

    const result: ExampleResult = await withTimeout(
      runner.runExample({ ...example, steps: processedSteps }, { clearSession, reloadPage }),
      behaviorTimeoutMs,
      `Behavior "${behavior.title}" timed out after ${behaviorTimeoutMs / 1000}s`,
    );

    // Capture credentials after Sign Up for subsequent auth steps
    if (behavior.id.includes("sign-up") || behavior.id.includes("signup")) {
      for (const step of processedSteps) {
        if (step.type === "Act") credentialTracker.captureFromStep(step.instruction);
      }
    }

    totalDuration += result.duration;
    if (!result.success && !failed) {
      failed = true;
      firstError = result.failedAt?.context.error;
    }
  }

  return {
    behaviorId: behavior.id,
    behaviorName: behavior.title,
    status: failed ? "fail" : "pass",
    error: firstError,
    duration: totalDuration,
  };
}

/** Run a single non-auth behavior (preserves session, navigates to page path). */
async function runNonAuthBehavior(
  behavior: HarborBehavior,
  runner: BehaviorRunner,
  credentialTracker: CredentialTracker,
  behaviorTimeoutMs: number,
): Promise<BehaviorContext> {
  const example = behavior.examples[0];
  const processedSteps = processStepsWithCredentials(behavior, example.steps, credentialTracker, example.name);
  const creds = credentialTracker.getCredentials();

  console.log(
    `NonAuth [${behavior.id}]: ${processedSteps.length} steps, pagePath=${behavior.pagePath ?? "(none)"}, email=${creds.email ?? "(none)"}`,
  );

  const result = await withTimeout(
    runner.runExample(
      { ...example, steps: processedSteps },
      { clearSession: false, navigateToPath: behavior.pagePath, credentials: creds },
    ),
    behaviorTimeoutMs,
    `Behavior "${behavior.title}" timed out after ${behaviorTimeoutMs / 1000}s`,
  );

  return {
    behaviorId: behavior.id,
    behaviorName: behavior.title,
    status: result.success ? "pass" : "fail",
    error: result.failedAt?.context.error,
    duration: result.duration,
  };
}

// ── RESULT BUILDERS ────────────────────────────────────────────────────

function skipResult(behavior: HarborBehavior, failedDep: string): BehaviorContext {
  return {
    behaviorId: behavior.id,
    behaviorName: behavior.title,
    status: "dependency_failed",
    failedDependency: failedDep,
    duration: 0,
  };
}

function noExamplesResult(behavior: HarborBehavior): BehaviorContext {
  return {
    behaviorId: behavior.id,
    behaviorName: behavior.title,
    status: "fail",
    error: `No examples found for behavior: ${behavior.title}`,
    duration: 0,
  };
}

function errorResult(behavior: HarborBehavior, error: unknown, startTime: number): BehaviorContext {
  const msg = error instanceof Error ? error.message : String(error);
  return {
    behaviorId: behavior.id,
    behaviorName: behavior.title,
    status: "fail",
    error: msg.includes("timed out") ? msg : `Unexpected error: ${msg}`,
    duration: Date.now() - startTime,
  };
}

function findFailedDependency(behavior: HarborBehavior, context: VerificationContext): string {
  for (const dep of behavior.dependencies) {
    const result = context.getResult(dep.behaviorId);
    if (result && result.status !== "pass") return result.behaviorName;
  }
  return "unknown";
}

function cascadeSkip(
  failedId: string,
  transitiveMap: Map<string, Set<string>>,
  skipSet: Set<string>,
): void {
  for (const dependentId of transitiveMap.get(failedId) ?? []) {
    skipSet.add(dependentId);
  }
}

// ── PURE UTILITIES (exported) ──────────────────────────────────────────

/** Topologically sort behaviors using Kahn's algorithm. Throws on cycles. */
export function topologicalSort(
  behaviors: Map<string, HarborBehavior>
): HarborBehavior[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const [id, behavior] of behaviors) {
    inDegree.set(id, behavior.dependencies.length);
    for (const dep of behavior.dependencies) {
      const list = dependents.get(dep.behaviorId) ?? [];
      list.push(id);
      dependents.set(dep.behaviorId, list);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: HarborBehavior[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const behavior = behaviors.get(currentId);
    if (!behavior) continue;

    sorted.push(behavior);

    for (const dependentId of dependents.get(currentId) ?? []) {
      const newDegree = (inDegree.get(dependentId) ?? 1) - 1;
      inDegree.set(dependentId, newDegree);
      if (newDegree === 0) queue.push(dependentId);
    }
  }

  if (sorted.length !== behaviors.size) {
    const remaining = [...behaviors.keys()].filter(
      (id) => !sorted.some((b) => b.id === id),
    );
    throw new Error(
      `Cycle detected in behavior dependencies. Stuck behaviors: ${remaining.join(", ")}`,
    );
  }

  return sorted;
}

const AUTH_ORDER = ["sign-up", "sign-out", "sign-in"];

/** Split behaviors into auth (hardcoded order) and non-auth (preserve topological order). */
export function partitionBehaviors(sorted: HarborBehavior[]): {
  auth: HarborBehavior[];
  nonAuth: HarborBehavior[];
} {
  const authMap = new Map<string, HarborBehavior>();
  const nonAuth: HarborBehavior[] = [];

  for (const behavior of sorted) {
    if (isAuthBehavior(behavior.id)) {
      authMap.set(behavior.id, behavior);
    } else {
      nonAuth.push(behavior);
    }
  }

  const auth = AUTH_ORDER
    .map((id) => authMap.get(id))
    .filter((b): b is HarborBehavior => b !== undefined);

  return { auth, nonAuth };
}

/** Build a map from each behavior ID to all behaviors that transitively depend on it. */
export function buildTransitiveDependentsMap(
  behaviors: Map<string, HarborBehavior>
): Map<string, Set<string>> {
  const directDependents = new Map<string, Set<string>>();
  for (const [id, behavior] of behaviors) {
    for (const dep of behavior.dependencies) {
      const set = directDependents.get(dep.behaviorId) ?? new Set();
      set.add(id);
      directDependents.set(dep.behaviorId, set);
    }
  }

  // Iterate in reverse topological order so each node's dependents are already computed
  const sorted = topologicalSort(behaviors);
  const transitiveMap = new Map<string, Set<string>>();

  for (const behavior of sorted.reverse()) {
    const allDeps = new Set(
      [...(directDependents.get(behavior.id) ?? [])]
        .flatMap(dep => [dep, ...(transitiveMap.get(dep) ?? [])])
    );
    transitiveMap.set(behavior.id, allDeps);
  }

  return transitiveMap;
}
