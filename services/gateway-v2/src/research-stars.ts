import type { ResearchStarRow } from '../../gateway/src/state-store.js';
import { GatewayStateStore } from '../../gateway/src/state-store.js';

export async function getActiveResearchStars(fallbackStore?: GatewayStateStore): Promise<ResearchStarRow[]> {
  try {
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
  } catch (e: any) {
    if (process.env.LOG_RESEARCH_STAR_PG_ERRORS === 'true') {
      console.warn(`[research-stars] PG read failed, using SQLite fallback: ${e.message}`);
    }
    return fallbackStore?.getResearchStars() ?? [];
  }
}
