import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { PreDB } from "../predb";

// Minimal schema
const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});

const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
});

const schema = { users, posts };

describe("PreDB", () => {
  const client = createClient({
    url: ":memory:"
  });
  const db = drizzle(client, { schema });

  beforeAll(async () => {
    // Create tables
    await db.run(sql`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `);

    await db.run(sql`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);
  });

  beforeEach(async () => {
    // Clean up tables before each test
    await db.run(sql`DELETE FROM posts`);
    await db.run(sql`DELETE FROM users`);
    await db.run(sql`DELETE FROM sqlite_sequence WHERE name IN ('users', 'posts')`);
  });

  it("wipes, resets sequences, and inserts rows declaratively", async () => {
    // First add some junk data with explicit IDs
    await db.insert(users).values({ id: 999, name: 'junk' });
    await db.insert(posts).values({ id: 999, userId: 999, title: 'junk' });

    const state = {
      users: [
        { id: 1, name: "Ed" },
        { id: 2, name: "Luiz" }
      ],
      posts: [{ id: 10, userId: 1, title: "Hello" }]
    };

    await PreDB(db, schema, state);

    const usersNow = await db.select().from(users).orderBy(users.id);
    expect(usersNow).toEqual([
      { id: 1, name: "Ed" },
      { id: 2, name: "Luiz" }
    ]);

    const postsNow = await db.select({ id: posts.id, user_id: posts.userId, title: posts.title }).from(posts);
    expect(postsNow).toEqual([{ id: 10, user_id: 1, title: "Hello" }]);
  });

  it("respects the 'wipe' option when false", async () => {
    // Set initial state
    await PreDB(db, schema, {
      users: [{ id: 1, name: "Initial" }],
      posts: []
    });

    // Add more data without wiping
    await PreDB(db, schema, {
      users: [{ id: 2, name: "Added" }],
      posts: []
    }, { wipe: false });

    const usersNow = await db.select().from(users).orderBy(users.id);
    expect(usersNow).toEqual([
      { id: 1, name: "Initial" },
      { id: 2, name: "Added" }
    ]);
  });

  it("respects the 'only' option to target specific tables", async () => {
    // Set initial state in both tables
    await PreDB(db, schema, {
      users: [{ id: 1, name: "User1" }],
      posts: [{ id: 1, userId: 1, title: "Post1" }]
    });

    // Only wipe and reset users table
    await PreDB(db, schema, {
      users: [{ id: 2, name: "User2" }]
    }, { only: ["users"] });

    const usersNow = await db.select().from(users).orderBy(users.id);
    expect(usersNow).toEqual([{ id: 2, name: "User2" }]);

    // Posts should remain unchanged
    const postsNow = await db.select({ id: posts.id, user_id: posts.userId, title: posts.title }).from(posts);
    expect(postsNow).toEqual([{ id: 1, user_id: 1, title: "Post1" }]);
  });

  it("throws an error for non-existent table", async () => {
    const state = {
      nonexistent: [{ id: 1, name: "test" }]
    };

    await expect(PreDB(db, schema, state)).rejects.toThrow(
      "Table 'nonexistent' not found in schema"
    );
  });

  it("handles empty state objects", async () => {
    // Add some data first with specific IDs (use unique IDs to avoid conflicts)
    await db.insert(users).values({ id: 500, name: 'ToBeDeleted' });
    await db.insert(posts).values({ id: 500, userId: 500, title: 'ToBeDeleted' });

    // Clear all targeted tables
    await PreDB(db, schema, {
      users: [],
      posts: []
    });

    const usersNow = await db.select().from(users);
    expect(usersNow).toEqual([]);

    const postsNow = await db.select().from(posts);
    expect(postsNow).toEqual([]);
  });
});
