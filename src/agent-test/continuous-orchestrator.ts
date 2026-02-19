// ============================================================================
// CONTINUOUS FLOW ORCHESTRATOR — topological sort + single-session execution
// ============================================================================

import { readFile } from "fs/promises";
import type {
  HarborBehavior,
  BehaviorContext,
  BehaviorRunner,
  VerificationSummary,
} from "../spec-test/types";
import { parseHarborBehaviorsWithDependencies } from "../spec-test/parsing";
import { VerificationContext } from "../spec-test/verification-context";
import {
  CredentialTracker,
  processStepsWithCredentials,
} from "../spec-test/credential-tracker";
import { createVerificationSummary } from "../spec-test/summary";
import {
  isAuthBehavior,
  withTimeout,
  DEFAULT_BEHAVIOR_TIMEOUT_MS,
} from "../spec-test/auth-orchestrator";

// ============================================================================
// TOPOLOGICAL SORT — Kahn's algorithm (BFS)
// ============================================================================

/**
 * Topologically sort behaviors using Kahn's algorithm.
 *
 * Returns behaviors in an order where every behavior appears after all its
 * dependencies. Uses BFS with in-degree tracking — behaviors with zero
 * in-degree (no unsatisfied dependencies) are processed first.
 *
 * Throws if the dependency graph contains a cycle.
 */
export function topologicalSort(
  behaviors: Map<string, HarborBehavior>
): HarborBehavior[] {
  // In-degree: how many dependencies each behavior has
  const inDegree = new Map<string, number>();
  // Reverse adjacency: dependency → list of behaviors that depend on it
  const dependents = new Map<string, string[]>();

  for (const [id, behavior] of behaviors) {
    inDegree.set(id, behavior.dependencies.length);

    for (const dep of behavior.dependencies) {
      const list = dependents.get(dep.behaviorId) ?? [];
      list.push(id);
      dependents.set(dep.behaviorId, list);
    }
  }

  // Seed the queue with zero in-degree nodes (roots)
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

    // Decrement in-degree for all dependents
    for (const dependentId of dependents.get(currentId) ?? []) {
      const newDegree = (inDegree.get(dependentId) ?? 1) - 1;
      inDegree.set(dependentId, newDegree);
      if (newDegree === 0) queue.push(dependentId);
    }
  }

  if (sorted.length !== behaviors.size) {
    const remaining = [...behaviors.keys()].filter(
      (id) => !sorted.some((b) => b.id === id)
    );
    throw new Error(
      `Cycle detected in behavior dependencies. Stuck behaviors: ${remaining.join(", ")}`
    );
  }

  return sorted;
}

// ============================================================================
// PARTITION — separate auth from non-auth behaviors
// ============================================================================

/**
 * Split sorted behaviors into auth and non-auth groups.
 * Auth behaviors are returned in the hardcoded execution order.
 * Non-auth behaviors preserve their topological order.
 */
export function partitionBehaviors(sorted: HarborBehavior[]): {
  auth: HarborBehavior[];
  nonAuth: HarborBehavior[];
} {
  const AUTH_ORDER = [
    "sign-up",
    "sign-out",
    "invalid-sign-in",
    "sign-in",
  ];

  const authMap = new Map<string, HarborBehavior>();
  const nonAuth: HarborBehavior[] = [];

  for (const behavior of sorted) {
    if (isAuthBehavior(behavior.id)) {
      authMap.set(behavior.id, behavior);
    } else {
      nonAuth.push(behavior);
    }
  }

  // Auth behaviors in the hardcoded order
  const auth: HarborBehavior[] = [];
  for (const id of AUTH_ORDER) {
    const behavior = authMap.get(id);
    if (behavior) auth.push(behavior);
  }

  return { auth, nonAuth };
}

// ============================================================================
// SKIP CASCADE — transitive dependents map
// ============================================================================

/**
 * Build a map from each behavior ID to the set of all behaviors that
 * transitively depend on it. Used for skip cascading when a behavior fails.
 */
export function buildTransitiveDependentsMap(
  behaviors: Map<string, HarborBehavior>
): Map<string, Set<string>> {
  // Direct dependents: behavior → who directly depends on it
  const directDependents = new Map<string, Set<string>>();
  for (const [id, behavior] of behaviors) {
    for (const dep of behavior.dependencies) {
      const set = directDependents.get(dep.behaviorId) ?? new Set();
      set.add(id);
      directDependents.set(dep.behaviorId, set);
    }
  }

  // Expand to transitive dependents via BFS
  const transitiveMap = new Map<string, Set<string>>();

  for (const id of behaviors.keys()) {
    const visited = new Set<string>();
    const queue = [...(directDependents.get(id) ?? [])];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const next of directDependents.get(current) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    }

    transitiveMap.set(id, visited);
  }

  return transitiveMap;
}

