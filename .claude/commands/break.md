---
description: Break spec into individual implementation issues
argument-hint: @SPEC.md
---

# Break

Instructions: $ARGUMENTS

Break the spec into individual implementation issues.

## Guidelines

- Create one issue per major component/module
- Each issue is just the title and a brief overview
- We will use the `/run` command later to turn each one into a full plan and execute it
- Create the issues in the folder `docs/issues/`
- Number issues in dependency order (001, 002, etc.)

## Issue Naming Convention

- `Implement [component] in [layer]` - New functionality
- `Add [feature] to [module]` - Extending existing code
- `Create [adapter] adapter` - External integrations
- `Implement [command] CLI command` - CLI commands

## Suggested Issue Breakdown for epic-webdev-bench

For a CLI tool like this, typical issue order:

1. **Core types and interfaces** - Define all TypeScript interfaces first
2. **Adapters** - External integrations (agents, spec-test)
3. **Core logic** - Business logic (harness, verify, results)
4. **CLI commands** - User-facing commands
5. **Integration** - Wire everything together
6. **Testing** - Add tests for critical paths

## Example Issues

```
docs/issues/
├── 001-core-types.md           # Define all interfaces
├── 002-agent-adapter.md        # Claude/GPT agent wrappers
├── 003-spec-test-adapter.md    # spec-test integration
├── 004-harness-loop.md         # Ralph-style loop
├── 005-verification-runner.md  # Verify behaviors
├── 006-dataset-generator.md    # Generate results JSON
├── 007-bench-command.md        # bun run bench
├── 008-verify-command.md       # bun run verify
├── 009-results-command.md      # bun run results
└── 010-integration-test.md     # End-to-end test
```

## Issue Template

Each issue file should contain:

```markdown
# [Issue Title]

## Overview

Brief description of what needs to be implemented.

## Layer

- [ ] Adapters
- [ ] Core
- [ ] CLI
- [ ] Tests

## Dependencies

List any issues that must be completed first.
```
