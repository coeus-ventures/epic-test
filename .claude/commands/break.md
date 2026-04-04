---
description: Break a spec into individual implementation issues
argument-hint: @docs/refactoring-spec.md
---

# Break

Instructions: $ARGUMENTS

Break the spec into individual implementation issues.

## Guidelines

- Create one issue per focused change (one file or one closely related group)
- Each issue has a title, overview, affected files, and which agent handles it
- Number issues in dependency order (001, 002, etc.)
- Create issues in `docs/issues/`

## Issue Template

```markdown
# [Issue Title]

## Overview
Brief description of what needs to change.

## Files
- `src/[module]/[file].ts` — what changes

## Agent
- [ ] shared-writer
- [ ] module-writer
- [ ] test-writer

## Coding Discipline Focus
Which principles apply most: SRP, DRY, top-down order, guard clauses, pipelines, etc.

## Dependencies
Issues that must be completed first.
```
