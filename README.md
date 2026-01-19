# epic-test

A collection of AI-powered testing utilities for modern applications.

## Libraries

This package includes three testing libraries:

| Library | Purpose |
|---------|---------|
| **spec-test** | Specification-driven browser testing with AI-powered automation |
| **b-test** | LLM-powered browser assertions with HTML snapshot diffing |
| **db-test** | Database state management for deterministic testing |

## Installation

```bash
npm install epic-test
# or
pnpm add epic-test
# or
bun add epic-test
```

### Peer Dependencies

Depending on which libraries you use, you may need:

```bash
# For spec-test and b-test (browser testing)
npm install playwright

# For db-test (database testing)
npm install @libsql/client
```

## Quick Start

### spec-test - Specification-Driven Browser Testing

Write behavior specifications in markdown and execute them as browser tests:

```typescript
import { SpecTestRunner } from 'epic-test';

const runner = new SpecTestRunner({
  baseUrl: 'http://localhost:3000',
  headless: true,
});

// Run tests from a markdown spec file
const result = await runner.runFromFile('./specs/login.md');

if (result.success) {
  console.log('All tests passed!');
} else {
  console.log('Tests failed:', result.failedAt?.context.error);
}

await runner.close();
```

**Spec file format (login.md):**

```markdown
# Login

## Examples

### Login with valid credentials

#### Steps
* Act: User enters "user@example.com" in email field
* Act: User enters "password123" in password field
* Act: User clicks Login button
* Check: URL contains /dashboard
* Check: Welcome message is displayed
```

### b-test - LLM-Powered Browser Assertions

Use natural language to assert page conditions:

```typescript
import { chromium } from 'playwright';
import { Tester } from 'epic-test/b-test';

const browser = await chromium.launch();
const page = await browser.newPage();
const tester = new Tester(page);

await page.goto('https://example.com');

// Take snapshots and assert with natural language
await tester.snapshot();
await page.click('button.submit');
await tester.snapshot();

const hasSuccessMessage = await tester.assert('Success message is displayed');
```

### db-test - Database State Management

Set up and verify database state for deterministic tests:

```typescript
import { PreDB, PostDB } from 'epic-test/db-test';
import { db } from './db';
import * as schema from './schema';

// Setup: Set initial database state
await PreDB(db, schema, {
  users: [{ id: 1, name: 'Alice', email: 'alice@example.com' }]
});

// Act: Run the code being tested
await createUser({ name: 'Bob', email: 'bob@example.com' });

// Assert: Verify final database state
await PostDB(db, schema, {
  users: [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' }
  ]
});
```

---

## spec-test

A specification-driven testing library that parses behavior specifications and executes them as browser tests using AI-powered automation.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        spec-test Library                        │
├─────────────────────────────────────────────────────────────────┤
│  parseSpecFile  →  SpecTestRunner  →  ExampleResult             │
│                                                                  │
│              ┌──────────────┴──────────────┐                    │
│              │                             │                    │
│       ┌──────▼──────┐           ┌──────────▼────────┐           │
│       │  Stagehand  │           │      B-Test       │           │
│       │ (Act steps) │           │  (Check steps)    │           │
│       │ AI browser  │           │  LLM assertions   │           │
│       └─────────────┘           └───────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### Epic Specification Format

```markdown
# Behavior Name

Description of the behavior.

Directory: `app/features/my-feature/`

## Examples

### Example scenario name

#### Steps
* Act: User performs some action
* Act: User fills in "value" in field name
* Check: URL contains /expected-path
* Check: Success message is displayed
```

### Step Types

**Act Steps** - User actions executed with Stagehand AI:
```markdown
* Act: User clicks the Login button
* Act: User enters "user@example.com" in email field
* Act: User selects "Admin" from the role dropdown
```

**Check Steps** - Verifications (deterministic or semantic):
```markdown
# Deterministic (fast, no AI):
* Check: URL contains /dashboard
* Check: Page title is "Dashboard"

# Semantic (LLM-powered):
* Check: Success notification is displayed
* Check: Error message shows "Invalid credentials"
```

### Configuration

```typescript
interface SpecTestConfig {
  baseUrl: string;              // Required - app URL
  headless?: boolean;           // Default: true
  aiModel?: LanguageModelV2;    // Override AI model
  browserbaseApiKey?: string;   // Cloud browser execution
  cacheDir?: string;            // Enable action caching
  cachePerSpec?: boolean;       // Per-spec cache directories
}
```

### Caching

Enable caching for faster subsequent runs:

```typescript
const runner = new SpecTestRunner({
  baseUrl: 'http://localhost:3000',
  cacheDir: './cache/e2e-tests',
});

// First run: ~30s per action (LLM inference)
// Subsequent runs: ~3s per action (cached)
```

---

## b-test

LLM-powered browser testing utilities with HTML snapshot capture and natural language assertions.

### Features

- **HTML Snapshots**: Capture full page HTML with timestamps
- **LLM Assertions**: Use natural language to assert conditions
- **Snapshot Comparison**: Generate structured diffs between states
- **Polling**: Wait for conditions with intelligent polling

### API

```typescript
const tester = new Tester(page);

// Capture snapshots
await tester.snapshot();

// Assert conditions
const result = await tester.assert('Login form is visible');

// Compare page states
const diff = await tester.diff();

// Wait for conditions
await tester.waitFor('Loading spinner is gone', 10000);
```

### Error Codes

| Code | Description |
|------|-------------|
| `NO_PAGE` | No page provided |
| `NO_SNAPSHOT` | No snapshot for assertion |
| `SNAPSHOT_FAILED` | Failed to capture page |
| `ASSERTION_FAILED` | LLM service error |
| `DIFF_FAILED` | Comparison error |
| `WAIT_TIMEOUT` | Condition timeout |

---

## db-test

Database testing utilities for deterministic state management with Drizzle ORM.

### PreDB - Setup Initial State

```typescript
await PreDB(db, schema, {
  users: [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' }
  ],
  posts: [
    { id: 1, userId: 1, title: 'First Post' }
  ]
});
```

**Options:**
```typescript
{
  wipe?: boolean;           // Delete existing rows (default: true)
  resetSequences?: boolean; // Reset auto-increment (default: true)
  only?: string[];          // Target specific tables
}
```

### PostDB - Verify Final State

```typescript
await PostDB(db, schema, {
  users: [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Charlie' }  // New user from test
  ]
});
```

**Options:**
```typescript
{
  only?: string[];         // Target specific tables
  allowExtraRows?: boolean; // Allow extra DB rows (default: false)
  loose?: boolean;         // Loose comparison (default: false)
}
```

### Load from JSON Files

```typescript
await PreDBFromFile(db, schema, './fixtures/initial-state.json');
// ... run test ...
await PostDBFromFile(db, schema, './fixtures/expected-state.json');
```

---

## Environment Variables

| Variable | Library | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | spec-test, b-test | Required for AI-powered features |
| `BROWSERBASE_API_KEY` | spec-test | Cloud browser execution |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run integration tests
npm run test:integration
```

## License

MIT
