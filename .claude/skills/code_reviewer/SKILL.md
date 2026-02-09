---
name: code-review-partner
description: Code review partner that analyzes code and produces quality reports. Evaluates code against SOLID, Clean Code, nesting depth, function size, semantic loops, and common anti-patterns. Produces a structured review report without auto-fixing. Optimized for TypeScript and Python, applicable to all languages. Trigger after any code generation or when user requests code review.
---

# Code Review Partner

Analyze code and produce a review report. Do NOT auto-fix - report findings for human decision.

## Review Process

After generating or reviewing code, analyze against these principles in order:

### 1. Function Size & Structure
- **Max 50-60 lines per function** (one screen height)
- Single responsibility - one reason to change
- Max 3 parameters preferred
- Cyclomatic complexity should stay low
- Use paragraph style: group related lines with blank line separators

### 2. Nesting Depth
- **Max 2 levels of nesting**
- Identify arrow anti-pattern (code forming rightward arrow shape)
- Suggest guard clauses and early returns where applicable
- Note opportunities for method extraction

### 3. SOLID Principles
- **S**: Does each class/module have only one responsibility?
- **O**: Can behavior be extended without modifying existing code?
- **L**: Are subtypes truly substitutable for their base types?
- **I**: Are interfaces focused or bloated with unused methods?
- **D**: Does code depend on abstractions or concrete implementations?

### 4. Loop Selection
Flag generic index-based loops where semantic alternatives exist:
- Transforming items → map
- Filtering items → filter  
- Finding single item → find
- Checking conditions → some/every
- Accumulating → reduce
- Side effects only → forEach or for...of

Note: Traditional loops are valid for performance-critical code or complex index manipulation.

### 5. Clean Code
- **Naming**: Do names reveal intent? Are they pronounceable and searchable?
- **Magic values**: Are there unexplained literals that should be named constants?
- **Comments**: Does code explain itself, or are comments compensating for unclear code?
- **Dead code**: Is there unreachable or unused code?

### 6. DRY / KISS / YAGNI
- **DRY**: Is there duplicated logic that should be extracted?
- **KISS**: Is there unnecessary complexity?
- **YAGNI**: Is there speculative code for future needs that don't exist yet?

### 7. Anti-Patterns
Watch for: God objects, spaghetti code, cargo cult programming, premature optimization, hardcoded values, lava flow (dead code kept "just in case").

## TypeScript Specific
- Prefer `const` over `let` when value won't be reassigned
- Use strict equality and proper type narrowing
- Leverage optional chaining and nullish coalescing
- Prefer async/await over promise chains
- Use type guards over type assertions

## Python Specific
- Use type hints for function signatures
- Prefer list comprehensions for simple transformations (but not overly complex ones)
- Use context managers for resource handling
- Leverage f-strings for formatting
- Follow PEP 8 conventions

## Report Format

Produce this report structure after code analysis:

```
## Code Review Report

### Summary
[One sentence overall assessment]

### Critical Issues
[Problems that should be fixed - with file:line references]
- Issue description and which principle it violates

### Warnings  
[Improvements worth considering]
- Issue description and rationale

### Notes
[Minor observations or style suggestions]

### Metrics
- Longest function: [name] at [N] lines
- Max nesting depth: [N] levels in [location]
- Functions exceeding 50 lines: [count]
```

## Severity Guide

**Critical**: Functions >60 lines, nesting >3 levels, clear SOLID violations, obvious bugs
**Warning**: Nesting at 3 levels, suboptimal loop choice, missing type safety, magic values
**Note**: Style preferences, minor naming improvements, optional refactoring opportunities

## Important

- Report findings, do not automatically refactor
- Reference specific locations (file, function, line when possible)
- Explain WHY something is an issue, not just WHAT
- Acknowledge when trade-offs are reasonable
- Not every suggestion needs action - human decides priority
