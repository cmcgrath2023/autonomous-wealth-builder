import Database from 'better-sqlite3';
import { join } from 'path';
import { WitnessRecord } from '../../shared/types/index.js';
import { createWitnessRecord, verifyChain, GENESIS_HASH } from '../../shared/crypto/witness.js';
import { eventBus } from '../../shared/utils/event-bus.js';

const DB_PATH = join(process.cwd(), '..', '.claude-flow', 'data', 'witness.db');

export class WitnessChain {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS witness_chain (
        hash TEXT PRIMARY KEY,
        previous_hash TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        module TEXT NOT NULL,
        payload TEXT NOT NULL,
        signature TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_witness_timestamp ON witness_chain(timestamp);
      CREATE INDEX IF NOT EXISTS idx_witness_module ON witness_chain(module);
    `);

    // Insert genesis block if empty
    const count = this.db.prepare('SELECT COUNT(*) as count FROM witness_chain').get() as any;
    if (count.count === 0) {
      const genesis = createWitnessRecord('genesis', 'system', 'qudag', { version: '6.0', system: 'MTWM' }, GENESIS_HASH);
      this.insertRecord(genesis);
    }
  }

  private insertRecord(record: WitnessRecord) {
    this.db.prepare(`
      INSERT INTO witness_chain (hash, previous_hash, timestamp, action, actor, module, payload, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.hash,
      record.previousHash,
      record.timestamp instanceof Date ? record.timestamp.toISOString() : record.timestamp,
      record.action,
      record.actor,
      record.module,
      record.payload,
      record.signature || null
    );
  }

  getLatestHash(): string {
    const row = this.db.prepare('SELECT hash FROM witness_chain ORDER BY timestamp DESC LIMIT 1').get() as any;
    return row?.hash || GENESIS_HASH;
  }

  record(action: string, actor: string, module: string, payload: Record<string, unknown>): WitnessRecord {
    const previousHash = this.getLatestHash();
    const record = createWitnessRecord(action, actor, module, payload, previousHash);
    this.insertRecord(record);
    eventBus.emit('witness:recorded', { hash: record.hash, action });
    return record;
  }

  getHistory(module?: string, limit = 50): WitnessRecord[] {
    const query = module
      ? this.db.prepare('SELECT * FROM witness_chain WHERE module = ? ORDER BY timestamp DESC LIMIT ?')
      : this.db.prepare('SELECT * FROM witness_chain ORDER BY timestamp DESC LIMIT ?');
    const rows = (module ? query.all(module, limit) : query.all(limit)) as any[];
    return rows.map((r) => ({
      hash: r.hash,
      previousHash: r.previous_hash,
      timestamp: new Date(r.timestamp),
      action: r.action,
      actor: r.actor,
      module: r.module,
      payload: r.payload,
      signature: r.signature,
    }));
  }

  verify(limit = 100): { valid: boolean; brokenAt?: number; checked: number } {
    const records = this.getHistory(undefined, limit).reverse();
    const result = verifyChain(records);
    return { ...result, checked: records.length };
  }

  getByHash(hash: string): WitnessRecord | null {
    const row = this.db.prepare('SELECT * FROM witness_chain WHERE hash = ?').get(hash) as any;
    if (!row) return null;
    return {
      hash: row.hash,
      previousHash: row.previous_hash,
      timestamp: new Date(row.timestamp),
      action: row.action,
      actor: row.actor,
      module: row.module,
      payload: row.payload,
      signature: row.signature,
    };
  }

  close() {
    this.db.close();
  }
}
