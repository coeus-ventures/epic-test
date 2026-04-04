// ============================================================================
// REWARD & SUMMARY
// ============================================================================

import type { BehaviorContext, VerificationSummary } from "./types";

export function calculateReward(results: BehaviorContext[]): number {
  if (results.length === 0) return 0;
  return results.filter(r => r.status === 'pass').length / results.length;
}

export function aggregateResults(results: BehaviorContext[]): Omit<VerificationSummary, 'summary' | 'behaviors' | 'duration'> {
  return {
    passed: results.filter(r => r.status === 'pass').length,
    failed: results.filter(r => r.status === 'fail').length,
    dependency_failed: results.filter(r => r.status === 'dependency_failed').length,
    total: results.length,
    reward: calculateReward(results),
  };
}

export function generateSummary(results: BehaviorContext[]): string {
  const { passed, failed, dependency_failed } = aggregateResults(results);
  const parts: string[] = [];

  parts.push(passed === 1 ? '1 behavior passed' : `${passed} behaviors passed`);

  if (failed > 0) {
    const failedNames = results
      .filter(r => r.status === 'fail')
      .map(r => r.behaviorName)
      .join(', ');
    parts.push(failed === 1 ? `1 failed (${failedNames})` : `${failed} failed (${failedNames})`);
  }

  if (dependency_failed > 0) {
    parts.push(dependency_failed === 1
      ? '1 failed due to dependencies'
      : `${dependency_failed} failed due to dependencies`);
  }

  return parts.join(', ');
}

export function createVerificationSummary(
  results: BehaviorContext[],
  duration: number
): VerificationSummary {
  return {
    ...aggregateResults(results),
    summary: generateSummary(results),
    behaviors: results,
    duration,
  };
}
