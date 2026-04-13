/**
 * Momentum Scanner — broad-market multi-day momentum screening
 *
 * Replaces the broken Alpaca movers endpoint (returns zero-volume penny
 * stock warrants) with a real momentum scan across a broad universe.
 *
 * Scans ~150 liquid tickers across all sectors. Fetches 5-day bars from
 * Alpaca. Computes 5-day and 1-day returns. Returns anything with strong
 * recent momentum that's above $10 and tradeable.
 *
 * This is what the user asked for 5+ times: "find what's actually moving."
 */

// Broad universe covering all major sectors + liquid mid-caps.
// This is NOT a static "buy these" list — it's the scan universe.
// The scanner fetches bars for all of them and surfaces the ones with momentum.
// Broad universe: ~300 tickers covering every sector deep — supply chain,
// ecosystem companies, mid-caps, and everything that moves when a sector moves.
// When Intel announces something, AAPL/MSFT/ORCL/TSM/AMAT/KLAC/LRCX all move.
// When oil spikes, XOM/CVX/HAL/SLB/ET/EPD/STNG all move.
// The scanner needs to see ALL of them, not just the top 5 per sector.
const SCAN_UNIVERSE = [
  // ═══ TECH — mega caps + ecosystem + supply chain + cloud + cybersecurity ═══
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'AVGO', 'ORCL',
  'CRM', 'AMD', 'INTC', 'ADBE', 'NFLX', 'CSCO', 'QCOM', 'TXN', 'NOW', 'PLTR',
  'UBER', 'SHOP', 'SQ', 'COIN', 'CRWV', 'SNOW', 'NET', 'DDOG', 'MDB', 'PANW',
  'FTNT', 'ZS', 'CRWD', 'OKTA', 'S', 'CYBR', 'TWLO', 'HUBS', 'TTD', 'ROKU',
  'PINS', 'SNAP', 'U', 'RBLX', 'SPOT', 'DOCU', 'ZM', 'PATH', 'AI', 'BBAI',
  'DELL', 'HPQ', 'HPE', 'IBM', 'SAP', 'WDAY', 'INTU', 'TEAM', 'VEEV', 'MNDY',
  'APP', 'IOT', 'SMCI', 'VRT',
  // ═══ SEMICONDUCTORS — fab, design, equipment, materials ═══
  'SMH', 'TSM', 'ASML', 'ON', 'MRVL', 'ALAB', 'MTSI', 'KLAC', 'LRCX', 'AMAT',
  'MU', 'MCHP', 'NXPI', 'SWKS', 'MPWR', 'ARM', 'GFS', 'WOLF', 'CRUS', 'FORM',
  'ACLS', 'ONTO', 'COHU', 'AMBA', 'SLAB',
  // ═══ FINANCIALS — banks, brokers, fintech, insurance, asset mgmt ═══
  'JPM', 'GS', 'MS', 'BAC', 'C', 'WFC', 'SCHW', 'BLK', 'AXP', 'V', 'MA',
  'PYPL', 'SOFI', 'HOOD', 'AFRM', 'NU', 'BRK.B', 'AIG', 'PRU', 'MET', 'ALL',
  'TFC', 'USB', 'PNC', 'CFG', 'KEY', 'FITB', 'RF', 'HBAN', 'FRC', 'WAL',
  'ICE', 'CME', 'NDAQ', 'CBOE',
  // ═══ HEALTHCARE — pharma, biotech, devices, services ═══
  'UNH', 'JNJ', 'LLY', 'PFE', 'ABBV', 'MRK', 'TMO', 'ABT', 'AMGN', 'GILD',
  'MRNA', 'REGN', 'VRTX', 'ISRG', 'DXCM', 'BSX', 'SYK', 'MDT', 'EW', 'ZBH',
  'HCA', 'CI', 'HUM', 'CVS', 'MCK', 'CAH', 'VEEV', 'DOCS', 'HIMS', 'RXRX',
  'SGEN', 'BMRN', 'ALNY', 'IONS', 'PCVX', 'ARWR', 'TVTX', 'REPL', 'NCNO',
  // ═══ ENERGY — oil, gas, services, pipelines, tankers, renewables ═══
  'XOM', 'CVX', 'COP', 'SLB', 'HAL', 'OXY', 'DVN', 'EOG', 'MPC', 'PSX',
  'FANG', 'PBR', 'XLE', 'USO', 'VLO', 'PXD', 'HES', 'BKR', 'CTRA', 'EQT',
  'RRC', 'AR', 'SWN', 'ET', 'EPD', 'MPLX', 'WMB', 'KMI', 'OKE', 'TRGP',
  'STNG', 'TNK', 'FRO', 'INSW', 'FLNG', 'KOS',
  'ENPH', 'SEDG', 'FSLR', 'RUN', 'NOVA', 'NEE', 'AES', 'CEG', 'VST',
  // ═══ DEFENSE + AEROSPACE ═══
  'LMT', 'RTX', 'NOC', 'GD', 'BA', 'HII', 'LHX', 'TDG', 'HWM', 'AXON',
  'KTOS', 'RKLB', 'LUNR', 'ASTS', 'PLTR', 'BWXT', 'LDOS', 'SAIC', 'BAH',
  // ═══ INDUSTRIALS — manufacturing, transport, infrastructure ═══
  'GE', 'HON', 'CAT', 'DE', 'UNP', 'FDX', 'UPS', 'DAL', 'UAL', 'AAL',
  'LUV', 'JBLU', 'SAVE', 'XPO', 'ODFL', 'SAIA', 'GWW', 'FAST', 'EMR',
  'ROK', 'ETN', 'ITW', 'IR', 'PH', 'MMM', 'SWK', 'WM', 'RSG',
  // ═══ CONSUMER — retail, restaurants, luxury, staples ═══
  'COST', 'WMT', 'HD', 'LOW', 'TGT', 'NKE', 'SBUX', 'MCD', 'DIS', 'ABNB',
  'BKNG', 'CMG', 'LULU', 'DECK', 'CROX', 'BOOT', 'RH', 'WSM', 'FIVE', 'OLLI',
  'CVNA', 'CPRT', 'KMX', 'AN', 'AZO', 'ORLY',
  'PG', 'KO', 'PEP', 'PM', 'MO', 'CL', 'EL', 'STZ', 'BUD', 'SAM',
  'HSY', 'MKC', 'SJM', 'TSN', 'HRL', 'K', 'GIS', 'ADM', 'BG',
  // ═══ MATERIALS + COMMODITIES ═══
  'FCX', 'NEM', 'GLD', 'SLV', 'GDX', 'VALE', 'RIO', 'BHP', 'SCCO', 'GOLD',
  'NUE', 'STLD', 'CLF', 'X', 'AA', 'CENX', 'MP', 'LAC', 'ALB', 'SQM',
  'LIN', 'APD', 'SHW', 'ECL', 'DD', 'DOW',
  // ═══ AUTOS + EV + MOBILITY ═══
  'F', 'GM', 'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'PSNY', 'GOEV', 'FSR',
  'QS', 'CHPT', 'BLNK', 'PLUG', 'FCEL', 'BE',
  // ═══ CRYPTO + DIGITAL ASSETS ═══
  'MARA', 'RIOT', 'MSTR', 'HUT', 'BITF', 'CLSK', 'BTBT', 'CIFR', 'WULF',
  // ═══ TRANSPORTATION — airlines, rental, logistics, cruise, shipping ═══
  'DAL', 'UAL', 'AAL', 'LUV', 'JBLU', 'SAVE', 'ALK', 'HA', 'SKYW',
  'CAR', 'HTZ',                                         // rental cars
  'CCL', 'RCL', 'NCLH', 'VIK',                         // cruise lines
  'FDX', 'UPS', 'XPO', 'ODFL', 'SAIA', 'JBHT', 'KNX', 'SNDR', 'CHRW',
  'CSX', 'UNP', 'NSC', 'CP',                           // railroads
  'MATX', 'ZIM', 'GOGL', 'DAC', 'SBLK', 'EGLE',       // dry bulk / container shipping
  'STNG', 'TNK', 'FRO', 'INSW', 'FLNG', 'DHT', 'NAT', // tankers
  // ═══ TRAVEL + HOSPITALITY + LEISURE ═══
  'BKNG', 'ABNB', 'EXPE', 'TRIP',                      // online travel
  'MAR', 'HLT', 'H', 'IHG', 'WH', 'CHH',              // hotels
  'MGM', 'LVS', 'WYNN', 'CZR', 'DKNG', 'PENN', 'RSI', // casinos / gaming / sports betting
  'LYV', 'MSGS', 'EDR',                                 // entertainment / live events
  'SIX', 'FUN', 'SEAS',                                 // theme parks
  // ═══ BIOTECH + PHARMA (expanded mid-caps) ═══
  'RVMD', 'SYRE', 'BEAM', 'TVTX', 'REPL', 'ADPT', 'RCKT', 'NTLA', 'EDIT',
  'CRSP', 'SGMO', 'FATE', 'KYMR', 'ARQT', 'TGTX', 'XENE', 'CRNX',
  'ACAD', 'SAVA', 'AXSM', 'INCY', 'SRPT', 'EXEL', 'BPMC', 'RETA',
  'IMVT', 'PCVX', 'ARWR', 'IONS', 'ALNY', 'BMRN', 'RARE', 'NBIX',
  'RPRX', 'MEDP', 'ICLR', 'DOCS', 'GDRX', 'OSCR', 'ALHC',
  // ═══ RETAIL (expanded) ═══
  'ROST', 'TJX', 'BURL', 'GPS', 'ANF', 'AEO', 'URBN', 'EXPR',
  'DKS', 'HIBB', 'ASO', 'FL',                          // sporting goods
  'ULTA', 'ELF', 'COTY',                               // beauty
  'W', 'ETSY', 'CHWY', 'PTON',                         // ecommerce
  'DG', 'DLTR', 'BIG', 'PRTY',                         // discount
  'CVNA', 'KMX', 'AN', 'GPI', 'LAD', 'SAH',           // auto dealers
  // ═══ FOOD + AGRICULTURE ═══
  'ADM', 'BG', 'CTVA', 'FMC', 'MOS', 'NTR', 'CF', 'SMG',
  // ═══ CANNABIS ═══
  'TLRY', 'CGC', 'SNDL', 'ACB', 'OGI', 'CRON',
  // ═══ SPACS + RECENT IPOS (often big movers) ═══
  'CRCL', 'SNDK', 'CRDO', 'ARW', 'RHI', 'FICO', 'RNG', 'BRZE',
  'RBRK', 'NOK', 'ALM',                                // from today's Yahoo gainers
  // ═══ REITS + REAL ESTATE ═══
  'O', 'AMT', 'PLD', 'SPG', 'EQIX', 'CCI', 'DLR', 'PSA', 'WELL', 'AVB',
  'EQR', 'IRM', 'VICI', 'GLPI', 'INVH',
  // ═══ TELECOM + MEDIA + UTILITIES ═══
  'T', 'VZ', 'TMUS', 'CMCSA', 'CHTR', 'PARA', 'WBD', 'FOX', 'NWSA',
  'SO', 'DUK', 'AEP', 'EXC', 'SRE', 'D', 'PEG', 'XEL', 'WEC', 'ES',
  // ═══ SECTOR ETFs (catch broad rotations) ═══
  'SPY', 'QQQ', 'IWM', 'DIA', 'XLK', 'XLF', 'XLV', 'XLE', 'XLI', 'XLC',
  'XLY', 'XLP', 'XLU', 'XLRE', 'XLB', 'XBI', 'IBB', 'ARKK', 'ARKG', 'ARKW',
  'SQQQ', 'TQQQ', 'UVXY', 'VXX',
  // ═══ TRANSPORT ETFs ═══
  'IYT', 'JETS', 'BDRY', 'SEA',
];

