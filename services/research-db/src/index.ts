/**
 * Research Database — public API
 *
 * Usage:
 *   import { initResearchDb, query, shutdown } from './research-db/src/index.js';
 *   await initResearchDb();  // runs migrations
 *   const { rows } = await query('SELECT * FROM companies WHERE sector = $1', ['Tech']);
 */

export { getPool, query, migrate, shutdown } from './db.js';
export type { QueryResult } from './db.js';

export async function initResearchDb(): Promise<void> {
  const { migrate } = await import('./db.js');
  await migrate();
  console.log('[research-db] Initialized');
}
