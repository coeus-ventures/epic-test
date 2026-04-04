# Global Refactoring Spec

Generated from full codebase review against the project's coding discipline (`coding_discipline` skill). All issues reference SOLID, Clean Code (Martin), Composed Method (Beck), Refactoring (Fowler), DRY (Hunt & Thomas), and YAGNI (Jeffries).

## Rules

- Follow `coding_discipline` skill directives for all changes
- Run `code_reviewer` skill after each issue
- All 336 tests must pass after each issue with zero test changes
- Top-down reading order: main functions first, helpers below, leaf functions last
- Max 50 lines per function, max 2 nesting levels

## Verification

```bash
source "$HOME/.config/nvm/nvm.sh" && nvm use 20 --silent
npx vitest run           # 336 tests pass
npx tsc --noEmit         # only pre-existing agent-test errors
```

---

## Issue 1: Decompose `verification-runner.ts`

**File:** `src/spec-test/verification-runner.ts`
**Problem:** `verifyBehaviorWithDependencies()` is 128 lines with 5 inline `BehaviorContext` constructions and nesting depth 5.
**Violations:** SRP, DRY, nesting depth.

**Action:**
1. Extract result builders: `skipResult()`, `depFailResult()`, `chainErrorResult()`, `passResult()`
2. Extract `executeChainStep()` — runs one step in the dependency chain (credential processing, navigation, runner call)
3. `verifyBehaviorWithDependencies()` becomes a thin loop: skip check → build chain → iterate with `executeChainStep` → return result
4. Top-down order: main function first, chain step execution second, result builders last

**Target:** Main function ~30 lines, no function over 50 lines, max nesting 2.

---

## Issue 2: Decompose `check-helpers.ts`

**File:** `src/spec-test/check-helpers.ts`
**Problem:** `executeCheckWithRetry()` is 91 lines with nesting depth 6. Main function is at the bottom (line 129). Mixes retry loop, oracle strategy selection, and concordance gates.
**Violations:** SRP, nesting depth, bottom-heavy reading order.

**Action:**
1. Move `executeCheckWithRetry()` to top of file (public API first)
2. Extract `selectAndRunOracle()` — encapsulates the page-transition vs same-page oracle strategy selection
3. Extract concordance gate logic into `applyConcordanceGate()` — the deterministic-failed rescue path
4. Use guard clauses to flatten nesting
5. `tryDeterministicCheck()` and `doubleCheckWithExtract()` become leaf helpers at bottom

**Target:** Main function ~35 lines, nesting depth 2, top-down order.

---

## Issue 3: Decompose `act-helpers.ts`

**File:** `src/spec-test/act-helpers.ts`
**Problem:** `tryFillRequiredInputs()` is 82 lines, `tryDOMClick()` is 60 lines. Magic test data hardcoded inline (`'TestPass123!'`, `'+1234567890'`, `'42'`). 4 DOM click strategies copy-pasted.
**Violations:** SRP, DRY (4 inline strategies), magic values.

**Action:**
1. Extract `DEFAULT_FIELD_VALUES` constant map: `{ email: ..., password: ..., tel: ..., url: ..., number: ..., text: ... }` — replaces 15 lines of if/else
2. `tryFillRequiredInputs()` becomes: query fields → filter visible+empty+required → fill from map → return count
3. Extract DOM click strategies into array: `const DOM_CLICK_STRATEGIES = [textMatch, radioCheckbox, numericInput, ariaLabel]` — loop through instead of 4 inline blocks
4. Extract magic values to named constants at module level: `RETRY_DELAY_MS`, `POST_CLICK_DELAY_MS`, `STALE_MODAL_DELAY_MS`

**Target:** No function over 50 lines, magic values named, strategies declarative.

---

## Issue 4: Decompose `step-execution.ts`

**File:** `src/spec-test/step-execution.ts`
**Problem:** `generateSuggestions()` is 58 lines. Duplicate DOM element extraction between `extractInteractiveElements()` (line 139) and `getEnhancedErrorContext()` (line 253). Inconsistent text preview lengths (50, 50, 30). 4 section banners.
**Violations:** DRY (element extraction), magic values, comment noise.

**Action:**
1. Extract shared `describePageElements(page, limit)` — used by both `extractInteractiveElements()` and `getEnhancedErrorContext()`
2. Extract shared `getPageContext(page)` — used by both `getEnhancedErrorContext()` and `getCheckErrorContext()`
3. Unify text preview length to single constant `ELEMENT_TEXT_PREVIEW = 50`
4. Remove section banners — function names provide structure
5. Decompose `generateSuggestions()` — extract error classification into lookup map

**Target:** No function over 50 lines, zero duplicated element extraction, consistent constants.

---

## Issue 5: Deduplicate topological sort

**Files:** `src/agent-test/continuous-orchestrator.ts`, `src/claude-test/plan-builder.ts`
**Problem:** Two different topological sort implementations. `continuous-orchestrator.ts` uses Kahn's on a `Map<string, HarborBehavior>`. `plan-builder.ts` uses Kahn's on `HarborBehavior[]` with auth-first partitioning.
**Violations:** DRY.

**Action:**
1. The `topologicalSort` in `continuous-orchestrator.ts` (takes Map) is already exported and tested — it's the canonical one
2. Refactor `plan-builder.ts` to import `topologicalSort` from `../shared/index` (which re-exports from `continuous-orchestrator` via agent-test, or move to shared/)
3. If signatures differ, create a thin adapter in plan-builder that converts array → map → calls shared sort
4. Delete the duplicate implementation from plan-builder.ts (~53 lines removed)

