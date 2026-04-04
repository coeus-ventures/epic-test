---
description: Execute an issue following the project architecture and coding discipline
argument-hint: @docs/refactoring-spec.md or issue description
---

# Execute

Instructions: $ARGUMENTS

Execute an issue following the project's architecture and coding discipline.

## Coding Discipline

Before writing any code, read `.claude/skills/coding_discipline/SKILL.md`. All code must follow SOLID, Clean Code, Composed Method, DRY, and YAGNI principles.

## Agents

| Agent | Purpose | Location |
|-------|---------|----------|
| **shared-writer** | Cross-cutting modules (types, session, credentials, orchestration) | `src/shared/` |
| **module-writer** | Module-specific code (spec-test, agent-test, claude-test, b-test) | `src/[module]/` |
| **test-writer** | Unit and characterization tests | `src/[module]/tests/` |

## Execution Order

1. **Understand** — Read the issue and identify affected files
2. **Write characterization tests** (if refactoring) — Lock current behavior before changing it
3. **Implement** — Use the appropriate agent based on file location:
   - Files in `src/shared/` → use **shared-writer**
   - Files in `src/spec-test/`, `src/agent-test/`, `src/claude-test/`, `src/b-test/` → use **module-writer**
4. **Write/update tests** — Use **test-writer**
5. **Verify** — Run tests and type checker
6. **Review** — Run `/code_reviewer` on changed files

## Verification

After every change:

```bash
source "$HOME/.config/nvm/nvm.sh" && nvm use 20 --silent
npx vitest run           # all tests pass
npx tsc --noEmit         # only pre-existing agent-test errors allowed
```

## Architecture

```
src/
├── shared/             # Cross-cutting (types, session, credentials, orchestration)
│   └── base-runner.ts  # BaseStagehandRunner abstract class
├── spec-test/          # Step-by-step browser verification (extends BaseStagehandRunner)
├── agent-test/         # Goal-driven agent verification (extends BaseStagehandRunner)
├── claude-test/        # Claude CLI verification (Docker containers)
├── b-test/             # LLM-powered snapshot assertions
└── db-test/            # Database state management
```

## Import Rules

- `shared/` owns types and utilities used by 2+ modules
- Modules import from `../shared/`, never from each other
- `spec-test/` files moved to `shared/` become thin re-export wrappers
- Barrel exports via `index.ts` in each module
