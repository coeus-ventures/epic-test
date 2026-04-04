/**
 * Extract and uniquify credentials from parsed Harbor behaviors.
 *
 * Ported from verifier-bench/verifiers/instruction_parser.py extract_credentials().
 */

import type { HarborBehavior, SpecStep } from "../shared/types";
import type { CredentialContext } from "./types";

const EMAIL_PATTERN = /[Tt]ype\s+"([^"]+@[^"]+)"\s+into\s+(?:the\s+)?email/;
const PASSWORD_PATTERN = /[Tt]ype\s+"([^"]+)"\s+into\s+(?:the\s+)?password/;

function findBehavior(behaviors: HarborBehavior[], id: string): HarborBehavior | undefined {
  return behaviors.find((b) => b.id === id);
}

function extractEmailFromSteps(steps: SpecStep[]): string | null {
  for (const step of steps) {
    if (step.type !== "Act") continue;
    const match = step.instruction.match(EMAIL_PATTERN);
    if (match) return match[1];
  }
  return null;
}

function extractPasswordFromSteps(steps: SpecStep[]): string | null {
  for (const step of steps) {
    if (step.type !== "Act") continue;
    const match = step.instruction.match(PASSWORD_PATTERN);
    if (match) return match[1];
  }
  return null;
}

function extractEmailFromBehavior(behavior: HarborBehavior): string | null {
  for (const example of behavior.examples) {
    const email = extractEmailFromSteps(example.steps);
    if (email) return email;
  }
  return null;
}

/**
 * Generate a short random hex ID for email uniquification.
 */
function generateRunId(): string {
  return Math.random().toString(16).slice(2, 6);
}

/**
 * Extract credentials from parsed instruction behaviors.
 *
 * Scans Sign Up scenario steps for the email address, and Sign In scenarios
 * to identify invalid vs valid credentials. Returns null if no sign-up
 * behavior exists.
 */
export function extractCredentials(behaviors: HarborBehavior[]): CredentialContext | null {
  const signUp = findBehavior(behaviors, "sign-up");
  if (!signUp) return null;

  const signupEmail = extractEmailFromBehavior(signUp);
  if (!signupEmail) return null;

  // Uniquify: user@domain.com → user_a3f7@domain.com
  const runId = generateRunId();
  const atIndex = signupEmail.lastIndexOf("@");
  const local = signupEmail.slice(0, atIndex);
  const domain = signupEmail.slice(atIndex + 1);
  const signupEmailUnique = `${local}_${runId}@${domain}`;

  // Extract sign-in credentials from scenarios
  let signinEmail = "";
  let signinPassword = "demo123";
  let invalidEmail = "wrong@email.com";
  let invalidPassword = "wrongpassword";

  const signIn = findBehavior(behaviors, "sign-in");
  if (signIn) {
    for (const scenario of signIn.examples) {
      const scenarioEmail = extractEmailFromSteps(scenario.steps);
      if (!scenarioEmail) continue;

      const scenarioLower = scenario.name.toLowerCase();
      const isInvalid = scenarioLower.includes("wrong") ||
        scenarioLower.includes("invalid") ||
        scenarioLower.includes("incorrect");

      if (isInvalid) {
        invalidEmail = scenarioEmail;
        const pw = extractPasswordFromSteps(scenario.steps);
        if (pw) invalidPassword = pw;
      } else {
        signinEmail = scenarioEmail;
        const pw = extractPasswordFromSteps(scenario.steps);
        if (pw) signinPassword = pw;
      }
    }
  }

  return {
    runId,
    signupEmail,
    signupEmailUnique,
    signupPassword: extractPasswordFromSteps(
      signUp.examples.flatMap((e) => e.steps),
    ) ?? "password123",
    signinEmail,
    signinPassword,
    invalidEmail,
    invalidPassword,
  };
}
