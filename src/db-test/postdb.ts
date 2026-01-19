import { readFileSync } from 'fs';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

export type StateObject = Record<string, Record<string, unknown>[]>;

export type PostDBOptions = {
  /** Verify only these physical table names. Default: keys of `expected`. */
  only?: string[];
  /** If true, extra DB rows (after projection) are allowed. Default: false. */
  allowExtraRows?: boolean;
  /** If true, compare loosely (coerce values via String, Dates -> ISO). Default: false. */
  loose?: boolean;
};

// Utility functions for comparison
function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function normalizeValue(v: unknown, loose: boolean): unknown {
  if (v instanceof Date) return v.toISOString();
  return loose ? String(v) : v;
}

function normalizeRow(row: Record<string, unknown>, keys: string[], loose: boolean): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    normalized[key] = normalizeValue(row?.[key], loose);
  }
  return normalized;
}

// Create stable string representation for multiset comparison
function createStableKey(obj: Record<string, unknown>): string {
  const sortedKeys = Object.keys(obj).sort();
  const sortedObj: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sortedObj[key] = obj[key];
  }
  return JSON.stringify(sortedObj);
}

// Convert rows to multiset (Map<string, count>)
function toMultiset(rows: Record<string, unknown>[]): Map<string, number> {
  const multiset = new Map<string, number>();
  for (const row of rows) {
    const key = createStableKey(row);
    multiset.set(key, (multiset.get(key) ?? 0) + 1);
  }
  return multiset;
}

// Compare expected vs actual multisets and generate diff
function generateDiff(expected: Record<string, unknown>[], actual: Record<string, unknown>[]) {
  const expectedMultiset = toMultiset(expected);
  const actualMultiset = toMultiset(actual);
  const missing: Record<string, unknown>[] = [];
  const extra: Record<string, unknown>[] = [];

  // Find missing rows
  for (const [key, expectedCount] of expectedMultiset) {
    const actualCount = actualMultiset.get(key) ?? 0;
    for (let i = 0; i < expectedCount - actualCount; i++) {
      missing.push(JSON.parse(key));
    }
  }

  // Find extra rows
  for (const [key, actualCount] of actualMultiset) {
    const expectedCount = expectedMultiset.get(key) ?? 0;
    for (let i = 0; i < actualCount - expectedCount; i++) {
      extra.push(JSON.parse(key));
    }
  }

  return { missing, extra };
}

/**
 * PostDB - Assert that DB equals the expected JSON state
 *
 * - Projects actual rows to the union of keys present in the expected rows (subset-friendly)
 * - Compares as multisets (order-independent, duplicates respected)
 * - Throws with a per-table diff if mismatched; returns `true` if it passes
 *
 * @param db - Drizzle DB instance
 * @param schema - Drizzle schema object
 * @param expected - Desired state to assert
 * @param opts - Configuration options
 */
export async function PostDB<TSchema extends Record<string, unknown>>(
  db: LibSQLDatabase<TSchema>,
  schema: TSchema,
  expected: StateObject,
  opts?: PostDBOptions
): Promise<true> {
  const options = {
    allowExtraRows: false,
    loose: false,
    ...opts
  };

  // Build table map from schema using same pattern as PreState
  const tableMap = new Map<string, SQLiteTable>();
  for (const [, table] of Object.entries(schema)) {
    // Check if this is a Drizzle table by checking for the IsDrizzleTable symbol
    if (table && (table as Record<symbol, unknown>)[Symbol.for('drizzle:IsDrizzleTable')]) {
      // Get the table name from the drizzle:Name symbol
      const tableName = (table as Record<symbol, unknown>)[Symbol.for('drizzle:Name')] as string;
      if (tableName) {
        tableMap.set(tableName, table as SQLiteTable);
      }
    }
  }

  // Determine target tables
  const targetTables = options.only || Object.keys(expected);

  // Validate that all target tables exist in schema
  for (const tableName of targetTables) {
    if (!tableMap.has(tableName)) {
      throw new Error(`Table '${tableName}' not found in schema`);
    }
  }

  const errorLines: string[] = [];
  let hasErrors = false;

  for (const tableName of targetTables) {
    const table = tableMap.get(tableName)!;
    const expectedRows = expected[tableName] || [];

    // Compute union of expected keys (subset-friendly)
    const expectedKeys = Array.from(
      expectedRows.reduce((keySet, row) => {
        if (isObject(row)) {
          for (const key of Object.keys(row)) {
            keySet.add(key);
          }
        }
        return keySet;
      }, new Set<string>())
    );

    // Select all rows from DB
    const actualRowsFull = await db.select().from(table);

    // Project actual rows to expected keys and normalize
    const actualRows = actualRowsFull.map((row) =>
      normalizeRow(row as Record<string, unknown>, expectedKeys, options.loose)
    );

    // Normalize expected rows
    const normalizedExpected = expectedRows.map((row) =>
      normalizeRow(row, expectedKeys, options.loose)
    );

    // Generate diff
    const { missing, extra } = generateDiff(normalizedExpected, actualRows);

    // Check if this table passes
    const tablePasses = missing.length === 0 && (options.allowExtraRows || extra.length === 0);

    if (!tablePasses) {
      hasErrors = true;
      errorLines.push(`\nTable: ${tableName}`);
      errorLines.push(`Expected count: ${normalizedExpected.length}, Actual count: ${actualRows.length}`);

      if (missing.length > 0) {
        errorLines.push("Missing rows:");
        for (const row of missing) {
          errorLines.push("  - " + JSON.stringify(row));
        }
      }

      if (!options.allowExtraRows && extra.length > 0) {
        errorLines.push("Extra rows:");
        for (const row of extra) {
          errorLines.push("  - " + JSON.stringify(row));
        }
      }
    }
  }

  if (hasErrors) {
    throw new Error("PostDB assertion failed:" + errorLines.join("\n"));
  }

  return true;
}

/**
 * PostDBFromFile - Load JSON state from file and assert with PostDB
 *
 * @param db - Drizzle DB instance
 * @param schema - Drizzle schema object
 * @param filePath - Path to JSON file
 * @param opts - Configuration options
 */
export async function PostDBFromFile<TSchema extends Record<string, unknown>>(
  db: LibSQLDatabase<TSchema>,
  schema: TSchema,
  filePath: string,
  opts?: PostDBOptions
): Promise<true> {
  const fileContent = readFileSync(filePath, 'utf-8');
  const state = JSON.parse(fileContent) as StateObject;
  return PostDB(db, schema, state, opts);
}
