import type { HarborBehavior } from "./types";

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

  const queue = [...inDegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);

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