/**
 * Add all transitive dependents of a failed behavior to the skip set.
 */
function cascadeSkip(
  failedId: string,
  transitiveMap: Map<string, Set<string>>,
  skipSet: Set<string>
): void {
  for (const dependentId of transitiveMap.get(failedId) ?? []) {
    skipSet.add(dependentId);
  }
}

// ============================================================================
// AUTH FLOW — continuous
// ============================================================================

async function runAuthFlowContinuous(
  authBehaviors: HarborBehavior[],
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: BehaviorRunner,
  transitiveMap: Map<string, Set<string>>,
  skipSet: Set<string>,
  behaviorTimeoutMs: number
): Promise<BehaviorContext[]> {
  const results: BehaviorContext[] = [];

  if (authBehaviors.length === 0) return results;

  console.log(
    `\n=== Auth Flow (continuous): ${authBehaviors.map((b) => b.title).join(" → ")} ===\n`
  );

  for (let i = 0; i < authBehaviors.length; i++) {
    const behavior = authBehaviors[i];
    const isFirst = i === 0;
    const behaviorStart = Date.now();

    // Check skip set (Sign Up failure cascades to all auth)
    if (skipSet.has(behavior.id)) {
      const failedDep = findFailedDependency(behavior, context);
      const result: BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: "dependency_failed",
        failedDependency: failedDep,
        duration: 0,
      };
      context.markResult(behavior.id, result);
      results.push(result);
      continue;
    }

    try {
      const example = behavior.examples[0];
      if (!example) {
        const result: BehaviorContext = {
          behaviorId: behavior.id,
          behaviorName: behavior.title,
          status: "fail",
          error: `No examples found for behavior: ${behavior.title}`,
          duration: 0,
        };
        context.markResult(behavior.id, result);
        results.push(result);
        cascadeSkip(behavior.id, transitiveMap, skipSet);
        continue;
      }

      const processedSteps = processStepsWithCredentials(
        behavior,
        example.steps,
        credentialTracker
      );

      const creds = credentialTracker.getCredentials();
      console.log(
        `Auth [${behavior.id}]: ${processedSteps.length} steps, clearSession=${isFirst}, email=${creds.email ?? "(none)"}`
      );

      const exampleToRun = { ...example, steps: processedSteps };
      const needsReload = behavior.id === "sign-in";

      const exampleResult = await withTimeout(
        runner.runExample(exampleToRun, {
          clearSession: isFirst,
          reloadPage: needsReload,
        }),
        behaviorTimeoutMs,
        `Behavior "${behavior.title}" timed out after ${behaviorTimeoutMs / 1000}s`
      );

      // Capture credentials after Sign Up
      if (
        behavior.id.includes("sign-up") ||
        behavior.id.includes("signup")
      ) {
        for (const step of processedSteps) {
          if (step.type === "act") {
            credentialTracker.captureFromStep(step.instruction);
          }
        }
      }

      const result: BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: exampleResult.success ? "pass" : "fail",
        error: exampleResult.failedAt?.context.error,
        duration: exampleResult.duration,
      };

      context.markResult(behavior.id, result);
      results.push(result);

      if (result.status === "fail") {
        cascadeSkip(behavior.id, transitiveMap, skipSet);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const result: BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: "fail",
        error: errorMessage.includes("timed out")
          ? errorMessage
          : `Unexpected error: ${errorMessage}`,
        duration: Date.now() - behaviorStart,
      };
      context.markResult(behavior.id, result);
      results.push(result);
      cascadeSkip(behavior.id, transitiveMap, skipSet);
    }
  }

  return results;
}

// ============================================================================
// NON-AUTH FLOW — continuous (single session, topological order)
// ============================================================================

