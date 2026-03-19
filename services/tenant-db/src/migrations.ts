/**
 * Tenant Database Migrations
 *
 * Creates all tables and indexes for the tenant database.
 * Safe to call multiple times (uses IF NOT EXISTS).
 */

import type Database from 'better-sqlite3';
import { ALL_TABLES, INDEXES } from './schema.js';

/**
 * Initialize the full tenant database schema.
 * Runs inside a transaction for atomicity.
 */
export function createTables(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const migrate = db.transaction(() => {
    for (const ddl of ALL_TABLES) {
      db.exec(ddl);
    }
    for (const idx of INDEXES) {
      db.exec(idx);
    }
  });

  migrate();
}