**Note:** Consider moving `topologicalSort` to `shared/` since both agent-test and claude-test need it.

---

## Issue 6: Deduplicate AUTH_ORDER and type regex constants

**Files:** `src/shared/auth-orchestrator.ts`, `src/agent-test/continuous-orchestrator.ts`, `src/claude-test/plan-builder.ts`, `src/shared/credential-tracker.ts`, `src/claude-test/credential-extractor.ts`
**Problem:** `AUTH_ORDER` defined in 3 files. Type regex `/Type\s+["']...into.../i` duplicated 5 times across 2 files.
**Violations:** DRY.

**Action:**
1. Export `AUTH_ORDER` from `shared/auth-orchestrator.ts` — continuous-orchestrator.ts and plan-builder.ts import it
2. Export `TYPE_INTO_FIELD_PATTERN` from `shared/credential-tracker.ts` — used by `captureFromStep()`, `injectIntoStep()`, `processStepsWithCredentials()`, and `credential-extractor.ts`
3. Delete duplicate definitions from consumer files

**Target:** Each constant defined once, exported from shared/, imported everywhere.

---

## Issue 7: Decompose `claude-runner.ts`

**File:** `src/claude-test/claude-runner.ts`
**Problem:** `runClaudeVerifier()` is 80 lines mixing setup, parsing, file writing, command execution, and result parsing. 6 comment banners. Hardcoded file paths.
**Violations:** SRP, comment noise, magic values.

**Action:**
1. Extract `setupClaudeEnvironment()` — CLI check, onboarding bypass, auth validation, tool installation
2. Extract `buildAndWriteVerificationFiles()` — parse instruction, build plan, write system prompt + plan + user prompt
3. Extract `executeAndParseResults()` — build command, exec, parse CSV, build summary
4. Move file path constants to module level with names: `SYSTEM_PROMPT_PATH`, `VERIFICATION_PLAN_PATH`, etc. (already defined but lack explanation)
5. Remove 6 comment banners — function names provide structure
6. Top-down order: `runClaudeVerifier()` first, then the 3 extracted functions, then CSV parsing helpers

**Target:** Main function ~25 lines, no function over 50 lines, zero banners.

---

## Issue 8: Extract magic values to constants

**Files:** `src/spec-test/act-helpers.ts`, `src/spec-test/step-execution.ts`, `src/shared/session-management.ts`, `src/shared/credential-tracker.ts`
**Problem:** Scattered unexplained literals — timeouts (5000, 3000, 1000, 500, 300ms), text preview lengths (50, 30), port arrays, random offset ranges.
**Violations:** Semantic naming.

**Action:**
1. In each file, extract magic values to named constants at module level
2. Key constants to create:
   - `session-management.ts`: `NETWORKIDLE_TIMEOUT_MS = 5000`, `PORT_PROBE_TIMEOUT_MS = 3000`, `ALTERNATIVE_PORTS = [3000, 5173, 8080, 4200, 3001]`
   - `act-helpers.ts`: `RETRY_DELAY_MS = 1000`, `POST_CLICK_DELAY_MS = 500`, `STALE_MODAL_DELAY_MS = 300`
   - `step-execution.ts`: `ELEMENT_TEXT_PREVIEW = 50` (unify the inconsistent 30/50)
   - `credential-tracker.ts`: `EXECUTION_COUNTER_MIN = 100000`, `EXECUTION_COUNTER_RANGE = 900000`
3. Add brief `// why` comment on non-obvious values

**Target:** Zero unexplained literals in function bodies.

---

## Issue 9: Fix reading order and comment noise

**Files:** `src/spec-test/check-helpers.ts`, `src/spec-test/step-execution.ts`, `src/claude-test/claude-runner.ts`
**Problem:** Public functions buried below helpers. Section banners (`// ============`, `// ───`) add visual noise without semantic value.
**Violations:** Top-down reading order, comment noise.

**Action:**
1. Reorder functions in each file: public/main first, helpers below, leaf functions last
2. Remove all `// ============` and `// ───────` section banners
3. Remove comments that restate what code does (e.g., `// Check skip set first`)
4. Keep comments that explain *why* (business rules, workarounds, non-obvious constraints)

**Note:** Issues 2 and 7 already address check-helpers.ts and claude-runner.ts ordering — this issue covers any remaining files.

---

## Priority Order

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| 1 | Issue 1: verification-runner.ts | High (spec-test core) | Medium |
| 2 | Issue 2: check-helpers.ts | High (nesting 6, 91 lines) | Medium |
| 3 | Issue 3: act-helpers.ts | High (82 lines, magic values) | Medium |
| 4 | Issue 4: step-execution.ts | Medium (DRY, magic values) | Small |
| 5 | Issue 6: AUTH_ORDER + regex dedup | Medium (quick DRY win) | Small |
| 6 | Issue 5: topological sort dedup | Medium (quick DRY win) | Small |
| 7 | Issue 7: claude-runner.ts | Medium (80 lines) | Medium |
| 8 | Issue 8: magic values | Low (naming) | Small |
| 9 | Issue 9: reading order + noise | Low (cosmetic) | Small |

Issues 1-3 should be done first — they're the spec-test core and run on every test execution. Issues 5-6 are quick DRY wins. Issues 7-9 are cleanup.
