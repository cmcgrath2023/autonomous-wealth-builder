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
  exitPrice?: number | null;
  entryPrice?: number | null;
  qty?: number | null;
  source?: string;
  orderId?: string | null;
}

export interface RiskRuleRow {
  id: string;
  createdAt: string;
  source: string;
  ruleType: 'block_pattern' | 'adjust_gate' | 'adjust_sizing' | 'add_filter';
  description: string;
  field: string;
  operator: 'gt' | 'lt' | 'eq' | 'contains' | 'matches';
  value: string;
  action: 'block' | 'downsize_50' | 'require_catalyst';
  evidence: string;
  pnlImpact: number;
  active: boolean;
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
      CREATE INDEX IF NOT EXISTS idx_trades_ticker ON closed_trades(ticker);

      -- Persistent record of every buy the SYSTEM placed (survives midnight reset).
      -- Used by manual-trade detection so overnight holds are not mislabeled as manual.
      CREATE TABLE IF NOT EXISTS system_buys (
        ticker TEXT NOT NULL,
        bought_at TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        qty REAL NOT NULL DEFAULT 0,
        client_order_id TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        PRIMARY KEY (ticker, bought_at)
      );
      CREATE INDEX IF NOT EXISTS idx_system_buys_ticker ON system_buys(ticker);
      CREATE INDEX IF NOT EXISTS idx_system_buys_status ON system_buys(status);

