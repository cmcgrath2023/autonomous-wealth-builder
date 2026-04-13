import { NextResponse } from 'next/server';
import pg from 'pg';

const PG_URL = process.env.RESEARCH_DATABASE_URL || 'postgresql://localhost/mtwm_research';

export async function GET() {
  const pool = new pg.Pool({ connectionString: PG_URL, max: 2, idleTimeoutMillis: 5000 });

  try {
    // Get companies with relationships (not all 8K — just ones that have edges)
    const { rows: companies } = await pool.query(`
      SELECT DISTINCT c.symbol, c.name, c.sector, c.industry, c.market_cap_tier
      FROM companies c
      WHERE c.symbol IN (
        SELECT symbol_a FROM company_relationships
        UNION SELECT symbol_b FROM company_relationships
      )
      ORDER BY c.sector, c.symbol
      LIMIT 300
    `);

    // Get relationships
    const { rows: relationships } = await pool.query(`
      SELECT symbol_a, symbol_b, relationship, strength
      FROM company_relationships
      WHERE strength >= 0.3
      ORDER BY strength DESC
      LIMIT 500
    `);

    // Get active research signals (last 24h)
    let signals: any[] = [];
    try {
      const { rows } = await pool.query(`
        SELECT ticker, signal_type, confidence, detected_at
        FROM research_signals
        WHERE detected_at > NOW() - INTERVAL '24 hours'
        ORDER BY confidence DESC
        LIMIT 50
      `);
      signals = rows;
    } catch {}

    // Get active theses
    let theses: any[] = [];
    try {
      const { rows } = await pool.query(`
        SELECT id, title, primary_ticker, conviction_score, status, authority_action, sector, created_at
        FROM research_theses
        WHERE status IN ('active', 'promoted')
        ORDER BY conviction_score DESC
        LIMIT 20
      `);
      theses = rows;
    } catch {}

    // Get sector momentum
    let sectorMom: any[] = [];
    try {
      const { rows } = await pool.query(`
        SELECT DISTINCT ON (sector) sector, avg_change_1d, avg_change_5d, top_ticker, trend
        FROM sector_momentum
        ORDER BY sector, scanned_at DESC
      `);
      sectorMom = rows;
    } catch {}

    // Get risk rules from SQLite via gateway
    let riskRules: any[] = [];
    try {
      const r = await fetch('http://localhost:3001/api/status');
      if (r.ok) {
        // risk rules would need their own endpoint — skip for now
      }
    } catch {}

    // Build graph nodes
    const sectorColors: Record<string, string> = {
      'Tech': '#3b82f6', 'Semis': '#8b5cf6', 'Finance': '#22c55e',
      'Energy': '#f59e0b', 'Defense': '#ef4444', 'Health': '#ec4899',
      'Biotech': '#d946ef', 'Consumer': '#06b6d4', 'Materials': '#a78bfa',
      'Industrial': '#78716c', 'Transport': '#fb923c', 'Crypto': '#fbbf24',
      'Forex': '#34d399', 'Solar': '#facc15', 'EV': '#4ade80',
      'default': '#6b7280',
    };

    const nodes = companies.map((c: any) => ({
      id: c.symbol,
      name: `${c.symbol} ${c.name ? '(' + c.name.slice(0, 20) + ')' : ''}`,
      group: c.sector || 'Other',
      color: sectorColors[c.industry] || sectorColors[c.sector] || sectorColors.default,
      val: c.market_cap_tier === 'mega' ? 8 : c.market_cap_tier === 'large' ? 5 : 3,
      sector: c.sector,
      industry: c.industry,
    }));

    const links = relationships.map((r: any) => ({
      source: r.symbol_a,
      target: r.symbol_b,
      label: r.relationship,
      strength: r.strength,
      color: r.relationship === 'competitor' ? '#ef4444' :
             r.relationship === 'supplier' ? '#3b82f6' :
             r.relationship === 'customer' ? '#22c55e' :
             r.relationship === 'partner' ? '#fbbf24' :
             '#6b7280',
    }));

    return NextResponse.json({
      nodes,
      links,
      signals: signals.map((s: any) => ({
        ticker: s.ticker,
        type: s.signal_type,
        confidence: s.confidence,
        detectedAt: s.detected_at,
      })),
      theses: theses.map((t: any) => ({
        id: t.id,
        title: t.title,
        ticker: t.primary_ticker,
        conviction: t.conviction_score,
        status: t.status,
        action: t.authority_action,
        sector: t.sector,
        createdAt: t.created_at,
      })),
      sectorMomentum: sectorMom,
      stats: {
        companies: companies.length,
        relationships: relationships.length,
        activeSignals: signals.length,
        activeTheses: theses.length,
      },
    });
  } catch (err: any) {
    console.error('[intelligence/graph] Error:', err.message);
    return NextResponse.json({
      nodes: [], links: [], signals: [], theses: [], sectorMomentum: [],
      stats: { companies: 0, relationships: 0, activeSignals: 0, activeTheses: 0 },
      error: err.message,
    });
  } finally {
    await pool.end();
  }
}
