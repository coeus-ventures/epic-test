// ============================================================================
// DEPENDENCY CHAIN BUILDING
// ============================================================================

import type { HarborBehavior, ChainStep } from "./types";

/**
 * Build the complete dependency chain for a behavior.
 * Returns chain steps in execution order (dependencies first, target last).
 */
export function buildDependencyChain(
  targetBehaviorId: string,
  allBehaviors: Map<string, HarborBehavior>
): ChainStep[] {
  const targetBehavior = allBehaviors.get(targetBehaviorId);
  if (!targetBehavior) {
    throw new Error(`Behavior "${targetBehaviorId}" not found`);
  }

  const chain: ChainStep[] = [];
  const visited = new Set<string>();

  function buildChainRecursive(behaviorId: string, scenarioName?: string): void {
    if (visited.has(behaviorId)) return;
    visited.add(behaviorId);

    const behavior = allBehaviors.get(behaviorId);
    if (!behavior) {
      throw new Error(`Dependency "${behaviorId}" not found for behavior chain`);
    }

    for (const dep of behavior.dependencies) {
      buildChainRecursive(dep.behaviorId, dep.scenarioName);
    }

    chain.push({ behavior, scenarioName });
  }

  buildChainRecursive(targetBehaviorId);
  return chain;
}
