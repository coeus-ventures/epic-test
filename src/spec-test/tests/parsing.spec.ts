import { describe, it, expect } from "vitest";
import { parseSteps, parseSpecFile } from "../index";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("parseSteps", () => {
  it("should parse Act steps from markdown content", () => {
    const content = `
#### Steps
* Act: User navigates to /login
* Act: User clicks Login button
`;
    const steps = parseSteps(content);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({
      type: "act",
      instruction: "User navigates to /login",
      lineNumber: expect.any(Number),
    });
    expect(steps[1]).toEqual({
      type: "act",
      instruction: "User clicks Login button",
      lineNumber: expect.any(Number),
    });
  });

  it("should parse Check steps with deterministic classification", () => {
    const content = `
#### Steps
* Check: URL contains /dashboard
* Check: Page title is 'Home'
`;
    const steps = parseSteps(content);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({
      type: "check",
      instruction: "URL contains /dashboard",
      checkType: "deterministic",
      lineNumber: expect.any(Number),
    });
    expect(steps[1]).toEqual({
      type: "check",
      instruction: "Page title is 'Home'",
      checkType: "deterministic",
      lineNumber: expect.any(Number),
    });
  });

  it("should parse Check steps with semantic classification", () => {
    const content = `
#### Steps
* Check: Error message is displayed
* Check: Welcome message is displayed
`;
    const steps = parseSteps(content);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({
      type: "check",
      instruction: "Error message is displayed",
      checkType: "semantic",
      lineNumber: expect.any(Number),
    });
    expect(steps[1]).toEqual({
      type: "check",
      instruction: "Welcome message is displayed",
      checkType: "semantic",
      lineNumber: expect.any(Number),
    });
  });

  it("should parse mixed Act and Check steps", () => {
    const content = `
#### Steps
* Act: User logs in as "client"
* Act: User navigates to the projects page
* Check: Projects list is visible
* Act: User clicks Create Project button
* Check: URL contains /projects/new
`;
    const steps = parseSteps(content);

    expect(steps).toHaveLength(5);
    expect(steps[0].type).toBe("act");
    expect(steps[1].type).toBe("act");
    expect(steps[2].type).toBe("check");
    expect(steps[2].checkType).toBe("semantic");
    expect(steps[3].type).toBe("act");
    expect(steps[4].type).toBe("check");
    expect(steps[4].checkType).toBe("deterministic");
  });
});

describe("parseSpecFile", () => {
  it("should parse spec file and extract name from heading", async () => {
    const fixturePath = path.join(__dirname, "fixtures", "sample-spec.md");
    const spec = await parseSpecFile(fixturePath);

    expect(spec.name).toBe("Login");
  });

  it("should parse spec file and extract examples with steps", async () => {
    const fixturePath = path.join(__dirname, "fixtures", "sample-spec.md");
    const spec = await parseSpecFile(fixturePath);

    expect(spec.examples).toHaveLength(1);
    expect(spec.examples[0].name).toBe("Login with valid credentials");
    expect(spec.examples[0].steps).toHaveLength(6);
    expect(spec.examples[0].steps[0]).toEqual({
      type: "act",
      instruction: "User navigates to /login",
      lineNumber: expect.any(Number),
    });
    expect(spec.examples[0].steps[4]).toEqual({
      type: "check",
      instruction: "URL contains /dashboard",
      checkType: "deterministic",
      lineNumber: expect.any(Number),
    });
    expect(spec.examples[0].steps[5]).toEqual({
      type: "check",
      instruction: "Welcome message is displayed",
      checkType: "semantic",
      lineNumber: expect.any(Number),
    });
  });
});
