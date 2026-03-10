import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { join } from 'path';
import { computeHash } from '../../shared/crypto/witness.js';

const DB_PATH = join(process.cwd(), '..', '.claude-flow', 'data', 'rvf.db');

export interface RVFContainer {
  id: string;
  version: number;
  type: 'property' | 'strategy' | 'portfolio' | 'decision' | 'agent_config' | 'knowledge' | 'roadmap' | 'learning';
  name: string;
  payload: Record<string, unknown>;
  witnessHash: string;
  parentHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RVFSnapshot {
  containerId: string;
  version: number;
  payload: string; // JSON
  hash: string;
  previousHash: string;
  timestamp: string;
}

export class RVFEngine {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rvf_containers (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        witness_hash TEXT NOT NULL,
        parent_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rvf_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        hash TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (container_id) REFERENCES rvf_containers(id)
      );

      CREATE INDEX IF NOT EXISTS idx_rvf_type ON rvf_containers(type);
      CREATE INDEX IF NOT EXISTS idx_rvf_snapshots_container ON rvf_snapshots(container_id);
    `);
  }

  create(type: RVFContainer['type'], name: string, payload: Record<string, unknown>): RVFContainer {
    const id = `rvf-${type.slice(0, 4)}-${uuid().slice(0, 8)}`;
    const now = new Date().toISOString();
    const payloadStr = JSON.stringify(payload);
    const witnessHash = computeHash(`${id}|${now}|${payloadStr}`);

    const container: RVFContainer = {
      id,
      version: 1,
      type,
      name,
      payload,
      witnessHash,
      parentHash: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO rvf_containers (id, version, type, name, payload, witness_hash, parent_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, 1, type, name, payloadStr, witnessHash, null, now, now);

    // Create initial snapshot
    this.createSnapshot(id, 1, payloadStr, witnessHash);

    return container;
  }

  update(id: string, payload: Record<string, unknown>): RVFContainer | null {
    const existing = this.get(id);
    if (!existing) return null;

    const newVersion = existing.version + 1;
    const now = new Date().toISOString();
    const payloadStr = JSON.stringify(payload);
    const witnessHash = computeHash(`${id}|${now}|${newVersion}|${payloadStr}|${existing.witnessHash}`);

    this.db.prepare(`
      UPDATE rvf_containers SET version = ?, payload = ?, witness_hash = ?, parent_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(newVersion, payloadStr, witnessHash, existing.witnessHash, now, id);

    this.createSnapshot(id, newVersion, payloadStr, witnessHash);

    return { ...existing, version: newVersion, payload, witnessHash, parentHash: existing.witnessHash, updatedAt: now };
  }

  get(id: string): RVFContainer | null {
    const row = this.db.prepare('SELECT * FROM rvf_containers WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      version: row.version,
      type: row.type,
      name: row.name,
      payload: JSON.parse(row.payload),
      witnessHash: row.witness_hash,
      parentHash: row.parent_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(type?: string): RVFContainer[] {
    const query = type
      ? this.db.prepare('SELECT * FROM rvf_containers WHERE type = ? ORDER BY updated_at DESC')
      : this.db.prepare('SELECT * FROM rvf_containers ORDER BY updated_at DESC');
    const rows = (type ? query.all(type) : query.all()) as any[];
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      type: r.type,
      name: r.name,
      payload: JSON.parse(r.payload),
      witnessHash: r.witness_hash,
      parentHash: r.parent_hash,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  getHistory(id: string): RVFSnapshot[] {
    const rows = this.db.prepare('SELECT * FROM rvf_snapshots WHERE container_id = ? ORDER BY version DESC').all(id) as any[];
    return rows.map((r) => ({
      containerId: r.container_id,
      version: r.version,
      payload: r.payload,
      hash: r.hash,
      previousHash: r.previous_hash,
      timestamp: r.timestamp,
    }));
  }

  verify(id: string): { valid: boolean; versions: number } {
    const snapshots = this.getHistory(id).reverse();
    for (let i = 1; i < snapshots.length; i++) {
      if (snapshots[i].previousHash !== snapshots[i - 1].hash) {
        return { valid: false, versions: snapshots.length };
      }
    }
    return { valid: true, versions: snapshots.length };
  }

  private createSnapshot(containerId: string, version: number, payload: string, hash: string) {
    const prev = this.db.prepare('SELECT hash FROM rvf_snapshots WHERE container_id = ? ORDER BY version DESC LIMIT 1').get(containerId) as any;
    const previousHash = prev?.hash || computeHash('RVF_GENESIS');
    this.db.prepare(`
      INSERT INTO rvf_snapshots (container_id, version, payload, hash, previous_hash, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(containerId, version, payload, hash, previousHash, new Date().toISOString());
  }

  search(query: string, type?: string): RVFContainer[] {
    const q = `%${query.toLowerCase()}%`;
    const sql = type
      ? `SELECT * FROM rvf_containers WHERE type = ? AND (LOWER(name) LIKE ? OR LOWER(payload) LIKE ?) ORDER BY updated_at DESC`
      : `SELECT * FROM rvf_containers WHERE (LOWER(name) LIKE ? OR LOWER(payload) LIKE ?) ORDER BY updated_at DESC`;
    const rows = (type
      ? this.db.prepare(sql).all(type, q, q)
      : this.db.prepare(sql).all(q, q)) as any[];
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      type: r.type,
      name: r.name,
      payload: JSON.parse(r.payload),
      witnessHash: r.witness_hash,
      parentHash: r.parent_hash,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // Daily portfolio snapshot
  snapshotPortfolio(portfolioData: Record<string, unknown>): RVFContainer {
    const today = new Date().toISOString().slice(0, 10);
    const existing = this.db.prepare("SELECT * FROM rvf_containers WHERE type = 'portfolio' AND name = ?").get(`portfolio-${today}`) as any;
    if (existing) {
      return this.update(existing.id, portfolioData)!;
    }
    return this.create('portfolio', `portfolio-${today}`, portfolioData);
  }

  close() {
    this.db.close();
  }
}
