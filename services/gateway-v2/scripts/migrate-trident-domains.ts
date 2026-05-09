/**
 * Migrate Trident memories into domain-scoped records.
 *
 * Run: node --import tsx/esm gateway-v2/scripts/migrate-trident-domains.ts
 */

const BRAIN_URL = process.env.BRAIN_SERVER_URL || 'https://trident.cetaceanlabs.com';
const API_KEY = process.env.BRAIN_API_KEY || '';

async function bf(path: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(`${BRAIN_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}), ...opts?.headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) { console.error(`  ${res.status} ${path}`); return null; }
  return res.json();
}

async function search(query: string, limit = 50): Promise<any[]> {
  const r = await bf(`/v1/memories/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  return Array.isArray(r) ? r : [];
}

async function post(domain: string, title: string, content: string, tags: string[] = []): Promise<boolean> {
  const r = await bf('/v1/memories', {
    method: 'POST',
    body: JSON.stringify({ domain, title, content, tags: tags.map(t => t.slice(0, 30).toLowerCase().replace(/[^a-z0-9_\-/]/g, '_')), source: 'mtwm:domain-migration' }),
  });
  return r !== null;
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function migrateGroup(domain: string, queries: string[], filter: (m: any) => boolean) {
  console.log(`\n--- ${domain} ---`);
  const seen = new Set<string>();
  let created = 0;
  for (const q of queries) {
    const records = await search(q, 50);
    await delay(300);
    for (const m of records) {
      if (seen.has(m.id) || !filter(m)) continue;
      seen.add(m.id);
      const ok = await post(domain, m.title, m.content, m.tags || []);
      if (ok) created++;
      await delay(200);
    }
  }
  console.log(`  ${domain}: ${created} records created`);
  return created;
}

async function main() {
  console.log('=== Trident Domain Migration ===\n');
  const health = await bf('/v1/health');
  if (!health?.status) { console.error('Trident unreachable'); process.exit(1); }

  const before = await bf('/v1/sona/domains');
  console.log('Before:', JSON.stringify(before?.domains || []));

  let total = 0;

  // avoid
  total += await migrateGroup('avoid', ['avoid OR blacklist OR do not buy'], m => {
    const c = (m.content || m.title || '').toLowerCase();
    return c.includes('avoid') || c.includes('blacklist') || c.includes('do not buy');
  });

  // trade_outcome
  total += await migrateGroup('trade_outcome', ['Trade WIN', 'Trade LOSS'], m => {
    const t = m.title || '';
    return t.includes('Trade WIN') || t.includes('Trade LOSS');
  });

  // buffett_core — seed the core holdings directly rather than matching noisy research cycles
  console.log('\n--- buffett_core (seeding) ---');
  const buffettSeeds = [
    { tier: 'CORE HOLDING', tickers: ['AAPL', 'AXP', 'BAC', 'KO', 'CVX'] },
    { tier: 'KEY INVESTMENT', tickers: ['MCO', 'OXY', 'COF', 'GOOGL', 'KR'] },
    { tier: 'OWNER FAVORITE', tickers: ['NVDA', 'MSFT', 'AMZN', 'META', 'DVA'] },
  ];
  let buffettCount = 0;
  for (const { tier, tickers } of buffettSeeds) {
    for (const t of tickers) {
      const ok = await post('buffett_core', `BUFFETT ${tier}: ${t}`, `${t}: ${tier} — Berkshire portfolio / owner preference. Quality-first filter for shouldBuy().`, [t.toLowerCase(), 'buffett', tier.toLowerCase().replace(/ /g, '_')]);
      if (ok) buffettCount++;
      await delay(200);
    }
  }
  console.log(`  buffett_core: ${buffettCount} records created`);
  total += buffettCount;

  // strategy_knowledge
  total += await migrateGroup('strategy_knowledge', ['RSI-2 strategy', 'ORB opening range', 'inverse ETF regime'], m => {
    const c = (m.content || '').toLowerCase();
    const t = m.title || '';
    return !t.includes('Trade WIN') && !t.includes('Trade LOSS') &&
      (c.includes('rsi-2') || c.includes('rsi(2)') || c.includes('opening range') || c.includes('inverse etf'));
  });

  // owner_preference
  total += await migrateGroup('owner_preference', ['owner preference', 'owner note', 'owner buys'], m => {
    const c = (m.content || '').toLowerCase();
    return c.includes('owner') && (c.includes('preference') || c.includes('note') || c.includes('buys'));
  });

  // lesson_loss
  total += await migrateGroup('lesson_loss', ['lesson loss', 'anti-pattern', 'win rate poor'], m => {
    const c = (m.content || '').toLowerCase();
    const t = m.title || '';
    return !t.includes('Trade WIN') && !t.includes('Trade LOSS') &&
      (c.includes('lesson') || c.includes('anti-pattern'));
  });

  console.log(`\n=== Done: ${total} records created ===`);
  await delay(1000);
  const after = await bf('/v1/sona/domains');
  console.log('After:', JSON.stringify(after?.domains || [], null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
