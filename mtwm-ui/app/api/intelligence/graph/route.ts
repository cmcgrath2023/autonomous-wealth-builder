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
      // Seed script industry groups
      'Semis': '#8b5cf6', 'BigTech': '#3b82f6', 'CloudSaaS': '#60a5fa',
      'FinancialsBanks': '#22c55e', 'FinancialsFintech': '#34d399',
      'EnergyMajors': '#f59e0b', 'EnergyServices': '#fbbf24', 'EnergyPipelines': '#d97706',
      'DefensePrimes': '#ef4444', 'DefenseTech': '#f87171',
      'Airlines': '#fb923c', 'CruiseLines': '#fdba74',
      'Biotech': '#d946ef', 'PharmaMajor': '#ec4899',
      'CryptoMiners': '#eab308', 'EVAutomakers': '#4ade80',
      'RetailBigBox': '#06b6d4', 'GoldMiners': '#fcd34d',
      'CopperComplex': '#a78bfa', 'Solar': '#facc15', 'NuclearPower': '#10b981',
      // General sectors
      'Tech': '#3b82f6', 'Finance': '#22c55e', 'Energy': '#f59e0b',
      'Defense': '#ef4444', 'Health': '#ec4899', 'Consumer': '#06b6d4',
      'Materials': '#a78bfa', 'Industrial': '#78716c', 'Transport': '#fb923c',
      'Crypto': '#fbbf24', 'Forex': '#34d399', 'EV': '#4ade80',
      'Major': '#fbbf24', 'AltL1': '#c084fc', 'Infrastructure': '#2dd4bf',
      'Meme': '#f472b6', 'SafeHaven': '#a3e635', 'Commodity': '#d97706',
      'Carry': '#14b8a6', 'Cross': '#818cf8', 'Index': '#94a3b8',
      'default': '#6b7280',
    };

    const nodes = companies.map((c: any) => {
      // Use industry (from seed script sector groups) or sector, with fallback
      const group = c.industry || c.sector || 'Other';
      return {
        id: c.symbol,
        name: `${c.symbol}${c.name ? ' (' + c.name.slice(0, 25) + ')' : ''}`,
        group,
        color: sectorColors[group] || sectorColors[c.sector] || sectorColors.default,
        val: c.market_cap_tier === 'mega' ? 10 : c.market_cap_tier === 'large' ? 6 : 3,
        sector: c.sector,
        industry: c.industry,
      };
    });

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
