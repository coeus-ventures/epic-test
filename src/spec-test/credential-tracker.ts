// ============================================================================
// CREDENTIAL TRACKER — captures Sign Up credentials for reuse
// ============================================================================

import type { HarborBehavior, SpecStep } from "./types";

export class CredentialTracker {
  private credentials: { email: string | null; password: string | null };
  private executionCounter: number;

  constructor() {
    this.credentials = { email: null, password: null };
    this.executionCounter = 0;
  }

  /** Generate unique email variant to avoid duplicate registration. */
  uniquifyEmail(email: string): string {
    this.executionCounter++;
    const atIndex = email.indexOf('@');
    if (atIndex === -1) return email;
    return `${email.slice(0, atIndex)}_${this.executionCounter}${email.slice(atIndex)}`;
  }

  /** Capture credentials from a Type step instruction. */
  captureFromStep(instruction: string): void {
    const typePattern = /Type\s+["']([^"']+)["']\s+into\s+(?:the\s+)?(.+)/i;
    const match = instruction.match(typePattern);
    if (!match) return;

    const value = match[1].trim();
    const fieldDescriptor = match[2].toLowerCase();

    if (fieldDescriptor.includes('email')) {
      this.credentials.email = value;
    } else if (fieldDescriptor.includes('password')) {
      this.credentials.password = value;
    }
  }

  /** Inject captured credentials into a step instruction. */
  injectIntoStep(instruction: string): string {
    const typePattern = /Type\s+["']([^"']+)["']\s+into\s+(?:the\s+)?(.+)/i;
    const match = instruction.match(typePattern);
    if (!match) return instruction;

    const fieldDescriptor = match[2].toLowerCase();
    const originalQuote = instruction.includes('"') ? '"' : "'";

    if (fieldDescriptor.includes('email') && this.credentials.email) {
      return instruction.replace(
        /Type\s+["']([^"']+)["']/i,
        `Type ${originalQuote}${this.credentials.email}${originalQuote}`
      );
    }

    if (fieldDescriptor.includes('password') && this.credentials.password) {
      return instruction.replace(
        /Type\s+["']([^"']+)["']/i,
        `Type ${originalQuote}${this.credentials.password}${originalQuote}`
      );
    }

    return instruction;
  }

  hasCredentials(): boolean {
    return this.credentials.email !== null && this.credentials.password !== null;
  }

  getCredentials(): { email: string | null; password: string | null } {
    return { ...this.credentials };
  }

  reset(): void {
    this.credentials = { email: null, password: null };
  }
}

// ============================================================================
// CREDENTIAL PROCESSING FOR STEPS
// ============================================================================

/**
 * Process steps for a behavior, handling credential uniquification and injection.
 *
 * - Sign Up behaviors: uniquify email to avoid duplicate registration
 * - Behaviors with "invalid"/"wrong" in ID: skip injection (testing bad credentials)
 * - Other behaviors: inject captured credentials into first 5 steps
 *   (the sign-in preamble area — avoids replacing fields in behavior-specific forms)
 */
export function processStepsWithCredentials(
  behavior: HarborBehavior,
  steps: SpecStep[],
  credentialTracker: CredentialTracker
): SpecStep[] {
  const behaviorId = behavior.id.toLowerCase();

  // Sign Up: uniquify email
  if (behaviorId.includes('sign-up') || behaviorId.includes('signup')) {
    const typePattern = /Type\s+["']([^"']+)["']\s+into\s+(?:the\s+)?(.+)/i;
    return steps.map(step => {
      if (step.type !== 'act') return step;
      const match = step.instruction.match(typePattern);
      if (!match) return step;
      if (match[2].toLowerCase().includes('email')) {
        const uniqueEmail = credentialTracker.uniquifyEmail(match[1]);
        const quote = step.instruction.includes('"') ? '"' : "'";
        return {
          ...step,
          instruction: step.instruction.replace(
            /Type\s+["']([^"']+)["']/i,
            `Type ${quote}${uniqueEmail}${quote}`
          ),
        };
      }
      return step;
    });
  }

  // Skip injection for behaviors testing invalid credentials
  if (behaviorId.includes('invalid') || behaviorId.includes('wrong')) {
    return steps;
  }

  // Inject captured credentials into first 5 steps (sign-in preamble)
  if (credentialTracker.hasCredentials()) {
    return steps.map((step, index) => {
      if (step.type === 'act' && index < 5) {
        return { ...step, instruction: credentialTracker.injectIntoStep(step.instruction) };
      }
      return step;
    });
  }

  return steps;
}
