/**
 * Research Database — PostgreSQL connection pool + migration runner
 *
 * Borrowed from DeepCanyon's auth/db.ts pattern.
 * Handles: companies, relationships, catalysts, momentum, research signals,
 * theses, and outcomes. Uses pgvector for embedding-based similarity search.
 *
 * Trading tables (beliefs, closed_trades, system_buys, etc.) stay in SQLite
 * on the hot path. This PG layer is for the research/intelligence system
 * that needs graph joins, vector search, and scale.
 *
 * Config: DATABASE_URL env var (e.g. postgresql://user:pass@localhost:5432/mtwm_research)
 */

import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;

// ── Pool ──────────────────────────────────────────────────────────────────

function buildPoolConfig(): pg.PoolConfig {
  const connectionString = process.env.RESEARCH_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('RESEARCH_DATABASE_URL (or DATABASE_URL) environment variable is required for the research database');
  }

  const isLocal =
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1');

  return {
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    ssl: isLocal ? false : { rejectUnauthorized: true },
  };
}

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new Pool(buildPoolConfig());
    _pool.on('error', (err: Error) => {
      console.error('[research-db] Pool error:', err.message);
    });
  }
  return _pool;
}

// ── Query helper ──────────────────────────────────────────────────────────

export interface QueryResult<T extends Record<string, unknown> = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const pool = getPool();
  const result = await pool.query<T>(text, params);
  return { rows: result.rows, rowCount: result.rowCount };
}

// ── Migration runner ──────────────────────────────────────────────────────

const MIGRATIONS_DIR = resolve(
  fileURLToPath(import.meta.url),
  '..',
  'migrations',
);

export async function migrate(): Promise<void> {
  const pool = getPool();

  // Enable pgvector if available (silently skip if not installed)
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log('[research-db] pgvector extension enabled');
  } catch {
    console.warn('[research-db] pgvector not available — vector columns will be skipped');
  }

  // Bookkeeping table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const applied = await pool.query<{ name: string }>(
    'SELECT name FROM _migrations ORDER BY name',
  );
  const appliedSet = new Set(applied.rows.map((r: any) => r.name));

  let files: string[];
  try {
    files = (await readdir(MIGRATIONS_DIR))
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch {
    console.warn('[research-db] No migrations directory found');
    return;
  }

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[research-db] Applied migration: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[research-db] Migration failed: ${file}`, err);
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function shutdown(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
