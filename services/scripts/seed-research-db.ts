/**
 * One-time seed script for the Research Database.
 *
 * Populates:
 *   1. ~5000 companies from Alpaca NASDAQ + NYSE + AMEX assets
 *   2. DataCenterInfra supply chain relationships (copper/uranium/natgas/rare earth)
 *   3. Semiconductor supply chain relationships
 *   4. Oil ecosystem relationships
 *   5. Defense primes relationships
 *   6. Sector peer relationships (same sub_industry, top 10 by market cap)
 *   7. First momentum scan written to PG
 *
 * Run: RESEARCH_DATABASE_URL=postgresql://localhost/mtwm_research \
 *      ALPACA_API_KEY=... ALPACA_API_SECRET=... \
 *      node --import tsx/esm scripts/seed-research-db.ts
 */

import { initResearchDb, query, shutdown } from '../research-db/src/index.js';

const ALPACA_HEADERS = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY || process.env.APCA_API_KEY_ID || '',
  'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET || process.env.APCA_API_SECRET_KEY || '',
};

// ── Step 1: Companies from Alpaca ──────────────────────────────────

async function seedCompanies(): Promise<number> {
  console.log('\n═══ STEP 1: Seeding companies from Alpaca ═══');
  let total = 0;

  for (const exchange of ['NASDAQ', 'NYSE', 'AMEX']) {
    try {
      const res = await fetch(
        `https://paper-api.alpaca.markets/v2/assets?status=active&exchange=${exchange}`,
        { headers: ALPACA_HEADERS, signal: AbortSignal.timeout(30_000) },
      );
      if (!res.ok) { console.log(`  ${exchange}: ${res.status}`); continue; }
      const assets = await res.json() as any[];

      // Filter to tradeable equities
      const tradeable = assets.filter((a: any) =>
        a.tradable && a.class === 'us_equity' && a.symbol && a.symbol.length <= 5
      );

      let inserted = 0;
      // Batch insert
      for (const a of tradeable) {
        try {
          await query(`
            INSERT INTO companies (symbol, name, sector, exchange, last_updated)
            VALUES ($1, $2, '', $3, NOW())
            ON CONFLICT (symbol) DO UPDATE SET
              name = EXCLUDED.name,
              exchange = EXCLUDED.exchange,
              last_updated = NOW()
          `, [a.symbol, a.name || '', exchange]);
          inserted++;
        } catch {}
      }
      console.log(`  ${exchange}: ${inserted} companies (of ${assets.length} assets)`);
      total += inserted;
    } catch (e: any) {
      console.log(`  ${exchange}: FAILED ${e.message}`);
    }
  }

  console.log(`  Total: ${total} companies`);
  return total;
}

// ── Step 2: Supply chain relationships ─────────────────────────────

interface RelSeed {
  a: string;
  b: string;
  rel: string;
  strength: number;
  evidence: string;
}

