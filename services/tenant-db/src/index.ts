/**
 * TenantDB — Multi-tenant data layer backed by SQLite (better-sqlite3).
 *
 * Handles tenant CRUD, encrypted credential storage (AES-256-GCM via scryptSync),
 * config, Bayesian beliefs, trade history, reports, and subscription gating.
 *
 * DB file: data/tenants.db (relative to project root).
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import Database from 'better-sqlite3';
import { createTables } from './migrations.js';
import type {
  TenantRow,
  TenantCredentialRow,
  TenantConfigRow,
  TenantBeliefRow,
  TenantTradeRow,
  TenantReportRow,
} from './schema.js';

// ── Encryption constants ───────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const SCRYPT_SALT = 'mtwm_tenant_vault_v1';

// ── Public input types ─────────────────────────────────────────────────

export interface CreateTenantInput {
  id: string;
  email: string;
  name: string;
  tier?: 'free' | 'hosted' | 'pro';
  trialDays?: number;
}

export interface SaveCredentialsInput {
  tenantId: string;
  broker: string;
  apiKey: string;
  apiSecret: string;
  accountId?: string;
  mode?: 'paper' | 'live';
}

export interface DecryptedCredentials {
  broker: string;
  apiKey: string;
  apiSecret: string;
  accountId: string | null;
  mode: 'paper' | 'live';
}

export interface SaveConfigInput {
  tenantId: string;
  simulatedCapital?: number;
  maxPositions?: number;
  cryptoPct?: number;
  equityPct?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  dailyGoal?: number;
  autonomyLevel?: number;
  heartbeatMs?: number;
}

export interface SaveBeliefInput {
  tenantId: string;
  beliefId: string;
  domain: string;
  subject: string;
  alpha: number;
  beta: number;
  observations: number;
  avgReturn: number;
  tags?: string[];
}

export interface RecordTradeInput {
  tenantId: string;
  ticker: string;
  direction: 'long' | 'short';
  entryPrice: number;
  exitPrice?: number;
  qty: number;
  pnl?: number;
  openedAt?: string;
  closedAt?: string;
  reason?: string;
  strategy?: string;
}

// ── Resolve DB path ────────────────────────────────────────────────────

function resolveDbPath(): string {
  const candidates = [
    join(process.cwd(), 'data', 'tenants.db'),
    join(process.cwd(), '..', 'data', 'tenants.db'),
    join(process.cwd(), '..', '..', 'data', 'tenants.db'),
  ];
  for (const p of candidates) {
    if (existsSync(dirname(p))) return p;
  }
  return candidates[0];
}

// ── TenantDB class ────────────────────────────────────────────────────

export class TenantDB {
  private db: Database.Database;
  private encKey: Buffer;

  /**
   * @param masterPassword  Password used to derive AES-256 encryption key via scrypt
   * @param dbPath          Override the default data/tenants.db location
   */
  constructor(masterPassword: string, dbPath?: string) {
    this.encKey = scryptSync(masterPassword, SCRYPT_SALT, 32);

    const resolvedPath = dbPath ?? resolveDbPath();
    const dir = dirname(resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    createTables(this.db);
  }

  // ── Encryption helpers ─────────────────────────────────────────────

  private encrypt(plaintext: string): { encrypted: string; iv: string; authTag: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, this.encKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return { encrypted, iv: iv.toString('hex'), authTag };
  }

  private decrypt(encrypted: string, ivHex: string, authTagHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, this.encKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // ── Tenants ────────────────────────────────────────────────────────

  createTenant(input: CreateTenantInput): TenantRow {
    const now = new Date().toISOString();
    const tier = input.tier ?? 'hosted';
    const trialDays = input.trialDays ?? 3;

    let trialEndsAt: string | null = null;
    let subscriptionStatus: TenantRow['subscription_status'] = 'none';

    if (tier === 'hosted' || tier === 'pro') {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + trialDays);
      trialEndsAt = trialEnd.toISOString();
      subscriptionStatus = 'trialing';
    }

    this.db.prepare(`
      INSERT INTO tenants (id, email, name, tier, trial_ends_at, subscription_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.email, input.name, tier, trialEndsAt, subscriptionStatus, now, now);

    return this.getTenant(input.id)!;
  }

  getTenant(id: string): TenantRow | null {
    const row = this.db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as TenantRow | undefined;
    return row ?? null;
  }

  getTenantByEmail(email: string): TenantRow | null {
    const row = this.db.prepare('SELECT * FROM tenants WHERE email = ?').get(email) as TenantRow | undefined;
    return row ?? null;
  }

  getActiveTenants(): TenantRow[] {
    return this.db.prepare(`
      SELECT * FROM tenants
      WHERE subscription_status IN ('active', 'trialing')
         OR (trial_ends_at IS NOT NULL AND trial_ends_at > datetime('now'))
    `).all() as TenantRow[];
  }

  // ── Credentials (encrypted) ───────────────────────────────────────

  saveTenantCredentials(input: SaveCredentialsInput): void {
    const now = new Date().toISOString();
    const keyEnc = this.encrypt(input.apiKey);
    const secretEnc = this.encrypt(input.apiSecret);

    this.db.prepare(`
      INSERT OR REPLACE INTO tenant_credentials
        (tenant_id, broker, encrypted_key, encrypted_secret,
         iv_key, auth_tag_key, iv_secret, auth_tag_secret,
         account_id, mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.tenantId,
      input.broker,
      keyEnc.encrypted, secretEnc.encrypted,
      keyEnc.iv, keyEnc.authTag,
      secretEnc.iv, secretEnc.authTag,
      input.accountId ?? null,
      input.mode ?? 'paper',
      now, now,
    );
  }

  getTenantCredentials(tenantId: string, broker: string): DecryptedCredentials | null {
    const row = this.db.prepare(
      'SELECT * FROM tenant_credentials WHERE tenant_id = ? AND broker = ?',
    ).get(tenantId, broker) as TenantCredentialRow | undefined;

    if (!row) return null;

    return {
      broker: row.broker,
      apiKey: this.decrypt(row.encrypted_key, row.iv_key, row.auth_tag_key),
      apiSecret: this.decrypt(row.encrypted_secret, row.iv_secret, row.auth_tag_secret),
      accountId: row.account_id,
      mode: row.mode as 'paper' | 'live',
    };
  }

  listTenantBrokers(tenantId: string): string[] {
    const rows = this.db.prepare(
      'SELECT broker FROM tenant_credentials WHERE tenant_id = ?',
    ).all(tenantId) as { broker: string }[];
    return rows.map(r => r.broker);
  }

  // ── Config ─────────────────────────────────────────────────────────

  saveTenantConfig(input: SaveConfigInput): void {
    const now = new Date().toISOString();
    const existing = this.getTenantConfig(input.tenantId);

    if (existing) {
      this.db.prepare(`
        UPDATE tenant_config SET
          simulated_capital = ?, max_positions = ?, crypto_pct = ?, equity_pct = ?,
          stop_loss_pct = ?, take_profit_pct = ?, daily_goal = ?,
          autonomy_level = ?, heartbeat_ms = ?, updated_at = ?
        WHERE tenant_id = ?
      `).run(
        input.simulatedCapital ?? existing.simulated_capital,
        input.maxPositions ?? existing.max_positions,
        input.cryptoPct ?? existing.crypto_pct,
        input.equityPct ?? existing.equity_pct,
        input.stopLossPct ?? existing.stop_loss_pct,
        input.takeProfitPct ?? existing.take_profit_pct,
        input.dailyGoal ?? existing.daily_goal,
        input.autonomyLevel ?? existing.autonomy_level,
        input.heartbeatMs ?? existing.heartbeat_ms,
        now,
        input.tenantId,
      );
    } else {
      this.db.prepare(`
        INSERT INTO tenant_config
          (tenant_id, simulated_capital, max_positions, crypto_pct, equity_pct,
           stop_loss_pct, take_profit_pct, daily_goal, autonomy_level, heartbeat_ms, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.tenantId,
        input.simulatedCapital ?? 100000,
        input.maxPositions ?? 5,
        input.cryptoPct ?? 0.3,
        input.equityPct ?? 0.7,
        input.stopLossPct ?? 0.02,
        input.takeProfitPct ?? 0.05,
        input.dailyGoal ?? 50,
        input.autonomyLevel ?? 3,
        input.heartbeatMs ?? 30000,
        now,
      );
    }
  }

  getTenantConfig(tenantId: string): TenantConfigRow | null {
    const row = this.db.prepare(
      'SELECT * FROM tenant_config WHERE tenant_id = ?',
    ).get(tenantId) as TenantConfigRow | undefined;
    return row ?? null;
  }

  // ── Beliefs ────────────────────────────────────────────────────────

  saveBelief(input: SaveBeliefInput): void {
    const now = new Date().toISOString();
    const tags = JSON.stringify(input.tags ?? []);

    this.db.prepare(`
      INSERT OR REPLACE INTO tenant_beliefs
        (tenant_id, belief_id, domain, subject, alpha, beta, observations, avg_return, tags, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.tenantId, input.beliefId, input.domain, input.subject,
      input.alpha, input.beta, input.observations, input.avgReturn,
      tags, now,
    );
  }

  getBeliefs(tenantId: string, domain?: string): TenantBeliefRow[] {
    if (domain) {
      return this.db.prepare(
        'SELECT * FROM tenant_beliefs WHERE tenant_id = ? AND domain = ? ORDER BY updated_at DESC',
      ).all(tenantId, domain) as TenantBeliefRow[];
    }
    return this.db.prepare(
      'SELECT * FROM tenant_beliefs WHERE tenant_id = ? ORDER BY updated_at DESC',
    ).all(tenantId) as TenantBeliefRow[];
  }

  // ── Trades ─────────────────────────────────────────────────────────

  recordTrade(input: RecordTradeInput): TenantTradeRow {
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      INSERT INTO tenant_trades
        (tenant_id, ticker, direction, entry_price, exit_price, qty, pnl,
         opened_at, closed_at, reason, strategy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.tenantId, input.ticker, input.direction,
      input.entryPrice, input.exitPrice ?? null,
      input.qty, input.pnl ?? null,
      input.openedAt ?? now, input.closedAt ?? null,
      input.reason ?? null, input.strategy ?? null,
    );

    return this.db.prepare(
      'SELECT * FROM tenant_trades WHERE id = ?',
    ).get(result.lastInsertRowid) as TenantTradeRow;
  }

  getTrades(
    tenantId: string,
    opts?: { limit?: number; offset?: number; ticker?: string },
  ): TenantTradeRow[] {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    if (opts?.ticker) {
      return this.db.prepare(`
        SELECT * FROM tenant_trades
        WHERE tenant_id = ? AND ticker = ?
        ORDER BY opened_at DESC LIMIT ? OFFSET ?
      `).all(tenantId, opts.ticker, limit, offset) as TenantTradeRow[];
    }

    return this.db.prepare(`
      SELECT * FROM tenant_trades
      WHERE tenant_id = ?
      ORDER BY opened_at DESC LIMIT ? OFFSET ?
    `).all(tenantId, limit, offset) as TenantTradeRow[];
  }

  // ── Reports ────────────────────────────────────────────────────────

  saveReport(input: {
    tenantId: string;
    agent: string;
    type: string;
    summary: string;
    strategyAction?: string;
    strategyResult?: string;
  }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO tenant_reports (tenant_id, agent, type, summary, strategy_action, strategy_result, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.tenantId, input.agent, input.type, input.summary,
      input.strategyAction ?? null, input.strategyResult ?? null, now,
    );
  }

  getReports(tenantId: string, opts?: { limit?: number; agent?: string }): TenantReportRow[] {
    const limit = opts?.limit ?? 50;
    if (opts?.agent) {
      return this.db.prepare(`
        SELECT * FROM tenant_reports
        WHERE tenant_id = ? AND agent = ?
        ORDER BY timestamp DESC LIMIT ?
      `).all(tenantId, opts.agent, limit) as TenantReportRow[];
    }
    return this.db.prepare(`
      SELECT * FROM tenant_reports WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT ?
    `).all(tenantId, limit) as TenantReportRow[];
  }

  // ── Subscription gating ────────────────────────────────────────────

  /**
   * Determine whether a tenant is allowed to trade.
   * Matches the spec logic from SPEC-MT-001:
   *   - free tier: false (self-hosted only)
   *   - active subscription: true
   *   - within trial period: true
   *   - otherwise: false
   */
  canTrade(tenantId: string): boolean {
    const tenant = this.getTenant(tenantId);
    if (!tenant) return false;
    if (tenant.tier === 'free') return false;
    if (tenant.subscription_status === 'active') return true;
    if (tenant.trial_ends_at && new Date() < new Date(tenant.trial_ends_at)) return true;
    return false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}

// Re-export types
export type {
  TenantRow,
  TenantCredentialRow,
  TenantConfigRow,
  TenantBeliefRow,
  TenantTradeRow,
  TenantReportRow,
} from './schema.js';
