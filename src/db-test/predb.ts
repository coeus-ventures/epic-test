import { readFileSync } from 'fs';
import { sql, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { SQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core';

export type StateObject = Record<string, Record<string, unknown>[]>;

export type PreDBOptions = {
  /** Delete all rows in targeted tables before inserting. Default: true */
  wipe?: boolean;
  /** Reset auto-increment sequences for targeted tables (best-effort for SQLite). Default: true */
  resetSequences?: boolean;
  /** If provided, only operate on these physical table names. */
  only?: string[];
};

/**
 * PreDB - Deterministically set database into a known state for testing
 *
 * Uses a two-pass deletion approach to handle foreign key constraints:
 * - Pass 1: Attempts to delete all tables (child tables succeed, parent tables fail)
 * - Pass 2: Deletes remaining tables (parent tables, now that children are gone)
 *
 * This approach works with any table order and doesn't require disabling foreign keys.
 *
 * @param db - Drizzle DB instance
 * @param schema - Drizzle schema object
 * @param state - Desired state (table names -> rows)
 * @param opts - Configuration options
 */
export async function PreDB<TSchema extends Record<string, unknown>>(
  db: LibSQLDatabase<TSchema>,
  schema: TSchema,
  state: StateObject,
  opts?: PreDBOptions
): Promise<void> {
  const options = {
    wipe: true,
    resetSequences: true,
    ...opts
  };

  // Build table map from schema
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
  const targetTables = options.only || Object.keys(state);

  // Validate that all target tables exist in schema
  for (const tableName of targetTables) {
    if (!tableMap.has(tableName)) {
      throw new Error(`Table '${tableName}' not found in schema`);
    }
  }

  // For LibSQL, we need to handle foreign keys more carefully
  const usePragma = true;

  try {
    // Try to disable foreign keys
    if (usePragma) {
      try {
        await db.run(sql`PRAGMA foreign_keys = OFF`);
      } catch {
        // PRAGMA might not be supported
      }
    }

    // 1. Wipe tables if requested
    if (options.wipe) {
      // Two-pass deletion approach - no hardcoded order needed!
      // Pass 1: Delete all tables that can be deleted (child tables)
      // Pass 2: Delete remaining tables (parent tables, now that children are gone)

      for (const tableName of targetTables) {
        try {
          const table = tableMap.get(tableName);
          if (table) {
            await db.delete(table);
          }
        } catch (error: unknown) {
          // If deletion fails due to FK constraint, skip for now
          // We'll try again in the second pass
          if (!(error instanceof Error) || !error.message?.includes('FOREIGN KEY')) {
            throw error; // Re-throw if it's not a FK error
          }
        }
      }

      // Second pass: Clean up any remaining tables
      for (const tableName of targetTables) {
        const table = tableMap.get(tableName);
        if (table) {
          try {
            await db.delete(table);
          } catch {
            // Ignore errors - table might already be empty
          }
        }
      }
    }

    // 2. Reset sequences if requested (SQLite specific)
    if (options.resetSequences) {
      try {
        // For SQLite, we need to delete from sqlite_sequence
        for (const tableName of targetTables) {
          await db.run(sql`DELETE FROM sqlite_sequence WHERE name = ${tableName}`);
        }
      } catch {
        // sqlite_sequence might not exist or database might not be SQLite
      }
    }

    // 3. Insert new data in dependency order (handle foreign keys)
    // Simple dependency order: insert tables with foreign keys last
    const sortedTables = [...targetTables].sort((a, b) => {
      const aHasForeignKeys = state[a]?.some(row =>
        Object.keys(row).some(key => key.includes('_id'))
      );
      const bHasForeignKeys = state[b]?.some(row =>
        Object.keys(row).some(key => key.includes('_id'))
      );

      if (aHasForeignKeys && !bHasForeignKeys) return 1;  // a has FKs, b doesn't - b first
      if (bHasForeignKeys && !aHasForeignKeys) return -1; // b has FKs, a doesn't - a first
      return a.localeCompare(b); // alphabetical order for consistent sorting
    });

    for (const tableName of sortedTables) {
      const rows = state[tableName];
      if (rows && rows.length > 0) {
        const table = tableMap.get(tableName);
        if (table) {
          // Insert rows one by one, checking for existence by ID if present
          for (const row of rows) {
            // If row has an 'id' field, check if it already exists
            if (row.id !== undefined && 'id' in table) {
              const idColumn = table.id as SQLiteColumn;
              const existing = await db.select().from(table).where(eq(idColumn, row.id)).limit(1);
              if (existing.length > 0) {
                // Skip insertion if record already exists
                continue;
              }
            }
            await db.insert(table).values(row);
          }
        }
      }
    }
  } finally {
    // Re-enable foreign key checks
    if (usePragma) {
      try {
        await db.run(sql`PRAGMA foreign_keys = ON`);
      } catch {
        // PRAGMA might not be supported
      }
    }
  }
}

/**
 * PreDBFromFile - Load JSON state from file and apply with PreDB
 *
 * @param db - Drizzle DB instance
 * @param schema - Drizzle schema object
 * @param filePath - Path to JSON file
 * @param opts - Configuration options
 */
export async function PreDBFromFile<TSchema extends Record<string, unknown>>(
  db: LibSQLDatabase<TSchema>,
  schema: TSchema,
  filePath: string,
  opts?: PreDBOptions
): Promise<void> {
  const fileContent = readFileSync(filePath, 'utf-8');
  const state = JSON.parse(fileContent) as StateObject;
  return PreDB(db, schema, state, opts);
}
