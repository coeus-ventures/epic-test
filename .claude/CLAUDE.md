# CLAUDE.md

## Overview

**epic-test** is a TypeScript library for AI-powered browser testing. It verifies web application behaviors by parsing markdown specs, driving a browser via Stagehand (Playwright wrapper), and asserting outcomes with deterministic and semantic (LLM-based) checks.

## Architecture

```
src/
├── shared/             # Cross-cutting: types, session, credentials, orchestration, BaseStagehandRunner
├── spec-test/          # Step-by-step browser verification (SpecTestRunner extends BaseStagehandRunner)
├── agent-test/         # Goal-driven agent verification (AgentTestRunner extends BaseStagehandRunner)
├── claude-test/        # Claude CLI verification (Docker containers)
├── b-test/             # LLM-powered snapshot assertions (Tester class)
└── db-test/            # Database state management (PreDB/PostDB)
```

**Import rules**: Modules import from `../shared/`, never from each other. spec-test files moved to shared/ are thin re-export wrappers.

## Commands

```bash
source "$HOME/.config/nvm/nvm.sh" && nvm use 20 --silent
npx vitest run                                    # all tests
npx vitest run src/spec-test/tests/runner.spec.ts  # specific file
npx tsc --noEmit                                   # type check
```

## Testing Patterns

- Tests in `src/[module]/tests/`, import from barrel `../index`
- Mock Stagehand: `(runner as any).stagehand = mockStagehand`
- Module mocks: `vi.mock("../act-evaluator")`
- ESM: `fileURLToPath(import.meta.url)` instead of `__dirname`

## Coding Discipline

All code follows the `coding_discipline` skill (SOLID, Clean Code, Composed Method, DRY, YAGNI). Read `.claude/skills/coding_discipline/SKILL.md` before writing code.

## Code Review Requirement

After generating or modifying any code file, always run the `code_reviewer` skill.