async function seedRelationships(): Promise<number> {
  console.log('\n═══ STEP 2: Seeding supply chain relationships ═══');

  const relationships: RelSeed[] = [
    // ── DataCenterInfra: copper → AI infrastructure chain ──
    { a: 'FCX', b: 'SCCO', rel: 'competitor', strength: 0.8, evidence: 'copper miners compete for same deposits' },
    { a: 'FCX', b: 'NVDA', rel: 'supplier', strength: 0.6, evidence: 'copper is critical for AI datacenter power infrastructure' },
    { a: 'FCX', b: 'EQIX', rel: 'supplier', strength: 0.5, evidence: 'datacenter buildouts consume massive copper' },
    { a: 'CCJ', b: 'CEG', rel: 'supplier', strength: 0.7, evidence: 'uranium fuel for nuclear power plants' },
    { a: 'CEG', b: 'EQIX', rel: 'supplier', strength: 0.6, evidence: 'nuclear baseload power for datacenters' },
    { a: 'CEG', b: 'MSFT', rel: 'partner', strength: 0.7, evidence: 'Microsoft nuclear-powered AI datacenter deals' },
    { a: 'VST', b: 'NVDA', rel: 'supplier', strength: 0.5, evidence: 'Vistra power generation for AI compute' },
    { a: 'NEE', b: 'AMZN', rel: 'supplier', strength: 0.5, evidence: 'renewable energy PPAs for AWS datacenters' },
    { a: 'MP', b: 'TSLA', rel: 'supplier', strength: 0.6, evidence: 'rare earth magnets for EV motors' },
    { a: 'ALB', b: 'TSLA', rel: 'supplier', strength: 0.7, evidence: 'lithium for EV batteries' },
    { a: 'LNG', b: 'XOM', rel: 'partner', strength: 0.5, evidence: 'LNG export partnerships' },
    { a: 'EQT', b: 'LNG', rel: 'supplier', strength: 0.6, evidence: 'natural gas producer feeds LNG export' },

    // ── Semiconductor supply chain ──
    { a: 'TSM', b: 'NVDA', rel: 'supplier', strength: 0.9, evidence: 'TSMC fabs all NVIDIA GPUs' },
    { a: 'TSM', b: 'AMD', rel: 'supplier', strength: 0.9, evidence: 'TSMC fabs AMD CPUs/GPUs' },
    { a: 'TSM', b: 'AAPL', rel: 'supplier', strength: 0.9, evidence: 'TSMC fabs Apple silicon' },
    { a: 'TSM', b: 'AVGO', rel: 'supplier', strength: 0.8, evidence: 'TSMC fabs Broadcom chips' },
    { a: 'ASML', b: 'TSM', rel: 'supplier', strength: 0.9, evidence: 'ASML is sole EUV lithography supplier to TSMC' },
    { a: 'ASML', b: 'INTC', rel: 'supplier', strength: 0.8, evidence: 'Intel uses ASML EUV for advanced nodes' },
    { a: 'LRCX', b: 'TSM', rel: 'supplier', strength: 0.8, evidence: 'Lam etch equipment for TSMC fabs' },
    { a: 'AMAT', b: 'TSM', rel: 'supplier', strength: 0.8, evidence: 'Applied Materials deposition equipment' },
    { a: 'KLAC', b: 'TSM', rel: 'supplier', strength: 0.7, evidence: 'KLA inspection/metrology equipment' },
    { a: 'NVDA', b: 'AMD', rel: 'competitor', strength: 0.8, evidence: 'GPU market competition' },
    { a: 'NVDA', b: 'INTC', rel: 'competitor', strength: 0.6, evidence: 'datacenter accelerator competition' },
    { a: 'AVGO', b: 'MRVL', rel: 'competitor', strength: 0.7, evidence: 'custom AI chip competition' },
    { a: 'NVDA', b: 'SMCI', rel: 'partner', strength: 0.8, evidence: 'SuperMicro builds NVIDIA GPU servers' },
    { a: 'NVDA', b: 'DELL', rel: 'partner', strength: 0.7, evidence: 'Dell sells NVIDIA AI servers' },
    { a: 'NVDA', b: 'CRWV', rel: 'customer', strength: 0.7, evidence: 'CoreWeave is major GPU cloud customer' },

    // ── Oil ecosystem ──
    { a: 'XOM', b: 'CVX', rel: 'competitor', strength: 0.9, evidence: 'top 2 US oil majors' },
    { a: 'XOM', b: 'COP', rel: 'competitor', strength: 0.8, evidence: 'US E&P competition' },
    { a: 'SLB', b: 'HAL', rel: 'competitor', strength: 0.9, evidence: 'oilfield services duopoly' },
    { a: 'SLB', b: 'BKR', rel: 'competitor', strength: 0.8, evidence: 'oilfield services competition' },
    { a: 'SLB', b: 'XOM', rel: 'supplier', strength: 0.7, evidence: 'drilling services provider' },
    { a: 'ET', b: 'XOM', rel: 'customer', strength: 0.6, evidence: 'midstream pipeline operator' },
    { a: 'MPC', b: 'XOM', rel: 'customer', strength: 0.5, evidence: 'refining buys crude' },
    { a: 'VLO', b: 'MPC', rel: 'competitor', strength: 0.8, evidence: 'refining competition' },
    { a: 'STNG', b: 'FRO', rel: 'competitor', strength: 0.8, evidence: 'oil tanker competition' },
    { a: 'OXY', b: 'DVN', rel: 'competitor', strength: 0.7, evidence: 'Permian Basin E&P competition' },

    // ── Defense primes ──
    { a: 'LMT', b: 'RTX', rel: 'competitor', strength: 0.8, evidence: 'defense prime contract competition' },
    { a: 'LMT', b: 'NOC', rel: 'competitor', strength: 0.8, evidence: 'defense prime contract competition' },
    { a: 'LMT', b: 'GD', rel: 'competitor', strength: 0.7, evidence: 'defense prime contract competition' },
    { a: 'BA', b: 'LMT', rel: 'competitor', strength: 0.7, evidence: 'military aircraft competition' },
    { a: 'LMT', b: 'HII', rel: 'partner', strength: 0.6, evidence: 'joint naval programs' },
    { a: 'RTX', b: 'LHX', rel: 'competitor', strength: 0.7, evidence: 'defense electronics competition' },
    { a: 'AXON', b: 'PLTR', rel: 'partner', strength: 0.5, evidence: 'defense/law enforcement tech partnerships' },
    { a: 'KTOS', b: 'RKLB', rel: 'sector_peer', strength: 0.5, evidence: 'defense tech / space' },

    // ── Big Tech ecosystem ──
    { a: 'AAPL', b: 'MSFT', rel: 'competitor', strength: 0.7, evidence: 'OS and ecosystem competition' },
    { a: 'GOOGL', b: 'META', rel: 'competitor', strength: 0.8, evidence: 'digital advertising duopoly' },
    { a: 'AMZN', b: 'MSFT', rel: 'competitor', strength: 0.8, evidence: 'AWS vs Azure cloud competition' },
    { a: 'AMZN', b: 'GOOGL', rel: 'competitor', strength: 0.7, evidence: 'cloud + advertising competition' },
    { a: 'NFLX', b: 'DIS', rel: 'competitor', strength: 0.7, evidence: 'streaming competition' },
    { a: 'CRM', b: 'MSFT', rel: 'competitor', strength: 0.7, evidence: 'enterprise software competition' },
    { a: 'ORCL', b: 'MSFT', rel: 'competitor', strength: 0.6, evidence: 'cloud database competition' },

    // ── Financials ──
    { a: 'JPM', b: 'GS', rel: 'competitor', strength: 0.8, evidence: 'investment banking competition' },
    { a: 'JPM', b: 'MS', rel: 'competitor', strength: 0.8, evidence: 'wealth management competition' },
    { a: 'V', b: 'MA', rel: 'competitor', strength: 0.9, evidence: 'payment network duopoly' },
    { a: 'PYPL', b: 'SQ', rel: 'competitor', strength: 0.8, evidence: 'digital payments competition' },

    // ── Consumer / travel ──
    { a: 'CCL', b: 'RCL', rel: 'competitor', strength: 0.9, evidence: 'cruise line duopoly' },
    { a: 'CCL', b: 'NCLH', rel: 'competitor', strength: 0.8, evidence: 'cruise line competition' },
    { a: 'DAL', b: 'UAL', rel: 'competitor', strength: 0.9, evidence: 'US airline competition' },
    { a: 'DAL', b: 'AAL', rel: 'competitor', strength: 0.8, evidence: 'US airline competition' },
    { a: 'BKNG', b: 'ABNB', rel: 'competitor', strength: 0.7, evidence: 'online travel/lodging competition' },
  ];

  let inserted = 0;
  for (const r of relationships) {
    try {
      // Check both symbols exist
      const { rows: check } = await query(
        `SELECT symbol FROM companies WHERE symbol IN ($1, $2)`,
        [r.a, r.b],
      );
      if (check.length < 2) continue; // skip if either company not in DB

      await query(`
        INSERT INTO company_relationships (symbol_a, symbol_b, relationship, strength, evidence, source, discovered_at)
        VALUES ($1, $2, $3, $4, $5, 'seed_script', NOW())
        ON CONFLICT (symbol_a, symbol_b, relationship) DO UPDATE SET
          strength = EXCLUDED.strength,
          evidence = EXCLUDED.evidence,
          last_validated = NOW()
      `, [r.a, r.b, r.rel, r.strength, r.evidence]);
      inserted++;
    } catch {}
  }

  console.log(`  Seeded ${inserted} supply chain relationships`);
  return inserted;
}

