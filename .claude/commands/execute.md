---
description: Execute an issue following the project architecture
argument-hint: @docs/issues/[issue-file].md
---

# Execute

Instructions: $ARGUMENTS

This command guides you through executing a complete issue following the project's architecture.

## Agents

| Agent | Purpose | Layer |
|-------|---------|-------|
| **adapter-writer** | External integrations (agents, spec-test) | Adapters |
| **core-writer** | Business logic (harness, verify, results) | Core |
| **test-writer** | Unit and integration tests | Testing |

## Execution Order

Follow this order to respect layer dependencies:

1. Create or Update Python Harness (if needed)
2. Create or Update spec-test (if needed)
3. Create Tests

---

## 1. Create or Update Python Harness (if needed)

**Location:** `agents/`

### When to Create/Update:
- New agent wrapper needed (Claude, GPT, Gemini)
- Parser changes for instruction.md
- Workspace initialization changes

### Key Files:
- `harness.py` - Base harness class
- `harness_claude.py` - Claude Code agent
- `harness_gemini.py` - Gemini CLI agent
- `harness_codex.py` - OpenAI Codex agent
- `parser.py` - Instruction parser
- `workspace.py` - Workspace setup

---

## 2. Create or Update spec-test (if needed)

**Location:** `spec-test/`

### When to Create/Update:
- Verification logic changes
- Browser automation updates
- New check patterns

### Key Files:
- `index.ts` - SpecTestRunner and exports
- `verification-runner.ts` - Verification logic

---

## 3. Create Tests

**Locations:**
- Python: `agents/tests/`
- TypeScript: `spec-test/*.spec.ts`

### Agent Instructions:
**Use the test-writer agent**

Create focused tests for the implemented functionality.

### Run tests:
```bash
# Python
pytest agents/tests/

# TypeScript
cd spec-test && bun test
```

---

## File Organization

```
agents/
├── harness.py            # Base harness class
├── harness_claude.py     # Claude agent
├── harness_gemini.py     # Gemini agent
├── harness_codex.py      # Codex agent
├── parser.py             # Instruction parser
├── workspace.py          # Workspace initialization
└── tests/
    └── test_*.py

spec-test/
├── index.ts              # Main exports
├── verification-runner.ts
└── *.spec.ts             # Tests
```

## Common Patterns

1. **Types First**: Define interfaces/dataclasses before implementation
2. **Pure Functions**: Core logic should be pure (no I/O)
3. **Error Objects**: Return structured results with success/error
4. **TypeScript Strict**: Use proper types everywhere
