/**
 * Verification plan builder for Claude-based verifiers.
 *
 * Topologically sorts behaviors (auth-first, then Kahn's algorithm),
 * rewrites credentials, and generates a markdown plan with CSV output template.
 *
 * Ported from verifier-bench/verifiers/instruction_parser.py.
 */

import type { HarborBehavior } from "../shared/types";
import type { CredentialContext } from "./types";
import { extractCredentials } from "./credential-extractor";

const AUTH_IDS = ["sign-up", "sign-in", "sign-out"];
const AUTH_SET = new Set(AUTH_IDS);

// ─── Topological Sort ────────────────────────────────────────────────

/**
 * Topological sort with auth-first partitioning.
 * Auth behaviors (sign-up, sign-in, sign-out) come first in canonical order,
 * then non-auth behaviors in dependency order via Kahn's algorithm.
 */
export function topologicalSort(behaviors: HarborBehavior[]): HarborBehavior[] {
  const byId = new Map(behaviors.map((b) => [b.id, b]));

  // Auth partition: canonical order
  const auth = AUTH_IDS.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  const nonAuth = behaviors.filter((b) => !AUTH_SET.has(b.id));

  // Kahn's algorithm on non-auth behaviors
  const nonAuthIds = new Set(nonAuth.map((b) => b.id));
  const inDegree = new Map(nonAuth.map((b) => [b.id, 0]));

  for (const b of nonAuth) {
    for (const dep of b.dependencies) {
      if (nonAuthIds.has(dep.behaviorId)) {
        inDegree.set(b.id, (inDegree.get(b.id) ?? 0) + 1);
      }
    }
  }

  const queue = nonAuth
    .filter((b) => inDegree.get(b.id) === 0)
    .map((b) => b.id)
    .sort();

  const sorted: HarborBehavior[] = [];
  const nonAuthById = new Map(nonAuth.map((b) => [b.id, b]));

  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(nonAuthById.get(id)!);

    for (const b of nonAuth) {
      for (const dep of b.dependencies) {
        if (dep.behaviorId === id && nonAuthIds.has(b.id)) {
          const newDeg = (inDegree.get(b.id) ?? 1) - 1;
          inDegree.set(b.id, newDeg);
          if (newDeg === 0) {
            queue.push(b.id);
            queue.sort();
          }
        }
      }
    }
  }

  if (sorted.length !== nonAuth.length) {
    const sortedIds = new Set(sorted.map((b) => b.id));
    const remaining = nonAuth.filter((b) => !sortedIds.has(b.id)).map((b) => b.id);
    throw new Error(`Cycle detected in behavior dependencies: ${remaining.join(", ")}`);
  }

  return [...auth, ...sorted];
}

// ─── Credential Rewriting ────────────────────────────────────────────

/**
 * Rewrite sign-up steps to use the uniquified email.
 */
function rewriteBehaviorCredentials(
  behavior: HarborBehavior,
  credCtx: CredentialContext,
): HarborBehavior {
  if (behavior.id !== "sign-up") return behavior;

  return {
    ...behavior,
    examples: behavior.examples.map((ex) => ({
      ...ex,
      steps: ex.steps.map((step) => {
        if (step.type !== "Act") return step;
        const rewritten = step.instruction.replace(
          credCtx.signupEmail,
          credCtx.signupEmailUnique,
        );
        return rewritten !== step.instruction
          ? { ...step, instruction: rewritten }
          : step;
      }),
    })),
  };
}

// ─── Plan Generation ─────────────────────────────────────────────────

function extractEmailFromSteps(steps: { type: string; instruction: string }[]): string | null {
  const pattern = /[Tt]ype\s+"([^"]+@[^"]+)"\s+into\s+(?:the\s+)?email/;
  for (const step of steps) {
    if (step.type !== "Act") continue;
    const match = step.instruction.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Build the ordered verification plan markdown for Claude.
 */
export function buildVerificationPlan(
  behaviors: HarborBehavior[],
  credCtx?: CredentialContext | null,
): string {
  let sorted = topologicalSort(behaviors);

  if (credCtx) {
    sorted = sorted.map((b) => rewriteBehaviorCredentials(b, credCtx));
  }

  const lines: string[] = [
    "# Verification Plan",
    "",
    "App URL: http://localhost:3000",
    "",
    "Verify each behavior below **in order**. For each one:",
    "1. Navigate to the specified page",
    "2. Execute the Act steps",
    "3. Wait when you see Await steps — they indicate async operations",
    "4. Check the expected outcomes",
    "5. Record pass or fail",
    "",
    "After verifying ALL behaviors, write results to `/logs/agent/results.csv`.",
    "",
    "---",
  ];

  for (let i = 0; i < sorted.length; i++) {
    const behavior = sorted[i];
    lines.push("");
    lines.push(`## Step ${i + 1}: ${behavior.title}`);
    if (behavior.pagePath) {
      lines.push(`**Page:** ${behavior.pagePath}`);
    }
    lines.push("");

    for (const scenario of behavior.examples) {
      // Annotate Sign In scenarios
      if (credCtx && behavior.id === "sign-in") {
        const scenarioEmail = extractEmailFromSteps(scenario.steps);
        if (scenarioEmail === credCtx.invalidEmail) {
          lines.push(
            "> This scenario tests INVALID credentials. " +
            "Use exactly the values shown.",
          );
          lines.push("");
        } else {
          lines.push(
            "> This scenario tests valid sign-in. " +
            "Use the pre-seeded account shown.",
          );
          lines.push("");
        }
      }

      lines.push(`### Scenario: ${scenario.name}`);
      for (const step of scenario.steps) {
        lines.push(`* ${step.type}: ${step.instruction}`);
      }
      lines.push("");
    }

    lines.push("---");
  }

  // CSV template
  lines.push("");
  lines.push("## Output Format");
  lines.push("");
  lines.push("Write this exact CSV to `/logs/agent/results.csv`:");
  lines.push("```csv");
  lines.push("behavior_id,result,reason");
  for (const behavior of sorted) {
    lines.push(`${behavior.id},[pass or fail],"[brief reason]"`);
  }
  lines.push("```");

  return lines.join("\n");
}

/**
 * Full pipeline: parse behaviors → extract credentials → build plan.
 */
export function buildPlanFromBehaviors(behaviors: HarborBehavior[]): {
  plan: string;
  credCtx: CredentialContext | null;
} {
  const credCtx = extractCredentials(behaviors);
  const plan = buildVerificationPlan(behaviors, credCtx);
  return { plan, credCtx };
}
