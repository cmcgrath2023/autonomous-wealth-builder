/**
 * Liza — News Desk Manager (OpenClaw Pattern)
 *
 * Monitors news/event intelligence on a 90-second heartbeat.
 * Detects critical events, tracks economic calendar, computes
 * market sentiment, and writes catalyst themes to state store.
 */

import { GatewayStateStore } from '../../../gateway/src/state-store.js';

const LOOP_MS = 90_000;
const NEWS_STALE_MS = 5 * 60_000;
const FETCH_TIMEOUT = 10_000;

const RSS_FEEDS = [
  { name: 'Yahoo SP500', url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US' },
  { name: 'CNBC Top', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
  { name: 'CNBC Market', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258' },
];

const CRITICAL_KEYWORDS = [
  'fomc', 'fed rate', 'interest rate decision', 'cpi report', 'nonfarm payroll',
  'earnings', 'gdp', 'inflation', 'tariff', 'sanctions', 'war', 'invasion',
  'default', 'recession', 'crash', 'emergency', 'black swan',
];

const CATALYST_THEMES: Record<string, string[]> = {
  energy: ['oil', 'crude', 'opec', 'pipeline', 'lng', 'energy crisis'],
  tech_ai: ['ai', 'artificial intelligence', 'gpu', 'nvidia', 'data center', 'semiconductor'],
  defense: ['military', 'defense', 'war', 'missile', 'pentagon', 'nato'],
  crypto: ['bitcoin', 'crypto', 'ethereum', 'defi', 'sec crypto', 'stablecoin'],
  macro: ['fed', 'inflation', 'recession', 'gdp', 'unemployment', 'treasury'],
  metals: ['gold', 'silver', 'copper', 'mining', 'rare earth'],
};

const BULL_RE = /surge|rally|soar|jump|gain|climb|beat|record|high|upgrade|bull|boom|strong|breakout/gi;
const BEAR_RE = /crash|drop|plunge|fall|sink|miss|low|downgrade|bear|bust|weak|cut|fear|risk|war|sell/gi;

// FOMC/CPI/NFP schedule awareness (approximate — first Wed/10th/first Fri)
const ECON_EVENTS = [
  { name: 'FOMC', dayOfWeek: 3, weekOfMonth: 3, critical: true },
  { name: 'CPI', dayOfMonth: 10, critical: true },
  { name: 'NFP', dayOfWeek: 5, weekOfMonth: 1, critical: true },
];

interface LizaStatus {
  lastCycle: string;
  cycleCount: number;
  headlineCount: number;
  sentiment: { score: number; label: string };
  activeCatalysts: string[];
  criticalEvents: string[];
  newsAge: string;
}

export class Liza {
  private store: GatewayStateStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cycleCount = 0;
  private lastStatus: LizaStatus | null = null;

  constructor(dbPath: string) {
    this.store = new GatewayStateStore(dbPath);
  }

  async start(): Promise<void> {
    console.log('[Liza] News Desk Manager starting — 90s loop');
    await this.cycle();
    this.timer = setInterval(() => {
      this.cycle().catch((e) => console.error('[Liza] Cycle error (non-fatal):', e));
    }, LOOP_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    try { this.store.close(); } catch {}
    console.log('[Liza] Stopped');
  }

  getStatus(): LizaStatus | null {
    return this.lastStatus;
  }

  private async cycle(): Promise<void> {
    this.cycleCount++;
    const now = new Date().toISOString();

    try {
      // 1. Check news freshness — trigger scan if stale
      const newsAge = this.checkNewsFreshness();

      // 2. Scan headlines
      const headlines = await this.scanHeadlines();

      // 3. Detect critical events
      const criticalEvents = this.detectCritical(headlines);
      if (criticalEvents.length > 0) {
        console.log(`[Liza] CRITICAL events detected: ${criticalEvents.join(' | ')}`);
        this.store.set('critical_events', JSON.stringify({
          events: criticalEvents, detectedAt: now, detectedBy: 'liza',
        }));
      }

      // 4. Check economic calendar
      const calendarAlerts = this.checkEconomicCalendar();
      if (calendarAlerts.length > 0) {
        this.store.set('econ_calendar_alerts', JSON.stringify({
          alerts: calendarAlerts, checkedAt: now,
        }));
      }

      // 5. Detect catalyst themes
      const activeCatalysts = this.detectCatalysts(headlines);
      this.store.set('active_catalysts', JSON.stringify({
        catalysts: activeCatalysts, updatedAt: now, updatedBy: 'liza',
      }));

      // 6. Compute sentiment score
      const sentiment = this.computeSentiment(headlines);
      this.store.set('market_sentiment', JSON.stringify({
        score: sentiment.score, label: sentiment.label,
        headlineCount: headlines.length, updatedAt: now,
      }));

      // 7. Write status
      this.lastStatus = {
        lastCycle: now, cycleCount: this.cycleCount,
        headlineCount: headlines.length, sentiment,
        activeCatalysts, criticalEvents, newsAge,
      };
      this.store.set('manager_liza_status', JSON.stringify(this.lastStatus));

      if (this.cycleCount % 4 === 1) {
        console.log(
          `[Liza] #${this.cycleCount} | ${headlines.length} headlines | ` +
          `Sentiment: ${sentiment.label} (${sentiment.score.toFixed(2)}) | ` +
          `Catalysts: ${activeCatalysts.join(', ') || 'none'} | ` +
          `Critical: ${criticalEvents.length}`,
        );
      }
    } catch (e: any) {
      console.error(`[Liza] Cycle #${this.cycleCount} error:`, e.message);
    }
  }

  private checkNewsFreshness(): string {
    try {
      const raw = this.store.get('last_news_scan');
      if (!raw) return 'never';
      const parsed = JSON.parse(raw);
      const age = Date.now() - new Date(parsed.timestamp).getTime();
      if (age > NEWS_STALE_MS) {
        this.store.set('news_scan_request', JSON.stringify({
          reason: 'stale', requestedBy: 'liza', requestedAt: new Date().toISOString(), ageMs: age,
        }));
        return `stale (${Math.round(age / 60_000)}m)`;
      }
      return `fresh (${Math.round(age / 60_000)}m)`;
    } catch { return 'unknown'; }
  }

  private async scanHeadlines(): Promise<string[]> {
    const headlines: string[] = [];
    const results = await Promise.allSettled(
      RSS_FEEDS.map(async (feed) => {
        const res = await fetch(feed.url, {
          headers: { 'User-Agent': 'MTWM-Liza/1.0' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
        if (!res.ok) return [];
        const xml = await res.text();
        const titles: string[] = [];
        const re = /<item>[\s\S]*?<\/item>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(xml)) !== null) {
          const t = m[0].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
          if (t) titles.push(t[1].trim());
        }
        return titles;
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') headlines.push(...r.value);
    }
    // Record scan timestamp
    this.store.set('last_news_scan', JSON.stringify({ timestamp: new Date().toISOString(), count: headlines.length }));
    return headlines;
  }

  private detectCritical(headlines: string[]): string[] {
    const found: string[] = [];
    for (const h of headlines) {
      const lower = h.toLowerCase();
      for (const kw of CRITICAL_KEYWORDS) {
        if (lower.includes(kw) && !found.includes(h)) {
          found.push(h);
          break;
        }
      }
    }
    return found.slice(0, 10);
  }

  private checkEconomicCalendar(): string[] {
    const now = new Date();
    const day = now.getDay();
    const date = now.getDate();
    const weekNum = Math.ceil(date / 7);
    const alerts: string[] = [];

    for (const evt of ECON_EVENTS) {
      if ('dayOfMonth' in evt && evt.dayOfMonth !== undefined) {
        const diff = (evt.dayOfMonth as number) - date;
        if (diff >= 0 && diff <= 2) alerts.push(`${evt.name} in ${diff} day(s)`);
      }
      if ('dayOfWeek' in evt && evt.dayOfWeek !== undefined && 'weekOfMonth' in evt) {
        if (day === evt.dayOfWeek && weekNum === evt.weekOfMonth) {
          alerts.push(`${evt.name} TODAY`);
        } else if (evt.dayOfWeek - day === 1 && weekNum === evt.weekOfMonth) {
          alerts.push(`${evt.name} TOMORROW`);
        }
      }
    }
    return alerts;
  }

  private detectCatalysts(headlines: string[]): string[] {
    const active: string[] = [];
    const combined = headlines.join(' ').toLowerCase();
    for (const [theme, keywords] of Object.entries(CATALYST_THEMES)) {
      const hits = keywords.filter((kw) => combined.includes(kw)).length;
      if (hits >= 2) active.push(theme);
    }
    return active;
  }

  private computeSentiment(headlines: string[]): { score: number; label: string } {
    let bull = 0;
    let bear = 0;
    for (const h of headlines) {
      bull += (h.match(BULL_RE) || []).length;
      bear += (h.match(BEAR_RE) || []).length;
    }
    const total = bull + bear || 1;
    const score = (bull - bear) / total; // -1 to +1
    const label = score > 0.2 ? 'bullish' : score < -0.2 ? 'bearish' : 'neutral';
    return { score, label };
  }
}