      -- Tracks post-exit price movement so the system can learn from selling too early.
      -- regret_pct > 0 means the price kept running up after we sold (sold early);
      -- regret_pct < 0 means the price fell after we sold (sold right).
      CREATE TABLE IF NOT EXISTS post_exit_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        exit_at TEXT NOT NULL,
        exit_price REAL NOT NULL,
        exit_reason TEXT NOT NULL DEFAULT '',
        t1_price REAL,
        t3_price REAL,
        t5_price REAL,
        regret_pct REAL,
        verdict TEXT,
        recorded_at TEXT NOT NULL,
        resolved_at TEXT,
        UNIQUE(ticker, exit_at) ON CONFLICT IGNORE
      );
      CREATE INDEX IF NOT EXISTS idx_post_exit_ticker ON post_exit_tracking(ticker);
      CREATE INDEX IF NOT EXISTS idx_post_exit_resolved ON post_exit_tracking(resolved_at);

      CREATE TABLE IF NOT EXISTS adaptive_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Momentum snapshots — written every scan cycle (every 2 hours).
      -- Builds a history of what's moving across the entire market so the
      -- system can track multi-day trends, sector rotation, and acceleration.
      CREATE TABLE IF NOT EXISTS momentum_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        sector TEXT NOT NULL,
        scanned_at TEXT NOT NULL,
        price REAL NOT NULL,
        change_1d REAL NOT NULL,
        change_5d REAL NOT NULL,
        avg_volume REAL NOT NULL DEFAULT 0,
        momentum TEXT NOT NULL,          -- 'strong' | 'moderate' | 'weak'
        source TEXT NOT NULL DEFAULT 'scanner'
      );
      CREATE INDEX IF NOT EXISTS idx_momentum_symbol ON momentum_snapshots(symbol);
      CREATE INDEX IF NOT EXISTS idx_momentum_sector ON momentum_snapshots(sector);
      CREATE INDEX IF NOT EXISTS idx_momentum_scanned ON momentum_snapshots(scanned_at);
      CREATE INDEX IF NOT EXISTS idx_momentum_change5d ON momentum_snapshots(change_5d);

      -- Sector aggregates — one row per sector per scan. Tracks which
      -- sectors are hot, which are fading, over time.
      CREATE TABLE IF NOT EXISTS sector_momentum (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sector TEXT NOT NULL,
        scanned_at TEXT NOT NULL,
        ticker_count INTEGER NOT NULL,
        avg_change_1d REAL NOT NULL,
        avg_change_5d REAL NOT NULL,
        top_ticker TEXT,
        top_change_5d REAL,
        trend TEXT NOT NULL DEFAULT 'flat'  -- 'accelerating' | 'decelerating' | 'flat'
      );
      CREATE INDEX IF NOT EXISTS idx_sector_mom_sector ON sector_momentum(sector);
      CREATE INDEX IF NOT EXISTS idx_sector_mom_scanned ON sector_momentum(scanned_at);

      -- Company profiles + relationships. When Intel announces something,
      -- the system needs to know AAPL, MSFT, TSM, AMAT, KLAC all benefit.
      -- Populated by research worker and catalyst hunter, grows over time.
      CREATE TABLE IF NOT EXISTS companies (
        symbol TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        sector TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '',
        market_cap TEXT NOT NULL DEFAULT '',  -- 'mega' | 'large' | 'mid' | 'small' | 'micro'
        last_price REAL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_companies_sector ON companies(sector);
      CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry);

      -- Company relationships — supply chain, competitors, sector peers,
      -- parent/subsidiary, partners. When one moves, these move too.
      CREATE TABLE IF NOT EXISTS company_relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol_a TEXT NOT NULL,
        symbol_b TEXT NOT NULL,
        relationship TEXT NOT NULL,  -- 'supplier' | 'customer' | 'competitor' | 'partner' | 'sector_peer' | 'parent' | 'subsidiary'
        strength REAL NOT NULL DEFAULT 0.5,  -- 0-1 how correlated they are
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL,
        UNIQUE(symbol_a, symbol_b, relationship) ON CONFLICT REPLACE
      );
      CREATE INDEX IF NOT EXISTS idx_rel_a ON company_relationships(symbol_a);
      CREATE INDEX IF NOT EXISTS idx_rel_b ON company_relationships(symbol_b);
      CREATE INDEX IF NOT EXISTS idx_rel_type ON company_relationships(relationship);

      -- Catalysts history — every catalyst ever detected, with outcome tracking.
      -- Did the FDA approval actually cause a run? Did the earnings beat hold?
      -- Over time this becomes the training data for predicting which catalysts matter.
      CREATE TABLE IF NOT EXISTS catalyst_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        catalyst_type TEXT NOT NULL,
        headline TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        price_at_detection REAL,
        price_1d_after REAL,
        price_5d_after REAL,
        outcome TEXT,  -- 'hit' | 'miss' | 'pending'
        source TEXT NOT NULL DEFAULT 'catalyst_hunter'
      );
      CREATE INDEX IF NOT EXISTS idx_catalyst_symbol ON catalyst_history(symbol);
      CREATE INDEX IF NOT EXISTS idx_catalyst_type ON catalyst_history(catalyst_type);
      CREATE INDEX IF NOT EXISTS idx_catalyst_detected ON catalyst_history(detected_at);

      -- Risk rules produced by the Post-Mortem analyst. Each loss-producing trade
      -- generates a machine-readable rule that the Risk Manager enforces on
      -- subsequent buys. This is the learning loop: yesterday's losses become
      -- tomorrow's filters. Set active=0 to disable without deleting.
      CREATE TABLE IF NOT EXISTS risk_rules (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        source TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        description TEXT NOT NULL,
        field TEXT NOT NULL,
        operator TEXT NOT NULL,
        value TEXT NOT NULL,
        action TEXT NOT NULL,
        evidence TEXT,
        pnl_impact REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_risk_rules_active ON risk_rules(active);
      CREATE INDEX IF NOT EXISTS idx_risk_rules_source ON risk_rules(source);
    `);

    // ─── Idempotent migrations ──────────────────────────────────────────
    // closed_trades: add columns for richer accounting and reconciliation.
    this.ensureColumn('closed_trades', 'exit_price', 'REAL');
    this.ensureColumn('closed_trades', 'entry_price', 'REAL');
    this.ensureColumn('closed_trades', 'qty', 'REAL');
    this.ensureColumn('closed_trades', 'source', "TEXT NOT NULL DEFAULT 'engine'");
    this.ensureColumn('closed_trades', 'order_id', 'TEXT');
    // Unique index used for idempotent upserts from the Alpaca reconciler.
    // (ticker, closed_at, order_id) — order_id is NULL for engine-side writes
    // so these still dedupe on ticker+closed_at via COALESCE.
    try {
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_dedup
        ON closed_trades(ticker, closed_at, COALESCE(order_id, ''));
      `);
    } catch {}
  }

  /** Add a column to an existing table if it isn't already present. */
  private ensureColumn(table: string, column: string, defSql: string): void {
    try {
      const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as any[];
      if (!rows.some((r) => r.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${defSql};`);
      }
    } catch (e) {
      console.warn(`[state-store] ensureColumn ${table}.${column} failed:`, (e as Error).message);
    }
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
    exitPrice?: number | null;
    entryPrice?: number | null;
    qty?: number | null;
    source?: string;
    orderId?: string | null;
  }): void {
    // Idempotent insert — the unique index (ticker, closed_at, coalesce(order_id,''))
    // means the reconciler can safely upsert the same fill multiple times.
    this.db.prepare(`
      INSERT OR IGNORE INTO closed_trades
        (ticker, pnl, direction, reason, opened_at, closed_at,
         exit_price, entry_price, qty, source, order_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.ticker,
      trade.pnl,
      trade.direction,
      trade.reason,
      trade.openedAt,
      trade.closedAt,
      trade.exitPrice ?? null,
      trade.entryPrice ?? null,
      trade.qty ?? null,
      trade.source ?? 'engine',
      trade.orderId ?? null,
    );
  }

  /** Returns true if a trade with this (ticker, closed_at, order_id) already exists. */
  hasTrade(ticker: string, closedAt: string, orderId: string | null = null): boolean {
    const row = this.db.prepare(
      `SELECT 1 FROM closed_trades WHERE ticker = ? AND closed_at = ? AND COALESCE(order_id, '') = COALESCE(?, '')`,
    ).get(ticker, closedAt, orderId) as any;
    return !!row;
  }

  /**
   * Deletes any engine-sourced closed_trade rows for a given ticker within a
   * time window around `closedAt`. Used by the Alpaca reconciler to remove
   * duplicate writes when the same sell was recorded both by the engine's
   * direct path (with estimated P&L) and the reconciler (with authoritative
   * P&L from Alpaca's fill log). The reconciler is always authoritative.
   */
  deleteEngineDuplicates(ticker: string, closedAt: string, windowSeconds = 120): number {
    const ts = new Date(closedAt).getTime();
    if (!isFinite(ts)) return 0;
    const lowIso = new Date(ts - windowSeconds * 1000).toISOString();
    const highIso = new Date(ts + windowSeconds * 1000).toISOString();
    const result = this.db.prepare(
      `DELETE FROM closed_trades
        WHERE ticker = ?
          AND closed_at >= ?
          AND closed_at <= ?
          AND (source LIKE 'engine%' OR source = 'position_manager' OR source = 'fin')`
    ).run(ticker, lowIso, highIso);
    return result.changes;
  }

  // ─── System Buys (persistent — NOT day-scoped) ──────────────────────────

  recordSystemBuy(buy: {
    ticker: string;
    price: number;
    qty: number;
    clientOrderId?: string | null;
    boughtAt?: string;
  }): void {
    const ts = buy.boughtAt ?? new Date().toISOString();
    this.db.prepare(`
      INSERT OR REPLACE INTO system_buys
        (ticker, bought_at, price, qty, client_order_id, status)
      VALUES (?, ?, ?, ?, ?, 'open')
    `).run(buy.ticker, ts, buy.price, buy.qty, buy.clientOrderId ?? null);
  }

  /** Ticker → earliest open system buy (used for entry price / hold duration). */
  getOpenSystemBuy(ticker: string): { ticker: string; boughtAt: string; price: number; qty: number } | null {
    const row = this.db.prepare(
      `SELECT ticker, bought_at AS boughtAt, price, qty
         FROM system_buys
        WHERE ticker = ? AND status = 'open'
        ORDER BY bought_at ASC LIMIT 1`,
    ).get(ticker) as any;
    return row || null;
  }

  /** All currently-open system buys (every ticker the system still believes it owns). */
  getOpenSystemBuys(): Array<{ ticker: string; boughtAt: string; price: number; qty: number }> {
    const rows = this.db.prepare(
      `SELECT ticker, bought_at AS boughtAt, price, qty
         FROM system_buys WHERE status = 'open' ORDER BY bought_at ASC`,
    ).all() as any[];
    return rows;
  }

  /** Mark the earliest open system buy for a ticker as closed. */
  closeSystemBuy(ticker: string, closedAt?: string): void {
    this.db.prepare(`
      UPDATE system_buys
         SET status = 'closed'
       WHERE rowid = (
         SELECT rowid FROM system_buys
          WHERE ticker = ? AND status = 'open'
          ORDER BY bought_at ASC LIMIT 1
       )
    `).run(ticker);
    void closedAt; // reserved for future use
  }

  /** Was this ticker bought by the system at any point (open or closed)? */
  isSystemBought(ticker: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM system_buys WHERE ticker = ? LIMIT 1',
    ).get(ticker) as any;
    return !!row;
  }

  // ─── Post-Exit Tracking (regret / hold-timing feedback) ─────────────────

  recordPostExit(entry: {
    ticker: string;
    exitAt: string;
    exitPrice: number;
    exitReason: string;
  }): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO post_exit_tracking
        (ticker, exit_at, exit_price, exit_reason, recorded_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(entry.ticker, entry.exitAt, entry.exitPrice, entry.exitReason, new Date().toISOString());
  }

  /**
   * Returns rows that still need a T+N price fill.
   * A row is "due" for tN if that column is NULL and (now - exit_at) >= nDays.
   */
  getUnresolvedPostExits(): Array<{
    id: number; ticker: string; exitAt: string; exitPrice: number;
    t1Price: number | null; t3Price: number | null; t5Price: number | null;
  }> {
    const rows = this.db.prepare(
      `SELECT id, ticker, exit_at AS exitAt, exit_price AS exitPrice,
              t1_price AS t1Price, t3_price AS t3Price, t5_price AS t5Price
         FROM post_exit_tracking
        WHERE resolved_at IS NULL
        ORDER BY exit_at ASC`,
    ).all() as any[];
    return rows;
  }

  updatePostExitPrice(id: number, which: 't1' | 't3' | 't5', price: number): void {
    const col = which === 't1' ? 't1_price' : which === 't3' ? 't3_price' : 't5_price';
    this.db.prepare(`UPDATE post_exit_tracking SET ${col} = ? WHERE id = ?`).run(price, id);
  }

  finalizePostExit(id: number, regretPct: number, verdict: string): void {
    this.db.prepare(
      `UPDATE post_exit_tracking
          SET regret_pct = ?, verdict = ?, resolved_at = ?
        WHERE id = ?`,
    ).run(regretPct, verdict, new Date().toISOString(), id);
  }

  // ─── Risk Rules (Post-Mortem → Risk Manager learning loop) ──────────────

  addRiskRule(rule: Omit<RiskRuleRow, 'active'> & { active?: boolean }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO risk_rules
        (id, created_at, source, rule_type, description, field, operator, value, action, evidence, pnl_impact, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rule.id,
      rule.createdAt,
      rule.source,
      rule.ruleType,
      rule.description,
      rule.field,
      rule.operator,
      rule.value,
      rule.action,
      rule.evidence ?? '',
      rule.pnlImpact,
      rule.active !== false ? 1 : 0,
    );
  }

  getRiskRules(includeInactive = false): RiskRuleRow[] {
    const sql = includeInactive
      ? 'SELECT * FROM risk_rules ORDER BY created_at DESC'
      : 'SELECT * FROM risk_rules WHERE active = 1 ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all() as any[];
    return rows.map(r => this.mapRiskRuleRow(r));
  }

  getActiveRiskRules(): RiskRuleRow[] {
    return this.getRiskRules(false);
  }

  deactivateRiskRule(id: string): void {
    this.db.prepare('UPDATE risk_rules SET active = 0 WHERE id = ?').run(id);
  }

  private mapRiskRuleRow(row: any): RiskRuleRow {
    return {
      id: row.id,
      createdAt: row.created_at,
      source: row.source,
      ruleType: row.rule_type,
      description: row.description,
      field: row.field,
      operator: row.operator,
      value: row.value,
      action: row.action,
      evidence: row.evidence || '',
      pnlImpact: row.pnl_impact,
      active: row.active === 1,
    };
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
      exitPrice: row.exit_price ?? null,
      entryPrice: row.entry_price ?? null,
      qty: row.qty ?? null,
      source: row.source ?? 'engine',
      orderId: row.order_id ?? null,
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
