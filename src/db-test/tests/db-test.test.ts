import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { PreDB } from "../predb";
import { PostDB } from "../postdb";

// Schema for integration testing
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

describe("PreDB + PostDB Integration", () => {
  const client = createClient({ url: ":memory:" });
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

  it("works together for deterministic testing workflow", async () => {
    // 1. Set up initial state with PreDB
    await PreDB(db, schema, {
      users: [{ id: 1, name: "Ed" }],
      posts: []
    });

    // 2. Verify initial state with PostDB
    await expect(
      PostDB(db, schema, {
        users: [{ id: 1, name: "Ed" }],
        posts: []
      })
    ).resolves.toBe(true);

    // 3. Simulate creating a post (manual insert for this test)
    await db.insert(posts).values({ id: 10, userId: 1, title: "Hello world" });

    // 4. Assert the final state with PostDB
    await expect(
      PostDB(db, schema, {
        users: [{ id: 1, name: "Ed" }],
        posts: [{ id: 10, userId: 1, title: "Hello world" }]
      })
    ).resolves.toBe(true);
  });

  it("supports subset assertions in PostDB after PreDB setup", async () => {
    // Set up state with all columns
    await PreDB(db, schema, {
      users: [{ id: 1, name: "Ed" }, { id: 2, name: "Luiz" }],
      posts: [{ id: 20, userId: 1, title: "First post" }, { id: 21, userId: 2, title: "Second post" }]
    });

    // Assert with subset (only checking id and userId, ignoring title)
    await expect(
      PostDB(db, schema, {
        posts: [{ id: 20, userId: 1 }, { id: 21, userId: 2 }]
      })
    ).resolves.toBe(true);
  });

  it("detects changes correctly", async () => {
    // Set up initial state
    await PreDB(db, schema, {
      users: [{ id: 1, name: "Ed" }],
      posts: [{ id: 30, userId: 1, title: "Original title" }]
    });

    // Simulate updating the post title
    await db.run(sql`UPDATE posts SET title = 'Updated title' WHERE id = 30`);

    // PostDB should detect the change
    await expect(
      PostDB(db, schema, {
        posts: [{ id: 30, userId: 1, title: "Original title" }] // This should fail
      })
    ).rejects.toThrow(/PostDB assertion failed:/);

    // But should pass with the correct new title
    await expect(
      PostDB(db, schema, {
        posts: [{ id: 30, userId: 1, title: "Updated title" }]
      })
    ).resolves.toBe(true);
  });
});
