import type { ResearchStarRow } from '../../gateway/src/state-store.js';

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

export async function getActiveResearchStars(): Promise<ResearchStarRow[]> {
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
  return rows.map((r) => ({
    symbol: r.symbol,
    sector: r.sector,
    catalyst: r.catalyst,
    score: Number(r.score),
    createdAt: new Date(r.updated_at).toISOString(),
  }));
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
