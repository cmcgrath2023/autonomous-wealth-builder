/**
 * Tenant Database Schema Definitions
 *
 * Tables: tenants, tenant_credentials, tenant_config, tenant_beliefs,
 *         tenant_trades, tenant_reports
 *
 * Uses better-sqlite3 with typed row interfaces.
 */

// ── Row Types ──────────────────────────────────────────────────────────

export interface TenantRow {
  id: string;
  email: string;
  name: string;
  tier: 'free' | 'hosted' | 'pro';
  trial_ends_at: string | null;
  subscription_status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'none';
  created_at: string;
  updated_at: string;
}

export interface TenantCredentialRow {
  tenant_id: string;
  broker: string;
  encrypted_key: string;
  encrypted_secret: string;
  iv_key: string;
  auth_tag_key: string;
  iv_secret: string;
  auth_tag_secret: string;
  account_id: string | null;
  mode: 'paper' | 'live';
  created_at: string;
  updated_at: string;
}

export interface TenantConfigRow {
  tenant_id: string;
  simulated_capital: number;
  max_positions: number;
  crypto_pct: number;
  equity_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  daily_goal: number;
  autonomy_level: number;
  heartbeat_ms: number;
  updated_at: string;
}

export interface TenantBeliefRow {
  tenant_id: string;
  belief_id: string;
  domain: string;
  subject: string;
  alpha: number;
  beta: number;
  observations: number;
  avg_return: number;
  tags: string;
  updated_at: string;
}

export interface TenantTradeRow {
  id: number;
  tenant_id: string;
  ticker: string;
  direction: 'long' | 'short';
  entry_price: number;
  exit_price: number | null;
  qty: number;
  pnl: number | null;
  opened_at: string;
  closed_at: string | null;
  reason: string | null;
  strategy: string | null;
}

export interface TenantReportRow {
  id: number;
  tenant_id: string;
  agent: string;
  type: string;
  summary: string;
  strategy_action: string | null;
  strategy_result: string | null;
  timestamp: string;
}

// ── SQL Statements ─────────────────────────────────────────────────────

export const TABLE_TENANTS = `
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'hosted',
    trial_ends_at TEXT,
    subscription_status TEXT NOT NULL DEFAULT 'trialing',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

export const TABLE_TENANT_CREDENTIALS = `
  CREATE TABLE IF NOT EXISTS tenant_credentials (
    tenant_id TEXT NOT NULL,
    broker TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    encrypted_secret TEXT NOT NULL,
    iv_key TEXT NOT NULL,
    auth_tag_key TEXT NOT NULL,
    iv_secret TEXT NOT NULL,
    auth_tag_secret TEXT NOT NULL,
    account_id TEXT,
    mode TEXT NOT NULL DEFAULT 'paper',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, broker),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  )
`;

export const TABLE_TENANT_CONFIG = `
  CREATE TABLE IF NOT EXISTS tenant_config (
    tenant_id TEXT PRIMARY KEY,
    simulated_capital REAL NOT NULL DEFAULT 100000,
    max_positions INTEGER NOT NULL DEFAULT 5,
    crypto_pct REAL NOT NULL DEFAULT 0.3,
    equity_pct REAL NOT NULL DEFAULT 0.7,
    stop_loss_pct REAL NOT NULL DEFAULT 0.02,
    take_profit_pct REAL NOT NULL DEFAULT 0.05,
    daily_goal REAL NOT NULL DEFAULT 50,
    autonomy_level INTEGER NOT NULL DEFAULT 3,
    heartbeat_ms INTEGER NOT NULL DEFAULT 30000,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  )
`;

export const TABLE_TENANT_BELIEFS = `
  CREATE TABLE IF NOT EXISTS tenant_beliefs (
    tenant_id TEXT NOT NULL,
    belief_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    subject TEXT NOT NULL,
    alpha REAL NOT NULL DEFAULT 1,
    beta REAL NOT NULL DEFAULT 1,
    observations INTEGER NOT NULL DEFAULT 0,
    avg_return REAL NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, belief_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  )
`;

export const TABLE_TENANT_TRADES = `
  CREATE TABLE IF NOT EXISTS tenant_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    direction TEXT NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL,
    qty REAL NOT NULL,
    pnl REAL,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    reason TEXT,
    strategy TEXT,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  )
`;

export const TABLE_TENANT_REPORTS = `
  CREATE TABLE IF NOT EXISTS tenant_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    agent TEXT NOT NULL,
    type TEXT NOT NULL,
    summary TEXT NOT NULL,
    strategy_action TEXT,
    strategy_result TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  )
`;

// ── Indexes ────────────────────────────────────────────────────────────

export const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_tenants_email ON tenants(email)',
  'CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(subscription_status)',
  'CREATE INDEX IF NOT EXISTS idx_credentials_tenant ON tenant_credentials(tenant_id)',
  'CREATE INDEX IF NOT EXISTS idx_beliefs_tenant ON tenant_beliefs(tenant_id)',
  'CREATE INDEX IF NOT EXISTS idx_beliefs_domain ON tenant_beliefs(tenant_id, domain)',
  'CREATE INDEX IF NOT EXISTS idx_trades_tenant ON tenant_trades(tenant_id)',
  'CREATE INDEX IF NOT EXISTS idx_trades_opened ON tenant_trades(tenant_id, opened_at)',
  'CREATE INDEX IF NOT EXISTS idx_reports_tenant ON tenant_reports(tenant_id)',
  'CREATE INDEX IF NOT EXISTS idx_reports_timestamp ON tenant_reports(tenant_id, timestamp)',
];

export const ALL_TABLES = [
  TABLE_TENANTS,
  TABLE_TENANT_CREDENTIALS,
  TABLE_TENANT_CONFIG,
  TABLE_TENANT_BELIEFS,
  TABLE_TENANT_TRADES,
  TABLE_TENANT_REPORTS,
];
