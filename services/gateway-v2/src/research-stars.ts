import type { ResearchStarRow } from '../../gateway/src/state-store.js';

interface ResearchStarOptions {
  includeRelated?: boolean;
}

export async function saveResearchStar(star: {
  symbol: string;
  sector: string;
  catalyst: string;
  score: number;
  source?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { query } = await import('../../research-db/src/index.js');
  const catalyst = star.catalyst || '';
  const direction = star.sector === 'short_candidate' || catalyst.toLowerCase().includes('loser') ? 'short'
    : star.sector === 'avoid' ? 'avoid'
      : 'long';

  await query(`
    INSERT INTO research_stars
      (symbol, sector, catalyst, score, direction, source, first_seen_at, updated_at, expires_at, active, metadata)
    VALUES
      ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $7, TRUE, $8::jsonb)
    ON CONFLICT (symbol) DO UPDATE SET
      sector = EXCLUDED.sector,
      catalyst = EXCLUDED.catalyst,
      score = EXCLUDED.score,
      direction = EXCLUDED.direction,
      source = EXCLUDED.source,
      updated_at = EXCLUDED.updated_at,
      expires_at = EXCLUDED.expires_at,
      active = TRUE,
      metadata = research_stars.metadata || EXCLUDED.metadata
  `, [
    star.symbol,
    star.sector,
    catalyst,
    Math.max(0, Math.min(1, star.score)),
    direction,
    star.source ?? 'gateway_v2',
    star.expiresAt ?? new Date(Date.now() + 4 * 3_600_000).toISOString(),
    JSON.stringify(star.metadata ?? {}),
  ]);
}

export async function getActiveResearchStars(options: ResearchStarOptions = {}): Promise<ResearchStarRow[]> {
  const { query } = await import('../../research-db/src/index.js');
  const { rows } = await query<{
    symbol: string;
    sector: string;
    catalyst: string;
    score: number;
    updated_at: Date | string;
  }>(`
    SELECT symbol, sector, catalyst, score, updated_at
      FROM research_stars
     WHERE active = TRUE
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY score DESC, updated_at DESC
     LIMIT 500
  `);
  const stars = rows.map((r) => ({
    symbol: r.symbol,
    sector: r.sector,
    catalyst: r.catalyst,
    score: Number(r.score),
    createdAt: new Date(r.updated_at).toISOString(),
  }));
  if (!options.includeRelated || stars.length === 0) return stars;
  return expandWithGraphNeighbors(stars);
}

export async function expireResearchStars(maxAgeHours = 4): Promise<number> {
  const { query } = await import('../../research-db/src/index.js');
  const { rowCount } = await query(`
    UPDATE research_stars
       SET active = FALSE, updated_at = NOW()
     WHERE active = TRUE
       AND updated_at < NOW() - ($1::text || ' hours')::interval
  `, [maxAgeHours]);
  return rowCount ?? 0;
}

async function expandWithGraphNeighbors(stars: ResearchStarRow[]): Promise<ResearchStarRow[]> {
  const symbols = [...new Set(stars.map((s) => s.symbol).filter(Boolean))];
  if (symbols.length === 0) return stars;

  try {
    const { query } = await import('../../research-db/src/index.js');
    const { rows } = await query<{
      symbol: string;
      neighbor: string;
      relationship: string;
      strength: number;
      lag_days: number | null;
    }>(`
      SELECT symbol, neighbor, relationship, strength, lag_days
        FROM mv_relationship_hops
       WHERE symbol = ANY($1)
         AND strength >= 0.45
       ORDER BY strength DESC
       LIMIT 500
    `, [symbols]);

    const bySymbol = new Map(stars.map((s) => [s.symbol, s]));
    const expanded = [...stars];
    for (const rel of rows) {
      if (!rel.neighbor || bySymbol.has(rel.neighbor)) continue;
      const source = bySymbol.get(rel.symbol);
      if (!source) continue;
      const strength = Math.max(0, Math.min(1, Number(rel.strength) || 0.5));
      const score = Math.min(0.97, source.score * (0.84 + strength * 0.16));
      const star: ResearchStarRow = {
        symbol: rel.neighbor,
        sector: source.sector,
        catalyst: `RELATED ${rel.relationship} from ${source.symbol}: ${source.catalyst}`,
        score,
        createdAt: source.createdAt,
      };
      bySymbol.set(star.symbol, star);
      expanded.push(star);
    }
    return expanded.sort((a, b) => b.score - a.score);
  } catch {
    return stars;
  }
}
