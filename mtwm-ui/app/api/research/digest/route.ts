import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const [latestRes, intellRes, topRes, worstRes] = await Promise.all([
      fetch(`${GATEWAY}/api/research/latest`, { signal: controller.signal }).catch(() => null),
      fetch(`${GATEWAY}/api/intelligence`, { signal: controller.signal }).catch(() => null),
      fetch(`${GATEWAY}/api/intelligence/top-performers`, { signal: controller.signal }).catch(() => null),
      fetch(`${GATEWAY}/api/intelligence/worst-performers`, { signal: controller.signal }).catch(() => null),
    ]);

    clearTimeout(timeout);

    const latest = latestRes?.ok ? await latestRes.json() : {};
    const intel = intellRes?.ok ? await intellRes.json() : {};
    const topPerf = topRes?.ok ? await topRes.json() : { performers: [] };
    const worstPerf = worstRes?.ok ? await worstRes.json() : { performers: [] };

    // Also fetch news-desk reports
    const reportsRes = await fetch(`${GATEWAY}/api/research/reports?agent=news-desk&limit=1`).catch(() => null);
    const newsData = reportsRes?.ok ? await reportsRes.json() : { reports: [] };
    const newsReport = newsData.reports?.[0] || null;

    // Build digest sections
    const crypto = latest.crypto;
    const forex = latest.forex;
    // For US Markets, merge equity research with news-desk intelligence
    const equity = latest.equity || newsReport;

    // Classify top/worst performers
    const cryptoBases = ['BTC','ETH','SOL','AVAX','DOGE','SHIB','LINK','UNI','DOT','MATIC','XRP','NEAR','ADA','AAVE','LTC','BCH','SUSHI'];
    const isCrypto = (s: string) => cryptoBases.some(b => s.toUpperCase().startsWith(b));
    const isForex = (s: string) => s.includes('/') && !isCrypto(s);

    const topCrypto = (topPerf.performers || []).filter((p: any) => isCrypto(p.subject));
    const topEquity = (topPerf.performers || []).filter((p: any) => !isCrypto(p.subject) && !isForex(p.subject));
    const topForex = (topPerf.performers || []).filter((p: any) => isForex(p.subject));

    const worstCrypto = (worstPerf.performers || []).filter((p: any) => isCrypto(p.subject));
    const worstEquity = (worstPerf.performers || []).filter((p: any) => !isCrypto(p.subject) && !isForex(p.subject));
    const worstForex = (worstPerf.performers || []).filter((p: any) => isForex(p.subject));

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      usMarkets: {
        summary: equity?.summary || 'No equity research available',
        findings: equity?.findings || [],
        signals: equity?.signals || [],
        topPerformers: topEquity.slice(0, 5).map((p: any) => ({
          ticker: p.subject,
          winRate: Math.round(p.posterior * 100),
          observations: p.observations,
          avgReturn: p.avgReturn,
        })),
        worstPerformers: worstEquity.slice(0, 5).map((p: any) => ({
          ticker: p.subject,
          winRate: Math.round(p.posterior * 100),
          observations: p.observations,
          avgReturn: p.avgReturn,
        })),
        lastUpdated: equity?.timestamp || null,
      },
      crypto: {
        summary: crypto?.summary || 'No crypto research available',
        findings: crypto?.findings || [],
        signals: crypto?.signals || [],
        topPerformers: topCrypto.slice(0, 5).map((p: any) => ({
          ticker: p.subject,
          winRate: Math.round(p.posterior * 100),
          observations: p.observations,
          avgReturn: p.avgReturn,
        })),
        worstPerformers: worstCrypto.slice(0, 5).map((p: any) => ({
          ticker: p.subject,
          winRate: Math.round(p.posterior * 100),
          observations: p.observations,
          avgReturn: p.avgReturn,
        })),
        lastUpdated: crypto?.timestamp || null,
      },
      forex: {
        summary: forex?.summary || 'No forex research available',
        findings: forex?.findings || [],
        signals: forex?.signals || [],
        topPerformers: topForex.slice(0, 5).map((p: any) => ({
          ticker: p.subject,
          winRate: Math.round(p.posterior * 100),
          observations: p.observations,
          avgReturn: p.avgReturn,
        })),
        worstPerformers: worstForex.slice(0, 5).map((p: any) => ({
          ticker: p.subject,
          winRate: Math.round(p.posterior * 100),
          observations: p.observations,
          avgReturn: p.avgReturn,
        })),
        lastUpdated: forex?.timestamp || null,
      },
      intelligence: {
        totalBeliefs: intel.totalBeliefs || 0,
        totalObservations: intel.totalObservations || 0,
      },
    });
  } catch {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      usMarkets: { summary: 'Unavailable', findings: [], signals: [], topPerformers: [], worstPerformers: [], lastUpdated: null },
      crypto: { summary: 'Unavailable', findings: [], signals: [], topPerformers: [], worstPerformers: [], lastUpdated: null },
      forex: { summary: 'Unavailable', findings: [], signals: [], topPerformers: [], worstPerformers: [], lastUpdated: null },
      intelligence: { totalBeliefs: 0, totalObservations: 0 },
    });
  }
}