export interface MomentumResult {
  symbol: string;
  currentPrice: number;
  change1d: number;      // % change today
  change5d: number;      // % change over 5 trading days
  avgVolume: number;     // average daily volume over 5 days
  momentum: 'strong' | 'moderate' | 'weak';
}

export interface MomentumScanResult {
  scanned: number;
  strong: MomentumResult[];   // 5d change > 8%
  moderate: MomentumResult[]; // 5d change > 3%
  timestamp: string;
}

/**
 * Scan the broad universe for multi-day momentum.
 * Returns tickers sorted by 5-day return, filtered for > 3% moves.
 * Batches Alpaca bar requests to stay under rate limits.
 */
export async function scanMomentum(
  alpacaHeaders: Record<string, string>,
): Promise<MomentumScanResult> {
  const result: MomentumScanResult = {
    scanned: 0,
    strong: [],
    moderate: [],
    timestamp: new Date().toISOString(),
  };

  // ─── SOURCE 1: Yahoo Finance top gainers (the actual market movers) ──
  // This is what a human finds in 10 seconds on Google. No API key needed.
  // Catches tickers that aren't in any hardcoded list — RVMD, CRDO, SNDK,
  // RBRK, BEAM, CRCL etc. that our static universe misses entirely.
  const yahooMovers: string[] = [];
  try {
    const yRes = await fetch('https://finance.yahoo.com/markets/stocks/gainers/', {
      headers: { 'User-Agent': 'MTWM/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (yRes.ok) {
      const html = await yRes.text();
      // Extract tickers from the gainers page — they appear as data attributes
      // or in links like /quote/RVMD
      const tickerMatches = html.match(/\/quote\/([A-Z]{1,5})(?=[^A-Z])/g) || [];
      const seen = new Set<string>();
      for (const m of tickerMatches) {
        const ticker = m.replace('/quote/', '');
        if (ticker.length >= 1 && ticker.length <= 5 && !seen.has(ticker) && ticker !== 'USD') {
          seen.add(ticker);
          yahooMovers.push(ticker);
        }
      }
      console.log(`[MOMENTUM] Yahoo gainers: ${yahooMovers.length} tickers (${yahooMovers.slice(0, 10).join(',')}...)`);
    }
  } catch (e: any) {
    console.log(`[MOMENTUM] Yahoo fetch failed: ${e.message}`);
  }

  // Merge Yahoo movers into the scan universe (they get 5-day bars too)
  const fullUniverse = [...new Set([...yahooMovers, ...SCAN_UNIVERSE])];

  // Batch into groups of 30 symbols per request (Alpaca limit)
  const batchSize = 30;
  const allResults: MomentumResult[] = [];

  for (let i = 0; i < fullUniverse.length; i += batchSize) {
    const batch = fullUniverse.slice(i, i + batchSize);
    try {
      const syms = batch.join(',');
      const startDate = new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10);
      const url = `https://data.alpaca.markets/v2/stocks/bars?symbols=${syms}&timeframe=1Day&start=${startDate}&feed=sip`;
      const res = await fetch(url, {
        headers: alpacaHeaders,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json() as any;
      const bars = data.bars || {};

      for (const sym of batch) {
        const b = bars[sym];
        if (!b || b.length < 2) continue;
        result.scanned++;

        const latest = b[b.length - 1];
        const prev = b[b.length - 2];
        const oldest = b[0];

        const currentPrice = latest.c;
        if (currentPrice < 10) continue; // price floor

        const change1d = prev.c > 0 ? ((latest.c - prev.c) / prev.c) * 100 : 0;
        const change5d = oldest.c > 0 ? ((latest.c - oldest.c) / oldest.c) * 100 : 0;
        const avgVolume = b.reduce((s: number, x: any) => s + (x.v || 0), 0) / b.length;

        if (Math.abs(change5d) < 3) continue; // skip flat

        const momentum: 'strong' | 'moderate' | 'weak' =
          Math.abs(change5d) >= 8 ? 'strong' :
          Math.abs(change5d) >= 3 ? 'moderate' : 'weak';

        allResults.push({ symbol: sym, currentPrice, change1d, change5d, avgVolume, momentum });
      }
    } catch { /* batch failed, continue */ }
  }

  // Sort by absolute 5d change descending
  allResults.sort((a, b) => Math.abs(b.change5d) - Math.abs(a.change5d));

  for (const r of allResults) {
    if (r.momentum === 'strong') result.strong.push(r);
    else result.moderate.push(r);
  }

  return result;
}

/**
 * Write momentum results to research_stars so the buy pipeline sees them.
 */
/**
 * Persist momentum data to DATABASE TABLES — not just research_stars.
 * Writes to:
 *   - momentum_snapshots: every ticker, every scan cycle (accumulates history)
 *   - sector_momentum: sector averages per scan (tracks sector rotation)
 *   - research_stars: high-momentum tickers for the buy pipeline
 */
export function persistMomentumData(
  store: any, // GatewayStateStore
  results: MomentumScanResult,
  sectorMap: Record<string, string>,
): { snapshots: number; sectors: number; stars: number } {
  const now = new Date().toISOString();
  let snapshots = 0, sectors = 0;

  // 1. Write individual ticker snapshots
  const all = [...results.strong, ...results.moderate];
  for (const r of all) {
    try {
      const sector = sectorMap[r.symbol] || 'Other';
      store.db?.prepare?.(`
        INSERT INTO momentum_snapshots (symbol, sector, scanned_at, price, change_1d, change_5d, avg_volume, momentum, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scanner')
      `)?.run(r.symbol, sector, now, r.currentPrice, r.change1d, r.change5d, r.avgVolume, r.momentum);
      snapshots++;
    } catch {}
  }

  // 2. Write sector aggregates
  const bySector: Record<string, MomentumResult[]> = {};
  for (const r of all) {
    const sector = sectorMap[r.symbol] || 'Other';
    if (!bySector[sector]) bySector[sector] = [];
    bySector[sector].push(r);
  }
  for (const [sector, stocks] of Object.entries(bySector)) {
    try {
      const avg1d = stocks.reduce((s, x) => s + x.change1d, 0) / stocks.length;
      const avg5d = stocks.reduce((s, x) => s + x.change5d, 0) / stocks.length;
      const top = stocks.sort((a, b) => b.change5d - a.change5d)[0];
      store.db?.prepare?.(`
        INSERT INTO sector_momentum (sector, scanned_at, ticker_count, avg_change_1d, avg_change_5d, top_ticker, top_change_5d, trend)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'flat')
      `)?.run(sector, now, stocks.length, avg1d, avg5d, top?.symbol ?? '', top?.change5d ?? 0);
      sectors++;
    } catch {}
  }

  // 3. Write catalyst history entries for new significant movers
  for (const r of results.strong) {
    try {
      store.db?.prepare?.(`
        INSERT OR IGNORE INTO catalyst_history (symbol, catalyst_type, headline, detected_at, price_at_detection, outcome, source)
        VALUES (?, 'momentum', ?, ?, ?, 'pending', 'momentum_scanner')
      `)?.run(r.symbol, `5d +${r.change5d.toFixed(1)}% momentum`, now, r.currentPrice);
    } catch {}
  }

  // 4. Write to research_stars for the buy pipeline
  const stars = persistMomentumStars(store, results);

  return { snapshots, sectors, stars };
}

export function persistMomentumStars(
  store: { saveResearchStar: (symbol: string, sector: string, catalyst: string, score: number) => void },
  results: MomentumScanResult,
): number {
  let written = 0;
  // Strong momentum gets high scores (0.90-0.95)
  for (const r of results.strong.slice(0, 20)) {
    const direction = r.change5d > 0 ? 'UP' : 'DOWN';
    const score = Math.min(0.95, 0.88 + Math.abs(r.change5d) / 200);
    store.saveResearchStar(
      r.symbol,
      'momentum_5d',
      `5d ${direction} ${r.change5d.toFixed(1)}% (today ${r.change1d >= 0 ? '+' : ''}${r.change1d.toFixed(1)}%) vol:${Math.round(r.avgVolume).toLocaleString()}`,
      score,
    );
    written++;
  }
  // Moderate gets slightly lower scores (0.85-0.89)
  for (const r of results.moderate.slice(0, 15)) {
    const direction = r.change5d > 0 ? 'UP' : 'DOWN';
    const score = Math.min(0.89, 0.83 + Math.abs(r.change5d) / 200);
    store.saveResearchStar(
      r.symbol,
      'momentum_5d',
      `5d ${direction} ${r.change5d.toFixed(1)}% (today ${r.change1d >= 0 ? '+' : ''}${r.change1d.toFixed(1)}%) vol:${Math.round(r.avgVolume).toLocaleString()}`,
      score,
    );
    written++;
  }
  return written;
}
