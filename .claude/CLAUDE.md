# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Overview

**epic-test** is a TypeScript library for AI-powered browser testing. It verifies web application behaviors by parsing markdown specs, driving a browser via Stagehand (Playwright wrapper), and asserting outcomes with both deterministic and semantic (LLM-based) checks.

## Architecture

```
src/
├── spec-test/          # Behavior verification library (main)
│   ├── index.ts        # Barrel re-exports (public API)
│   ├── types.ts        # All TypeScript interfaces
│   ├── parsing.ts      # Markdown spec → data structures
│   ├── classify.ts     # Check step classification (deterministic vs semantic)
│   ├── runner.ts       # SpecTestRunner — browser session + step execution
│   ├── step-execution.ts   # Act/Check step helpers (Stagehand + B-Test)
│   ├── orchestrator.ts     # Top-level: verifyAllBehaviors()
│   ├── auth-orchestrator.ts # Auth flow: Sign Up → Sign Out → Invalid Sign In → Sign In
│   ├── verification-runner.ts  # Dependency chain execution per behavior
│   ├── dependency-chain.ts     # DAG resolver for behavior dependencies
│   ├── credential-tracker.ts   # Captures/injects Sign Up credentials
│   ├── verification-context.ts # Tracks pass/fail across behaviors
│   ├── summary.ts              # Reward calculation + summary generation
│   └── tests/          # Vitest test files
├── b-test/             # Diff-based assertion library (snapshot → act → diff → assert)
└── db-test/            # Database testing utilities
```

## Execution Flow

```
verifyAllBehaviors()                    # orchestrator.ts
  ├── Auth behaviors (shared session)   # auth-orchestrator.ts
  │   Sign Up → Sign Out → Invalid Sign In → Sign In
  └── Non-auth behaviors (fresh chains) # verification-runner.ts
      For each behavior:
        buildDependencyChain()          # dependency-chain.ts
        For each chain step:
          runner.runExample()           # runner.ts
            resetSession() or navigateToPagePath()
            For each step:
              runStep() → Act (Stagehand) or Check (B-Test + extract)
```

## Key Concepts

- **Behavior**: A testable feature (e.g., "Create Todo") with dependencies, examples, and a page path
- **Dependency Chain**: Sign Up → ... → target behavior. Only first step clears browser state
- **Session Management**: `clearSession=true` does hard reset; `false` preserves localStorage/cookies
- **Dual Oracle**: Check steps try deterministic text match first, then semantic (b-test diff or stagehand extract)
- **Credential Tracking**: Captures email/password from Sign Up, injects into subsequent behaviors

## Commands

```bash
# Run all tests
npx vitest run --reporter=verbose

# Run specific test file
npx vitest run src/spec-test/tests/spec-test.test.ts

# Run integration tests (requires running app)
npx vitest run --config vitest.integration.config.ts
```

## Testing Patterns

- Tests live in `src/spec-test/tests/`
- Tests import from barrel `../index`
- Mock Stagehand/browser deps via `(runner as any).stagehand = mockStagehand` to bypass `initialize()`
- Use `vi.mock()` for module-level mocks (fs/promises, credential-tracker)
- ESM module: use `fileURLToPath(import.meta.url)` instead of `__dirname`
- Use `os.tmpdir()` for temp directories (Windows non-ASCII path workaround)

## Spec Format (Harbor)

```markdown
# App Name

## Pages
### Page Name
**Path:** `/route`
#### Behaviors
- Behavior Title

## Behaviors

### Behavior Title
Description text.

#### Dependencies
1. Sign Up

#### Steps
* Act: Click the "Create" button
* Check: A new item appears in the list

#### Scenarios
##### Scenario Name
###### Steps
* Act: ...
* Check: ...
```

## Code Review Requirement

After generating or modifying any code file, always run the `code_reviewer` skill and produce a Code Review Report before finishing your response.