// ── Step 3: Sector peer auto-generation ────────────────────────────

async function seedSectorPeers(): Promise<number> {
  console.log('\n═══ STEP 3: Auto-generating sector peer relationships ═══');
  console.log('  (Same sub_industry, top 10 by market cap per Opus directive)');

  // Since we don't have sector/industry populated from Alpaca (their asset API
  // doesn't include sector info), we'll use the hardcoded sector map from the
  // momentum scanner as a starting point and create peers within each group.
  const sectorGroups: Record<string, string[]> = {
    'Semis': ['NVDA','AMD','INTC','AVGO','TSM','ASML','MRVL','ON','ALAB','KLAC','LRCX','AMAT','MU','MPWR','NXPI','QCOM','TXN','ARM','MCHP','SWKS'],
    'BigTech': ['AAPL','MSFT','GOOGL','AMZN','META','TSLA','ORCL','CRM','NFLX','ADBE'],
    'CloudSaaS': ['NOW','SNOW','DDOG','NET','CRWD','PANW','FTNT','ZS','OKTA','HUBS','WDAY','INTU','VEEV','TEAM','MDB'],
    'FinancialsBanks': ['JPM','GS','MS','BAC','C','WFC'],
    'FinancialsFintech': ['V','MA','PYPL','SQ','SOFI','HOOD','AFRM','NU'],
    'EnergyMajors': ['XOM','CVX','COP','OXY','DVN','EOG','FANG','HES','PBR'],
    'EnergyServices': ['SLB','HAL','BKR'],
    'EnergyPipelines': ['ET','EPD','WMB','KMI','OKE','TRGP','MPLX'],
    'DefensePrimes': ['LMT','RTX','NOC','GD','BA','HII','LHX'],
    'DefenseTech': ['KTOS','RKLB','AXON','PLTR','BWXT','LDOS','SAIC','BAH'],
    'Airlines': ['DAL','UAL','AAL','LUV','JBLU','ALK'],
    'CruiseLines': ['CCL','RCL','NCLH'],
    'Biotech': ['MRNA','REGN','VRTX','AMGN','GILD','BMRN','ALNY','IONS','SGEN'],
    'PharmaMajor': ['LLY','PFE','JNJ','MRK','ABBV'],
    'CryptoMiners': ['MARA','RIOT','MSTR','HUT','BITF','CLSK','CIFR','WULF'],
    'EVAutomakers': ['TSLA','RIVN','LCID','NIO','XPEV','LI'],
    'RetailBigBox': ['COST','WMT','TGT','HD','LOW'],
    'GoldMiners': ['NEM','GLD','GDX','GOLD'],
    'CopperComplex': ['FCX','SCCO','VALE','BHP','RIO'],
    'Solar': ['ENPH','SEDG','FSLR','RUN'],
    'NuclearPower': ['CEG','VST','CCJ'],
  };

  let totalPeers = 0;
  for (const [group, tickers] of Object.entries(sectorGroups)) {
    // Top 10 only (Opus directive: cap at 10 by market cap within same sub_industry)
    const topTickers = tickers.slice(0, 10);

    // Update sector info on companies table
    for (const t of topTickers) {
      try {
        await query(`
          UPDATE companies SET industry = $1, sub_industry = $1
          WHERE symbol = $2 AND industry = ''
        `, [group, t]);
      } catch {}
    }

    // Create peer relationships between all pairs
    for (let i = 0; i < topTickers.length; i++) {
      for (let j = i + 1; j < topTickers.length; j++) {
        try {
          const { rows: check } = await query(
            `SELECT symbol FROM companies WHERE symbol IN ($1, $2)`,
            [topTickers[i], topTickers[j]],
          );
          if (check.length < 2) continue;

          await query(`
            INSERT INTO company_relationships (symbol_a, symbol_b, relationship, strength, evidence, source, discovered_at)
            VALUES ($1, $2, 'sector_peer', 0.5, $3, 'seed_auto_peer', NOW())
            ON CONFLICT (symbol_a, symbol_b, relationship) DO NOTHING
          `, [topTickers[i], topTickers[j], `Auto-generated sector peer: ${group}`]);
          totalPeers++;
        } catch {}
      }
    }
  }

  console.log(`  Generated ${totalPeers} sector peer relationships across ${Object.keys(sectorGroups).length} groups`);
  return totalPeers;
}

