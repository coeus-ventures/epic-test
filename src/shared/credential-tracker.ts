import type { HarborBehavior, SpecStep } from "./types";

/** Matches "Type 'value' into the field" — captures value and field descriptor. */
export const TYPE_INTO_FIELD_PATTERN = /Type\s+["']([^"']+)["']\s+into\s+(?:the\s+)?(.+)/i;

/** Matches "Type 'value'" — captures value only. Used for replacement. */
export const TYPE_VALUE_PATTERN = /Type\s+["']([^"']+)["']/i;

// Random offset range so re-runs on the same database produce unique emails
const EXECUTION_COUNTER_MIN = 100000;
const EXECUTION_COUNTER_RANGE = 900000;

export class CredentialTracker {
  private credentials: { email: string | null; password: string | null };
  private executionCounter: number;

  constructor() {
    this.credentials = { email: null, password: null };
    this.executionCounter = Math.floor(Math.random() * EXECUTION_COUNTER_RANGE) + EXECUTION_COUNTER_MIN;
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
    const match = instruction.match(TYPE_INTO_FIELD_PATTERN);
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
    const match = instruction.match(TYPE_INTO_FIELD_PATTERN);
    if (!match) return instruction;

    const fieldDescriptor = match[2].toLowerCase();
    const originalQuote = instruction.includes('"') ? '"' : "'";

    if (fieldDescriptor.includes('email') && this.credentials.email) {
      return instruction.replace(
        TYPE_VALUE_PATTERN,
        `Type ${originalQuote}${this.credentials.email}${originalQuote}`
      );
    }

    if (fieldDescriptor.includes('password') && this.credentials.password) {
      return instruction.replace(
        TYPE_VALUE_PATTERN,
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

/**
 * Process steps for a behavior, handling credential uniquification and injection.
 *
 * - Sign Up behaviors: uniquify email to avoid duplicate registration
 * - Scenarios with "invalid"/"wrong"/"incorrect" in name: skip injection (testing bad credentials)
 * - Other behaviors: inject captured credentials into first 5 steps
 *   (the sign-in preamble area — avoids replacing fields in behavior-specific forms)
 */
export function processStepsWithCredentials(
  behavior: HarborBehavior,
  steps: SpecStep[],
  credentialTracker: CredentialTracker,
  scenarioName?: string
): SpecStep[] {
  const behaviorId = behavior.id.toLowerCase();

  // Sign Up: uniquify email
  if (behaviorId.includes('sign-up') || behaviorId.includes('signup')) {
    return steps.map(step => {
      if (step.type !== 'Act') return step;
      const match = step.instruction.match(TYPE_INTO_FIELD_PATTERN);
      if (!match) return step;
      if (match[2].toLowerCase().includes('email')) {
        const uniqueEmail = credentialTracker.uniquifyEmail(match[1]);
        const quote = step.instruction.includes('"') ? '"' : "'";
        return {
          ...step,
          instruction: step.instruction.replace(
            TYPE_VALUE_PATTERN,
            `Type ${quote}${uniqueEmail}${quote}`
          ),
        };
      }
      return step;
    });
  }

  // Skip injection for scenarios/behaviors testing invalid credentials.
  const scenarioLower = (scenarioName || '').toLowerCase();
  if (scenarioLower.includes('wrong') || scenarioLower.includes('invalid') || scenarioLower.includes('incorrect')
      || behaviorId.includes('invalid') || behaviorId.includes('wrong')) {
    return steps;
  }

  // Inject captured credentials into first 5 steps (sign-in preamble)
  if (credentialTracker.hasCredentials()) {
    return steps.map((step, index) => {
      if (step.type === 'Act' && index < 5) {
        return { ...step, instruction: credentialTracker.injectIntoStep(step.instruction) };
      }
      return step;
    });
  }

  return steps;
}
