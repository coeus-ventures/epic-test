---
description: Update issue file with detailed implementation plan
argument-hint: @docs/issues/[issue-file].md
---

# Plan

Instructions: $ARGUMENTS

Update the issue file with a detailed implementation plan.

## Steps

1. **Explore First** - Navigate to relevant source folders to understand what's already implemented. Check existing types, interfaces, and patterns. Don't change anything in this phase.

2. **Write the Plan** - Update the issue file with a plan that includes:
   - What needs to be created or changed
   - Which layer(s) are affected (CLI, Core, Adapters)
   - Key types and interfaces
   - Test cases (focus on happy path)

## Issue Naming Conventions

- `Implement [component] in [layer]`
- `Add [feature] to [domain]`
- `Fix [bug] in [component]`
- `Refactor [component] to [pattern]`

## Planning Guidelines

- If the module already exists, focus on what needs to change
- Follow existing patterns in the codebase
- Keep test cases minimal - one happy path test per component
- Identify dependencies between layers
