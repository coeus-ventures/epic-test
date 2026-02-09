// ============================================================================
// VERIFICATION CONTEXT — tracks behavior results for dependency awareness
// ============================================================================

import type { BehaviorContext } from "./types";

export class VerificationContext {
  private results: Map<string, BehaviorContext>;

  constructor() {
    this.results = new Map();
  }

  markResult(behaviorId: string, result: BehaviorContext): void {
    this.results.set(behaviorId, result);
  }

  getResult(behaviorId: string): BehaviorContext | undefined {
    return this.results.get(behaviorId);
  }

  shouldSkip(dependencies: string[]): { skip: boolean; reason?: string } {
    for (const depId of dependencies) {
      const depResult = this.results.get(depId);
      if (!depResult) continue;
      if (depResult.status !== 'pass') {
        return { skip: true, reason: `Dependency "${depResult.behaviorName}" failed` };
      }
    }
    return { skip: false };
  }

  hasPassed(behaviorId: string): boolean {
    return this.results.get(behaviorId)?.status === 'pass';
  }

  getAllResults(): Map<string, BehaviorContext> {
    return new Map(this.results);
  }

  clear(): void {
    this.results.clear();
  }

  getStatusCounts(): { pass: number; fail: number; dependency_failed: number } {
    const counts = { pass: 0, fail: 0, dependency_failed: 0 };
    for (const result of this.results.values()) {
      counts[result.status]++;
    }
    return counts;
  }
}