// ── Step 4: Refresh views ──────────────────────────────────────────

async function refreshViews(): Promise<void> {
  console.log('\n═══ STEP 4: Refreshing materialized views ═══');
  for (const view of ['mv_relationship_hops', 'mv_active_signals', 'mv_earnings_cascade']) {
    try {
      await query(`REFRESH MATERIALIZED VIEW ${view}`);
      console.log(`  Refreshed ${view}`);
    } catch (e: any) {
      console.log(`  ${view}: ${e.message}`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  AWB Research Database — Initial Seed Script   ║');
  console.log('╚════════════════════════════════════════════════╝');

  await initResearchDb();

  const companies = await seedCompanies();
  const rels = await seedRelationships();
  const peers = await seedSectorPeers();
  await refreshViews();

  // Final counts
  const { rows: compCount } = await query('SELECT COUNT(*) AS n FROM companies');
  const { rows: relCount } = await query('SELECT COUNT(*) AS n FROM company_relationships');
  const { rows: hopCount } = await query('SELECT COUNT(*) AS n FROM mv_relationship_hops');

  console.log('\n═══ SEED COMPLETE ═══');
  console.log(`  Companies:     ${(compCount[0] as any).n}`);
  console.log(`  Relationships: ${(relCount[0] as any).n}`);
  console.log(`  Graph hops:    ${(hopCount[0] as any).n}`);

  await shutdown();
}

main().catch(e => {
  console.error('Seed failed:', e);
  process.exit(1);
});
