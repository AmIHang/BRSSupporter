import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

// src/db and dist/db are both two levels below the package root; the bundled daemon of the
// installed app has its own copy, passed in by the app.
const MIGRATIONS =
  process.env.BRSSUPPORTER_MIGRATIONS ?? fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Opens (and migrates) the database; `:memory:` for tests. */
export function openDatabase(file: string): { db: Db; close: () => void } {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => sqlite.close() };
}
