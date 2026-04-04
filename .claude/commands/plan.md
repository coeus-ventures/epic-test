---
description: Create implementation plan for an issue
argument-hint: @docs/refactoring-spec.md or issue description
---

# Plan

Instructions: $ARGUMENTS

Create a detailed implementation plan for the issue.

## Steps

1. **Explore** — Read relevant source files to understand current state. Check existing types, patterns, and imports. Don't change anything.

2. **Write the Plan** — Include:
   - What needs to be created or changed (with file paths)
   - Which module(s) are affected (shared, spec-test, agent-test, claude-test, b-test)
   - Which coding discipline principles apply (SRP, DRY, top-down order, etc.)
   - Test cases needed (characterization tests if refactoring, unit tests if new code)

3. **Identify Agent** — Which agent handles the work:
   - `shared-writer` for `src/shared/`
   - `module-writer` for `src/spec-test/`, `src/agent-test/`, `src/claude-test/`, `src/b-test/`
   - `test-writer` for tests

## Planning Guidelines

- Read `.claude/skills/coding_discipline/SKILL.md` before proposing structure
- If refactoring, plan characterization tests FIRST
- Follow existing patterns in the codebase
- Keep test cases minimal — one happy path per function
- Identify dependencies between modules
