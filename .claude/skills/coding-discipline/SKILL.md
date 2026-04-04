---
name: coding-discipline
description: Coding discipline directives grounded in Clean Code, Composed Method, Refactoring, and SOLID literature. Enforces top-down readability, semantic extraction, declarative pipelines, single responsibility, dependency inversion, and zero speculative code. Applied when writing or refactoring any code in this project.
---

# Coding Discipline

These directives govern all code written in this project. They are grounded in established software engineering literature and enforced by the `code_reviewer` skill.

## Literature Basis

- **Robert C. Martin — Clean Code (2008)**: Functions should be small, do one thing, and operate at one level of abstraction. "Extract till you drop." Names should reveal intent. SOLID principles.
- **Robert C. Martin — Agile Software Development (2002)**: The SOLID principles formalized — SRP, OCP, LSP, ISP, DIP.
- **Kent Beck — Smalltalk Best Practice Patterns (1996)**: The **Composed Method** pattern — divide your program into methods that perform one identifiable task, keep all operations at the same level of abstraction, and name methods after *what* they do, not *how*.
- **Martin Fowler — Refactoring (2018)**: **Extract Function**, **Replace Loop with Pipeline**, **Decompose Conditional**. Replace mechanics with intent.
- **Ron Jeffries / Kent Beck — YAGNI**: "You Aren't Gonna Need It." Don't write code for problems that don't exist yet.
- **Andy Hunt & Dave Thomas — The Pragmatic Programmer (1999)**: DRY — "Every piece of knowledge must have a single, unambiguous, authoritative representation within a system."

## SOLID Principles

### Single Responsibility Principle (SRP)

A module, class, or function should have one and only one reason to change. If you can describe what it does using "and", it has two responsibilities — extract one.

**Applied**: `runBehaviorWithCascade` does cascade logic. `runAuthBehaviorScenarios` does scenario execution. They don't mix.

### Open/Closed Principle (OCP)

Code should be open for extension but closed for modification. When adding a new behavior type or runner strategy, you extend (new class, new callback) rather than editing existing switch statements.

**Applied**: `BaseStagehandRunner` is open for extension — `SpecTestRunner` and `AgentTestRunner` extend it with their own `runExample` without modifying the base. `runBehaviorWithCascade` takes a `runFn` callback — new execution strategies plug in without changing the cascade logic.

### Liskov Substitution Principle (LSP)

Subtypes must be substitutable for their base types. Any `BehaviorRunner` implementation must honor the `runExample` contract — return `ExampleResult`, handle `clearSession`/`navigateToPath` options.

**Applied**: `SpecTestRunner` and `AgentTestRunner` both implement `BehaviorRunner`. Orchestrators use the interface, never the concrete class.

### Interface Segregation Principle (ISP)

No client should be forced to depend on methods it does not use. Interfaces should be small and focused.

**Applied**: `BehaviorRunner` exposes only `runExample` — orchestrators don't need `close`, `clearCache`, or `runFromFile`. Those are implementation details of the concrete runner.

### Dependency Inversion Principle (DIP)

High-level modules should not depend on low-level modules. Both should depend on abstractions.

**Applied**: Orchestrators depend on `BehaviorRunner` (abstraction), not `SpecTestRunner` (concrete). `shared/` owns the abstractions; `spec-test/` and `agent-test/` implement them.

## Structural Directives

### 1. Top-Down Reading Order

The main function comes first. Functions it calls come next. Leaf helpers come last. A reader should understand the full flow by reading the first function, then drill into details only when needed.

**Why**: Code is read far more often than written. The reader shouldn't have to scroll past 200 lines of helpers to find the entry point. Same principle as a newspaper — headline first, details below.

**Literature**: Beck's Composed Method — "Divide your program into methods that perform one identifiable task." The composed method reads like a summary; the extracted methods are the paragraphs.

### 2. Composed Method — Extract Until Each Function Does One Thing

Every function should operate at a single level of abstraction. If a function contains a high-level orchestration step AND a low-level implementation detail, extract the detail into a named function.

**The test**: Can you describe what the function does in one sentence without "and"? If not, extract.

**Literature**: Martin's "Functions should do one thing. They should do it well. They should do it only." Beck's "Keep all of the operations in a method at the same level of abstraction."

### 3. Semantic Naming Over Comments

Function names should make the caller read like prose. If you need a comment to explain what a block of code does, extract it into a function whose name IS the explanation.

```typescript
// Bad: comment explaining what the block does
// Check if sign up failed and skip downstream behaviors
if (!isFirst) {
  const signUpResult = context.getResult('sign-up');
  if (signUpResult && signUpResult.status !== 'pass') {
    // ... 8 lines building a result object
  }
}

// Good: function name IS the explanation
if (!isFirst && signUpFailed(context)) return skipResult(behavior);
```

