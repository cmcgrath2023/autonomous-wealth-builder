import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

// ─── Row types ──────────────────────────────────────────────────────────────

export interface BeliefRow {
  id: string;
  domain: string;
  subject: string;
  alpha: number;
  beta: number;
  posterior: number;
  observations: number;
  avgReturn: number;
  tags: string[];
  updatedAt: string;
  createdAt: string;
}

export interface ResearchStarRow {
  symbol: string;
  sector: string;
  catalyst: string;
  score: number;
  createdAt: string;
}

export interface ClosedTradeRow {
  ticker: string;
  pnl: number;
  direction: string;
  reason: string;
  openedAt: string;
  closedAt: string;
}

export interface ReportRow {
  id: string;
  agent: string;
  type: string;
  timestamp: string;
  summary: string;
  findings: string[];
  signals: unknown[];
  strategy: unknown | null;
  meta: unknown | null;
}

// ─── State Store ────────────────────────────────────────────────────────────

export class GatewayStateStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || join(process.cwd(), 'data', 'gateway-state.db');
    const dir = resolvedPath.substring(0, resolvedPath.lastIndexOf('/'));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(resolvedPath);
    this.init();
  }

  private init(): void {
    // WAL mode for concurrent reads from multiple workers
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS beliefs (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        subject TEXT NOT NULL,
        alpha REAL NOT NULL DEFAULT 2,
        beta REAL NOT NULL DEFAULT 2,
        posterior REAL NOT NULL DEFAULT 0.5,
        observations INTEGER NOT NULL DEFAULT 0,
        avg_return REAL NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_beliefs_domain ON beliefs(domain);
      CREATE INDEX IF NOT EXISTS idx_beliefs_posterior ON beliefs(posterior);
      CREATE INDEX IF NOT EXISTS idx_beliefs_updated ON beliefs(updated_at);

      CREATE TABLE IF NOT EXISTS research_stars (
        symbol TEXT PRIMARY KEY,
        sector TEXT NOT NULL,
        catalyst TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stars_created ON research_stars(created_at);

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        findings TEXT NOT NULL DEFAULT '[]',
        signals TEXT NOT NULL DEFAULT '[]',
        strategy TEXT,
        meta TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_reports_agent ON reports(agent);
      CREATE INDEX IF NOT EXISTS idx_reports_timestamp ON reports(timestamp);

      CREATE TABLE IF NOT EXISTS closed_trades (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        pnl REAL NOT NULL DEFAULT 0,
        direction TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        opened_at TEXT NOT NULL,
        closed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trades_closed ON closed_trades(closed_at);

      CREATE TABLE IF NOT EXISTS adaptive_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // ─── Bayesian Beliefs ───────────────────────────────────────────────────

  saveBelief(
    id: string,
    domain: string,
    subject: string,
    alpha: number,
    beta: number,
    observations: number,
    avgReturn: number,
    tags: string[],
  ): void {
    const now = new Date().toISOString();
    const posterior = alpha / (alpha + beta);
    this.db.prepare(`
      INSERT INTO beliefs (id, domain, subject, alpha, beta, posterior, observations, avg_return, tags, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        domain = excluded.domain,
        subject = excluded.subject,
        alpha = excluded.alpha,
        beta = excluded.beta,
        posterior = excluded.posterior,
        observations = excluded.observations,
        avg_return = excluded.avg_return,
        tags = excluded.tags,
        updated_at = excluded.updated_at
    `).run(id, domain, subject, alpha, beta, posterior, observations, avgReturn, JSON.stringify(tags), now, now);
  }

  getBelief(id: string): BeliefRow | null {
    const row = this.db.prepare('SELECT * FROM beliefs WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapBeliefRow(row);
  }

  getBeliefsByDomain(domain: string): BeliefRow[] {
    const rows = this.db.prepare('SELECT * FROM beliefs WHERE domain = ? ORDER BY posterior DESC').all(domain) as any[];
    return rows.map((r) => this.mapBeliefRow(r));
  }

  getTopPerformers(limit = 20): BeliefRow[] {
    const rows = this.db.prepare(
      'SELECT * FROM beliefs WHERE observations >= 3 ORDER BY posterior DESC, avg_return DESC LIMIT ?',
    ).all(limit) as any[];
    return rows.map((r) => this.mapBeliefRow(r));
  }

  getWorstPerformers(limit = 20): BeliefRow[] {
    const rows = this.db.prepare(
      'SELECT * FROM beliefs WHERE observations >= 3 ORDER BY posterior ASC, avg_return ASC LIMIT ?',
    ).all(limit) as any[];
    return rows.map((r) => this.mapBeliefRow(r));
  }

  /**
   * Decay beliefs not updated within `maxAgeDays`.
   * Halves alpha and beta for stale beliefs, reducing their confidence
   * while preserving the posterior ratio. Returns the count decayed.
   */
  decayBeliefs(maxAgeDays = 7): number {
    const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      UPDATE beliefs
      SET alpha = alpha * 0.5,
          beta = beta * 0.5,
          updated_at = ?
      WHERE updated_at < ?
        AND (alpha > 1 OR beta > 1)
    `).run(now, cutoff);

    // Recompute posteriors for decayed rows
    if (result.changes > 0) {
      this.db.prepare(`
        UPDATE beliefs SET posterior = alpha / (alpha + beta)
        WHERE updated_at = ?
      `).run(now);
    }

    return result.changes;
  }

  clearBeliefs(): void {
    this.db.prepare('DELETE FROM beliefs').run();
  }

  private mapBeliefRow(row: any): BeliefRow {
    return {
      id: row.id,
      domain: row.domain,
      subject: row.subject,
      alpha: row.alpha,
      beta: row.beta,
      posterior: row.posterior,
      observations: row.observations,
      avgReturn: row.avg_return,
      tags: JSON.parse(row.tags || '[]'),
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    };
  }

  // ─── Research Stars ─────────────────────────────────────────────────────

  saveResearchStar(symbol: string, sector: string, catalyst: string, score: number): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO research_stars (symbol, sector, catalyst, score, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        sector = excluded.sector,
        catalyst = excluded.catalyst,
        score = excluded.score,
        created_at = excluded.created_at
    `).run(symbol, sector, catalyst, score, now);
  }

  getResearchStars(): ResearchStarRow[] {
    const rows = this.db.prepare(
      'SELECT * FROM research_stars ORDER BY score DESC',
    ).all() as any[];
    return rows.map((r) => ({
      symbol: r.symbol,
      sector: r.sector,
      catalyst: r.catalyst,
      score: r.score,
      createdAt: r.created_at,
    }));
  }

  /**
   * Remove research stars older than `maxAgeHours`.
   * Market conditions change -- stale stars are noise.
   * Returns count of expired stars removed.
   */
  clearExpiredStars(maxAgeHours = 4): number {
    const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();
    const result = this.db.prepare('DELETE FROM research_stars WHERE created_at < ?').run(cutoff);
    return result.changes;
  }

  // ─── Research Reports ───────────────────────────────────────────────────

  saveReport(report: {
    id: string;
    agent: string;
    type: string;
    timestamp: string;
    summary: string;
    findings: string[];
    signals: unknown[];
    strategy?: unknown;
    meta?: unknown;
  }): void {
    this.db.prepare(`
      INSERT INTO reports (id, agent, type, timestamp, summary, findings, signals, strategy, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        agent = excluded.agent,
        type = excluded.type,
        timestamp = excluded.timestamp,
        summary = excluded.summary,
        findings = excluded.findings,
        signals = excluded.signals,
        strategy = excluded.strategy,
        meta = excluded.meta
    `).run(
      report.id,
      report.agent,
      report.type,
      report.timestamp,
      report.summary,
      JSON.stringify(report.findings),
      JSON.stringify(report.signals),
      report.strategy != null ? JSON.stringify(report.strategy) : null,
      report.meta != null ? JSON.stringify(report.meta) : null,
    );
  }

  getReports(agent?: string, limit = 50): ReportRow[] {
    const rows = agent
      ? this.db.prepare('SELECT * FROM reports WHERE agent = ? ORDER BY timestamp DESC LIMIT ?').all(agent, limit) as any[]
      : this.db.prepare('SELECT * FROM reports ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];
    return rows.map((r) => this.mapReportRow(r));
  }

  getLatestByAgent(agent: string): ReportRow | null {
    const row = this.db.prepare(
      'SELECT * FROM reports WHERE agent = ? ORDER BY timestamp DESC LIMIT 1',
    ).get(agent) as any;
    if (!row) return null;
    return this.mapReportRow(row);
  }

  private mapReportRow(row: any): ReportRow {
    return {
      id: row.id,
      agent: row.agent,
      type: row.type,
      timestamp: row.timestamp,
      summary: row.summary,
      findings: JSON.parse(row.findings || '[]'),
      signals: JSON.parse(row.signals || '[]'),
      strategy: row.strategy ? JSON.parse(row.strategy) : null,
      meta: row.meta ? JSON.parse(row.meta) : null,
    };
  }

  // ─── Closed Trades ──────────────────────────────────────────────────────

  recordTrade(trade: {
    ticker: string;
    pnl: number;
    direction: string;
    reason: string;
    openedAt: string;
    closedAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO closed_trades (ticker, pnl, direction, reason, opened_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(trade.ticker, trade.pnl, trade.direction, trade.reason, trade.openedAt, trade.closedAt);
  }

  getClosedTrades(limit = 100): ClosedTradeRow[] {
    const rows = this.db.prepare(
      'SELECT * FROM closed_trades ORDER BY closed_at DESC LIMIT ?',
    ).all(limit) as any[];
    return rows.map((r) => this.mapTradeRow(r));
  }

  getTodayTrades(): ClosedTradeRow[] {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const rows = this.db.prepare(
      'SELECT * FROM closed_trades WHERE closed_at >= ? ORDER BY closed_at DESC',
    ).all(today) as any[];
    return rows.map((r) => this.mapTradeRow(r));
  }

  private mapTradeRow(row: any): ClosedTradeRow {
    return {
      ticker: row.ticker,
      pnl: row.pnl,
      direction: row.direction,
      reason: row.reason,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
    };
  }

  // ─── Adaptive State ─────────────────────────────────────────────────────

  saveAdaptiveState(state: unknown): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO adaptive_state (id, state, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        updated_at = excluded.updated_at
    `).run(JSON.stringify(state), now);
  }

  getAdaptiveState(): unknown | null {
    const row = this.db.prepare('SELECT state FROM adaptive_state WHERE id = 1').get() as any;
    if (!row) return null;
    return JSON.parse(row.state);
  }

  // ─── Config ─────────────────────────────────────────────────────────────

  set(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO config (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as any;
    return row?.value ?? null;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
