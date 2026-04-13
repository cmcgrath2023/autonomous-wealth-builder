import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET() {
  try {
    // Fetch from multiple gateway endpoints in parallel
    const [tridentRes, statusRes, portfolioRes] = await Promise.all([
      fetch(`${GATEWAY}/api/intelligence/trident`).catch(() => null),
      fetch(`${GATEWAY}/api/status`).catch(() => null),
      fetch(`${GATEWAY}/api/broker/positions`).catch(() => null),
    ]);

    const trident = tridentRes?.ok ? await tridentRes.json() : null;
    const status = statusRes?.ok ? await statusRes.json() : null;

    // Build plain-English summaries
    const summaries: string[] = [];
    const learnings: Array<{ icon: string; text: string; type: 'good' | 'bad' | 'info' }> = [];

    // SONA status
    const sona = trident?.sona;
    const cognitive = trident?.cognitive;
    if (sona?.connected) {
      summaries.push(`Brain is connected (tier: ${sona.tier}). ${sona.patterns?.toLocaleString() || 0} SONA patterns learned from ${sona.memories || 0} memories.`);
      if (cognitive?.sonaMessage) {
        learnings.push({ icon: '🧠', text: cognitive.sonaMessage, type: 'info' });
      }
      if (cognitive?.driftStatus && cognitive.driftStatus !== 'unknown') {
        learnings.push({ icon: cognitive.driftStatus === 'stable' ? '✅' : '⚠️', text: `Knowledge drift: ${cognitive.driftStatus}`, type: cognitive.driftStatus === 'stable' ? 'good' : 'info' });
      }
    } else {
      summaries.push('Brain is NOT connected. The system cannot learn from trades or reason about buys/sells.');
    }

    // Parse Trident memories for trade history
    const memories = trident?.memories || [];
    const wins = memories.filter((m: any) => (m.title || '').includes('WIN'));
    const losses = memories.filter((m: any) => (m.title || '').includes('LOSS'));
    if (wins.length + losses.length > 0) {
      const winRate = wins.length / (wins.length + losses.length) * 100;
      summaries.push(`Trade memory: ${wins.length} wins, ${losses.length} losses (${winRate.toFixed(0)}% win rate).`);

      // Extract top winning tickers
      const winTickers: Record<string, number> = {};
      for (const m of wins) {
        const match = (m.title || '').match(/WIN:\s*(\S+)/);
        if (match) winTickers[match[1]] = (winTickers[match[1]] || 0) + 1;
      }
      const topWinners = Object.entries(winTickers).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (topWinners.length > 0) {
        learnings.push({ icon: '📈', text: `Best tickers: ${topWinners.map(([t, n]) => `${t} (${n}W)`).join(', ')}`, type: 'good' });
      }

      // Extract top losing tickers
      const lossTickers: Record<string, number> = {};
      for (const m of losses) {
        const match = (m.title || '').match(/LOSS:\s*(\S+)/);
        if (match) lossTickers[match[1]] = (lossTickers[match[1]] || 0) + 1;
      }
      const topLosers = Object.entries(lossTickers).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (topLosers.length > 0) {
        learnings.push({ icon: '📉', text: `Worst tickers: ${topLosers.map(([t, n]) => `${t} (${n}L)`).join(', ')}`, type: 'bad' });
      }
    }

    // Parse rules / theses from memories
    const rules = memories.filter((m: any) => {
      const t = (m.title || '').toLowerCase();
      return t.includes('rule') || t.includes('circuit') || t.includes('post-mortem');
    });
    if (rules.length > 0) {
      learnings.push({ icon: '🛡️', text: `${rules.length} risk rules/events recorded in brain memory`, type: 'info' });
    }

    const theses = memories.filter((m: any) => (m.title || '').includes('THESIS'));
    if (theses.length > 0) {
      learnings.push({ icon: '🔬', text: `${theses.length} research theses stored in brain`, type: 'info' });
    }

    // Bayesian intelligence
    const bayesianRaw = status?.bayesianIntel;
    if (bayesianRaw?.totalBeliefs > 0) {
      summaries.push(`Bayesian: tracking ${bayesianRaw.totalBeliefs} beliefs across ${bayesianRaw.totalObservations} observations.`);
      if (bayesianRaw.topInsights?.length > 0) {
        for (const insight of bayesianRaw.topInsights.slice(0, 3)) {
          learnings.push({ icon: '📊', text: insight, type: 'info' });
        }
      }
    }

    // System status
    if (status?.uptime) {
      const uptimeHours = Math.round(status.uptime / 3600);
      summaries.push(`System uptime: ${uptimeHours}h. Heartbeat running.`);
    }

    // Memory counts
    const counts = trident?.counts;
    if (counts) {
      learnings.push({
        icon: '💾',
        text: `Brain contains: ${counts.outcomes || 0} trade outcomes, ${counts.entries || 0} entries, ${counts.research || 0} research, ${counts.rules || 0} rules, ${counts.dailies || 0} daily summaries`,
        type: 'info',
      });
    }

    return NextResponse.json({
      connected: sona?.connected ?? false,
      sonaPatterns: sona?.patterns ?? 0,
      sonaMemories: sona?.memories ?? 0,
      sonaTier: sona?.tier ?? 'unknown',
      sonaMessage: cognitive?.sonaMessage ?? '',
      loraEpoch: cognitive?.loraEpoch ?? 0,
      driftStatus: cognitive?.driftStatus ?? 'unknown',
      tradeWins: wins.length,
      tradeLosses: losses.length,
      summary: summaries.join(' '),
      learnings,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({
      connected: false,
      sonaPatterns: 0,
      sonaMemories: 0,
      sonaTier: 'error',
      sonaMessage: err.message,
      loraEpoch: 0,
      driftStatus: 'error',
      tradeWins: 0,
      tradeLosses: 0,
      summary: 'Failed to fetch intelligence data.',
      learnings: [],
      lastUpdated: new Date().toISOString(),
    });
  }
}
