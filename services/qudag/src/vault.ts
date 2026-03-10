import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';

const ALGORITHM = 'aes-256-gcm';

// Resolve vault.db — try multiple known locations
function resolveVaultPath(): string {
  const candidates = [
    join(process.cwd(), '.claude-flow', 'data', 'vault.db'),           // from project root
    join(process.cwd(), '..', '.claude-flow', 'data', 'vault.db'),     // from services/
    join(process.cwd(), '..', '..', '.claude-flow', 'data', 'vault.db'), // from services/gateway/
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Fallback — create at project root candidate
  return candidates[0];
}

const DB_PATH = resolveVaultPath();

export class CredentialVault {
  private db: Database.Database;
  private key: Buffer;

  constructor(masterPassword: string) {
    const salt = 'mtwm_qudag_vault_v6'; // Deterministic for the same master password
    this.key = scryptSync(masterPassword, salt, 32);
    this.db = new Database(DB_PATH);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        category TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  encrypt(plaintext: string): { encrypted: string; iv: string; authTag: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return { encrypted, iv: iv.toString('hex'), authTag };
  }

  decrypt(encrypted: string, ivHex: string, authTagHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  store(id: string, name: string, value: string, category: string): void {
    const { encrypted, iv, authTag } = this.encrypt(value);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR REPLACE INTO credentials (id, name, encrypted_value, iv, auth_tag, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, encrypted, iv, authTag, category, now, now);
  }

  retrieve(id: string): string | null {
    const row = this.db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.decrypt(row.encrypted_value, row.iv, row.auth_tag);
  }

  list(category?: string): { id: string; name: string; category: string }[] {
    const query = category
      ? this.db.prepare('SELECT id, name, category FROM credentials WHERE category = ?')
      : this.db.prepare('SELECT id, name, category FROM credentials');
    return (category ? query.all(category) : query.all()) as any[];
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
  }

  close() {
    this.db.close();
  }
}
