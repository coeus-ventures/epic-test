import { describe, it, expect } from "vitest";
import { extractCredentials } from "../credential-extractor";
import type { HarborBehavior } from "../../spec-test/types";

function makeBehavior(
  id: string,
  title: string,
  scenarios: { name: string; steps: { type: "Act" | "Check"; instruction: string }[] }[],
): HarborBehavior {
  return {
    id,
    title,
    dependencies: [],
    examples: scenarios.map((s) => ({ name: s.name, steps: s.steps })),
  };
}

describe("extractCredentials", () => {
  it("returns null if no sign-up behavior exists", () => {
    const behaviors = [
      makeBehavior("view-tasks", "View Tasks", [
        { name: "Default", steps: [{ type: "Act", instruction: "Navigate to /tasks" }] },
      ]),
    ];
    expect(extractCredentials(behaviors)).toBeNull();
  });

  it("extracts signup email and uniquifies it", () => {
    const behaviors = [
      makeBehavior("sign-up", "Sign Up", [{
        name: "User creates account",
        steps: [
          { type: "Act", instruction: 'Type "alice@blog.com" into the email field' },
          { type: "Act", instruction: 'Type "password123" into the password field' },
        ],
      }]),
    ];

    const result = extractCredentials(behaviors);
    expect(result).not.toBeNull();
    expect(result!.signupEmail).toBe("alice@blog.com");
    expect(result!.signupEmailUnique).toMatch(/^alice_[a-f0-9]{4}@blog\.com$/);
    expect(result!.signupPassword).toBe("password123");
  });

  it("extracts signin and invalid credentials from Sign In scenarios", () => {
    const behaviors = [
      makeBehavior("sign-up", "Sign Up", [{
        name: "User creates account",
        steps: [
          { type: "Act", instruction: 'Type "alice@blog.com" into the email field' },
          { type: "Act", instruction: 'Type "password123" into the password field' },
        ],
      }]),
      makeBehavior("sign-in", "Sign In", [
        {
          name: "User enters wrong credentials",
          steps: [
            { type: "Act", instruction: 'Type "wrong@email.com" into the email field' },
            { type: "Act", instruction: 'Type "badpass" into the password field' },
          ],
        },
        {
          name: "User signs in successfully",
          steps: [
            { type: "Act", instruction: 'Type "alice@blog.com" into the email field' },
            { type: "Act", instruction: 'Type "password123" into the password field' },
          ],
        },
      ]),
    ];

    const result = extractCredentials(behaviors)!;
    expect(result.invalidEmail).toBe("wrong@email.com");
    expect(result.invalidPassword).toBe("badpass");
    expect(result.signinEmail).toBe("alice@blog.com");
    expect(result.signinPassword).toBe("password123");
  });
});
