import { describe, it, expect } from "vitest";
import { classifyCheck } from "../index";

describe("classifyCheck", () => {
  it('should classify "URL contains" as deterministic', () => {
    expect(classifyCheck("URL contains /projects")).toBe("deterministic");
    expect(classifyCheck("URL contains /dashboard")).toBe("deterministic");
  });

  it('should classify "Page title is" as deterministic', () => {
    expect(classifyCheck("Page title is 'Projects'")).toBe("deterministic");
    expect(classifyCheck("Page title is 'Home'")).toBe("deterministic");
  });

  it('should classify "URL is" as deterministic', () => {
    expect(classifyCheck("URL is http://localhost:8080/login")).toBe(
      "deterministic"
    );
  });

  it('should classify "Page title contains" as deterministic', () => {
    expect(classifyCheck("Page title contains 'Dashboard'")).toBe(
      "deterministic"
    );
  });

  it('should classify "Element count is" as deterministic', () => {
    expect(classifyCheck("Element count is 5")).toBe("deterministic");
  });

  it('should classify "Input value is" as deterministic', () => {
    expect(classifyCheck("Input value is 'test@example.com'")).toBe(
      "deterministic"
    );
  });

  it('should classify "Checkbox is checked" as deterministic', () => {
    expect(classifyCheck("Checkbox is checked")).toBe("deterministic");
  });

  it('should classify "Error message is displayed" as semantic', () => {
    expect(classifyCheck("Error message is displayed")).toBe("semantic");
  });

  it('should classify "Success notification appears" as semantic', () => {
    expect(classifyCheck("Success notification appears")).toBe("semantic");
  });

  it('should classify "New project appears in the list" as semantic', () => {
    expect(classifyCheck("New project appears in the list")).toBe("semantic");
  });

  it('should classify "Form validation errors are shown" as semantic', () => {
    expect(classifyCheck("Form validation errors are shown")).toBe("semantic");
  });
});