**Literature**: Beck's Intention Revealing Selector — "Name the message so it communicates what is to be done rather than how." Martin's "Don't Use a Comment When You Can Use a Function."

### 4. Declarative Pipelines Over Imperative Loops

When a loop transforms, filters, or flattens data, use `map`, `filter`, `flatMap`, `find`, `some`, `every`, or `reduce`. Reserve `for` loops for cases where the index is load-bearing (position drives logic) or the loop body has side effects that must be sequential.

```typescript
// Bad: imperative accumulation
const authBehaviors: HarborBehavior[] = [];
for (const id of authOrder) {
  const behavior = allBehaviors.get(id);
  if (behavior) authBehaviors.push(behavior);
}

// Good: declarative pipeline
const authBehaviors = AUTH_ORDER
  .map(id => allBehaviors.get(id))
  .filter((b): b is HarborBehavior => b !== undefined);
```

**Literature**: Fowler's Replace Loop with Pipeline — "Collection pipelines are often significantly more readable than complex for-loops." The pipeline expresses intent (what), the loop expresses mechanics (how).

### 5. DRY — Deduplicate with Callback Patterns, Not Copy-Paste

When two code blocks share 70%+ of their structure but differ in the "action" part, extract the shared structure into a function that takes the varying part as a callback.

```typescript
// Bad: two 100-line functions with identical skip/guard/cascade logic
async function runAuthFlow(...) { /* skip -> guard -> run auth -> cascade */ }
async function runNonAuthFlow(...) { /* skip -> guard -> run non-auth -> cascade */ }

// Good: shared structure, varying execution
async function runBehaviorWithCascade(behavior, ..., runFn) {
  if (skipSet.has(behavior.id)) return skipResult(behavior);
  if (behavior.examples.length === 0) return noExamplesResult(behavior);
  try { return await runFn(); }
  catch (error) { return errorResult(behavior, error); }
}
```

**Literature**: Hunt & Thomas — "Every piece of knowledge must have a single, unambiguous, authoritative representation." Martin's DRY applied at the function level.

### 6. Result Builder Functions

When the same object shape is constructed in multiple places, extract named builder functions. The caller reads as intent, the builder handles the shape.

```typescript
// Bad: 8 inline constructions of the same object shape
const result: BehaviorContext = {
  behaviorId: behavior.id, behaviorName: behavior.title,
  status: 'dependency_failed', failedDependency: 'Sign Up', duration: 0,
};

// Good: one builder, many call sites
function skipResult(behavior: HarborBehavior, failedDep: string): BehaviorContext { ... }
```

### 7. YAGNI — Zero Speculative Code

Do not write code for problems that don't exist yet. No feature flags for hypothetical future needs. No abstract factories "in case we need another implementation." No configuration options nobody asked for.

**The test**: Is there a failing test or a concrete user request that requires this code? If not, delete it.

**Applied**: Don't add `options.strategy` parameter to a function that only has one strategy. Don't create `BaseOrchestrator` when there's only one orchestrator. Extract abstractions when the second concrete use appears, not before.

**Literature**: Ron Jeffries — "Always implement things when you actually need them, never when you just foresee that you need them." Beck — "Do the simplest thing that could possibly work."

### 8. Kill Comment Noise

Remove section banners (`// ========`), obvious comments (`// Check skip set`), and comments that restate what the code already says. Keep only comments that explain **why** — business rules, non-obvious constraints, workarounds.

**Literature**: Martin's "Comments Do Not Make Up for Bad Code." If the code needs a comment to be understood, the code should be refactored, not annotated.

### 9. Guard Clauses Over Nested Conditionals

Handle edge cases and early exits at the top of the function. The main logic should be at the base indentation level, not nested inside conditions.

```typescript
// Bad: nested
async function runBehavior(behavior) {
  if (!skipSet.has(behavior.id)) {
    if (behavior.examples.length > 0) {
      // ... 40 lines of main logic at 2+ indent levels
    }
  }
}

// Good: guards first, main logic flat
async function runBehavior(behavior) {
  if (skipSet.has(behavior.id)) return skipResult(behavior);
  if (behavior.examples.length === 0) return noExamplesResult(behavior);
  // ... main logic at base indent
}
```

**Literature**: Martin's broader pattern of reducing nesting via early returns. Fowler's Decompose Conditional.

## Summary

Write code that reads like a story: entry point first, semantic function names that make callers read like prose, flat structure via guard clauses, declarative pipelines for data transformation, shared patterns extracted with callbacks, and nothing built for problems that don't exist yet. Every class has one job. Every function does one thing. Every abstraction earns its existence by serving at least two concrete uses.