async function runNonAuthBehaviorsContinuous(
  nonAuthBehaviors: HarborBehavior[],
  context: VerificationContext,
  credentialTracker: CredentialTracker,
  runner: BehaviorRunner,
  transitiveMap: Map<string, Set<string>>,
  skipSet: Set<string>,
  behaviorTimeoutMs: number
): Promise<BehaviorContext[]> {
  const results: BehaviorContext[] = [];

  console.log(
    `\n=== Non-Auth Behaviors (continuous): ${nonAuthBehaviors.length} behaviors ===\n`
  );

  for (const behavior of nonAuthBehaviors) {
    const behaviorStart = Date.now();

    // Check skip set first
    if (skipSet.has(behavior.id)) {
      const failedDep = findFailedDependency(behavior, context);
      const result: BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: "dependency_failed",
        failedDependency: failedDep,
        duration: 0,
      };
      context.markResult(behavior.id, result);
      results.push(result);
      continue;
    }

    // Double-check via context (handles edge cases)
    const depIds = behavior.dependencies.map((d) => d.behaviorId);
    const skipCheck = context.shouldSkip(depIds);
    if (skipCheck.skip) {
      const result: BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: "dependency_failed",
        failedDependency: skipCheck.reason,
        duration: 0,
      };
      context.markResult(behavior.id, result);
      results.push(result);
      cascadeSkip(behavior.id, transitiveMap, skipSet);
      continue;
    }

    try {
      const example = behavior.examples[0];
      if (!example) {
        const result: BehaviorContext = {
          behaviorId: behavior.id,
          behaviorName: behavior.title,
          status: "fail",
          error: `No examples found for behavior: ${behavior.title}`,
          duration: 0,
        };
        context.markResult(behavior.id, result);
        results.push(result);
        cascadeSkip(behavior.id, transitiveMap, skipSet);
        continue;
      }

      const processedSteps = processStepsWithCredentials(
        behavior,
        example.steps,
        credentialTracker
      );

      const creds = credentialTracker.getCredentials();
      console.log(
        `NonAuth [${behavior.id}]: ${processedSteps.length} steps, pagePath=${behavior.pagePath ?? "(none)"}, email=${creds.email ?? "(none)"}`
      );

      const exampleToRun = { ...example, steps: processedSteps };

      // Never clear session for non-auth behaviors — carry forward from auth flow
      const exampleResult = await withTimeout(
        runner.runExample(exampleToRun, {
          clearSession: false,
          navigateToPath: behavior.pagePath,
          credentials: creds,
        }),
        behaviorTimeoutMs,
        `Behavior "${behavior.title}" timed out after ${behaviorTimeoutMs / 1000}s`
      );

      const result: BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: exampleResult.success ? "pass" : "fail",
        error: exampleResult.failedAt?.context.error,
        duration: exampleResult.duration,
      };

      context.markResult(behavior.id, result);
      results.push(result);

      if (result.status === "fail") {
        cascadeSkip(behavior.id, transitiveMap, skipSet);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const result: BehaviorContext = {
        behaviorId: behavior.id,
        behaviorName: behavior.title,
        status: "fail",
        error: errorMessage.includes("timed out")
          ? errorMessage
          : `Unexpected error: ${errorMessage}`,
        duration: Date.now() - behaviorStart,
      };
      context.markResult(behavior.id, result);
      results.push(result);
      cascadeSkip(behavior.id, transitiveMap, skipSet);
    }
  }

  return results;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Find the name of the first failed dependency for display purposes. */
function findFailedDependency(
  behavior: HarborBehavior,
  context: VerificationContext
): string {
  for (const dep of behavior.dependencies) {
    const result = context.getResult(dep.behaviorId);
    if (result && result.status !== "pass") {
      return result.behaviorName;
    }
  }
  return "unknown";
}

// ============================================================================
// MAIN ORCHESTRATOR — continuous flow
// ============================================================================

/**
 * Verify all behaviors in a continuous single-session flow.
 *
 * Instead of re-running dependency chains per behavior, this:
 * 1. Parses the spec and topologically sorts all behaviors
 * 2. Separates auth from non-auth behaviors
 * 3. Runs auth flow first (Sign Up → Sign Out → Invalid Sign In → Sign In)
 * 4. Runs non-auth behaviors in topological order on the same session
 * 5. Cascades skips when a behavior fails (all transitive dependents are skipped)
 *
 * This results in exactly N runExample() calls for N behaviors (no re-execution).
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

  // Phase 1: Auth flow
  const authResults = await runAuthFlowContinuous(
    auth,
    context,
    credentialTracker,
    runner,
    transitiveMap,
    skipSet,
    behaviorTimeoutMs
  );

  // Phase 2: Non-auth flow (same session)
  const nonAuthResults = await runNonAuthBehaviorsContinuous(
    nonAuth,
    context,
    credentialTracker,
    runner,
    transitiveMap,
    skipSet,
    behaviorTimeoutMs
  );

  const results = [...authResults, ...nonAuthResults];
  return createVerificationSummary(results, Date.now() - startTime);
}
