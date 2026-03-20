/**
 * Warren — Managing Director
 *
 * Oversees Fin (Trading), Liza (News), Ferd (Research).
 * Owns the P&L. Pushes the team to hit daily/weekly/monthly goals.
 * Self-heals when managers or workers go down. Generates family office briefings.
 *
 * 30-second heartbeat — the boss checks in often.
 */

import { GatewayStateStore } from '../../../gateway/src/state-store.js';
import { loadCredentials, getAlpacaHeaders } from '../config-bus.js';

const CYCLE_MS = 30_000;
const DAILY_GOAL = 500;
const WEEKLY_GOAL = 3500;
const MONTHLY_GOAL = 15000;
const MANAGER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes without report = unhealthy

type Urgency = 'normal' | 'elevated' | 'critical';

interface ManagerHealth {
  name: string;
  lastReport: string | null;
  healthy: boolean;
  lastAction: string;
}

interface Briefing {
  timestamp: string;
  urgency: Urgency;
  dailyPnl: number;
  dailyGoalPct: number;
  positions: number;
  deployed: number;
  managerHealth: ManagerHealth[];
  narrative: string;
  learnings: string[];
}

export class Warren {
  private store: GatewayStateStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cycleCount = 0;
  private running = false;

  constructor(dbPath: string) {
    this.store = new GatewayStateStore(dbPath);
  }

  start(): void {
    this.running = true;
    console.log('[Warren] Managing Director online — 30s cycle');
    this.cycle(); // run immediately
    this.timer = setInterval(() => this.cycle(), CYCLE_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.store.close();
    console.log('[Warren] Offline');
  }

  private async cycle(): Promise<void> {
    if (!this.running) return;
    this.cycleCount++;

    try {
      // 1. Check manager health
      const managers = this.checkManagerHealth();

      // 2. Get P&L and positions
      const { dailyPnl, positions, deployed } = await this.getPortfolioState();

      // 3. Determine urgency
      const urgency = this.calculateUrgency(dailyPnl);
      this.store.set('warren:urgency', urgency);

      // 4. Push managers based on urgency
      this.pushManagers(urgency, dailyPnl, managers);

      // 5. Dollar trailing — protect outsized winners
      await this.protectOutsizedWinners();

      // 6. Generate briefing
      const briefing = this.generateBriefing(urgency, dailyPnl, positions, deployed, managers);
      this.store.set('warren:briefing', JSON.stringify(briefing));

      // 7. Record learning
      this.recordLearning(
        `Cycle ${this.cycleCount}: P&L $${dailyPnl.toFixed(0)}, ${positions} pos, urgency=${urgency}`,
        urgency !== 'normal' ? `Pushing team: ${urgency}` : 'Monitoring — on track',
        dailyPnl >= DAILY_GOAL ? 'goal_met' : dailyPnl > 0 ? 'progressing' : 'behind',
        dailyPnl / DAILY_GOAL,
      );

      if (this.cycleCount % 10 === 0) { // Log every 5 minutes
        console.log(`[Warren] #${this.cycleCount} | P&L: $${dailyPnl.toFixed(0)}/${DAILY_GOAL} | ${positions} pos | ${urgency} | ${managers.filter(m => m.healthy).length}/${managers.length} healthy`);
      }
    } catch (e: any) {
      console.error(`[Warren] Cycle error: ${e.message}`);
    }
  }

  private checkManagerHealth(): ManagerHealth[] {
    const now = Date.now();
    const managers: ManagerHealth[] = [];

    for (const name of ['fin', 'liza', 'ferd']) {
      const raw = this.store.get(`manager:${name}:status`);
      let lastReport: string | null = null;
      let lastAction = 'unknown';
      let healthy = false;

      if (raw) {
        try {
          const status = JSON.parse(raw);
          lastReport = status.timestamp;
          lastAction = status.action || 'idle';
          healthy = lastReport ? (now - new Date(lastReport).getTime()) < MANAGER_TIMEOUT_MS : false;
        } catch {}
      }

      managers.push({ name, lastReport, healthy, lastAction });

      if (!healthy) {
        this.store.set(`manager:${name}:restart_requested`, 'true');
      }
    }

    return managers;
  }

  private async getPortfolioState(): Promise<{ dailyPnl: number; positions: number; deployed: number }> {
    const headers = getAlpacaHeaders();
    if (!headers) return { dailyPnl: 0, positions: 0, deployed: 0 };

    try {
      const creds = loadCredentials();
      const base = creds.alpaca?.baseUrl || 'https://paper-api.alpaca.markets';

      const [acctRes, posRes] = await Promise.all([
        fetch(`${base}/v2/account`, { headers, signal: AbortSignal.timeout(5000) }),
        fetch(`${base}/v2/positions`, { headers, signal: AbortSignal.timeout(5000) }),
      ]);

      const acct = acctRes.ok ? await acctRes.json() as any : null;
      const positions = posRes.ok ? await posRes.json() as any[] : [];

      const equity = parseFloat(acct?.equity || '0');
      const lastEquity = parseFloat(acct?.last_equity || '0');
      const dailyPnl = equity - lastEquity;
      const deployed = positions.reduce((s, p) => s + Math.abs(parseFloat(p.market_value || '0')), 0);

      return { dailyPnl, positions: positions.length, deployed };
    } catch {
      return { dailyPnl: 0, positions: 0, deployed: 0 };
    }
  }

  private calculateUrgency(dailyPnl: number): Urgency {
    const pct = dailyPnl / DAILY_GOAL;
    if (pct >= 1) return 'normal'; // goal met
    if (pct >= 0.3) return 'normal'; // on pace
    if (pct >= 0) return 'elevated'; // behind but positive
    return 'critical'; // losing money
  }

  private pushManagers(urgency: Urgency, dailyPnl: number, managers: ManagerHealth[]): void {
    this.store.set('warren:urgency', urgency);
    this.store.set('warren:daily_pnl', String(dailyPnl));

    if (urgency === 'critical') {
      this.store.set('fin:directive', 'tighten_stops_reduce_exposure');
      this.store.set('liza:directive', 'scan_urgently_find_catalysts');
      this.store.set('ferd:directive', 'focus_winning_sectors_only');
    } else if (urgency === 'elevated') {
      this.store.set('fin:directive', 'increase_position_count');
      this.store.set('liza:directive', 'prioritize_actionable_news');
      this.store.set('ferd:directive', 'broaden_sector_coverage');
    } else {
      this.store.set('fin:directive', 'steady_as_she_goes');
      this.store.set('liza:directive', 'standard_monitoring');
      this.store.set('ferd:directive', 'balanced_research');
    }
  }

  private async protectOutsizedWinners(): Promise<void> {
    const headers = getAlpacaHeaders();
    if (!headers) return;

    try {
      const creds = loadCredentials();
      const base = creds.alpaca?.baseUrl || 'https://paper-api.alpaca.markets';
      const res = await fetch(`${base}/v2/positions`, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const positions = await res.json() as any[];

      for (const pos of positions) {
        const pnl = parseFloat(pos.unrealized_pl || '0');
        const ticker = pos.symbol;

        // Bank outsized winners immediately — don't let $500+ slip away
        if (pnl >= 500) {
          console.log(`[Warren] BANKING outsized winner: ${ticker} +$${pnl.toFixed(0)}`);
          try {
            const qty = pos.qty;
            const side = parseFloat(pos.qty) > 0 ? 'sell' : 'buy';
            await fetch(`${base}/v2/orders`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ symbol: ticker, qty: Math.abs(parseFloat(qty)).toString(), side, type: 'market', time_in_force: ticker.includes('USD') ? 'gtc' : 'day' }),
              signal: AbortSignal.timeout(5000),
            });
            this.recordLearning(`Banked ${ticker} at +$${pnl.toFixed(0)}`, 'outsized_winner_protection', 'banked', pnl / 100);
          } catch (e: any) {
            console.error(`[Warren] Failed to bank ${ticker}: ${e.message}`);
          }
        }
      }
    } catch {}
  }

  private generateBriefing(urgency: Urgency, dailyPnl: number, positions: number, deployed: number, managers: ManagerHealth[]): Briefing {
    const healthyCount = managers.filter(m => m.healthy).length;
    const goalPct = Math.round((dailyPnl / DAILY_GOAL) * 100);

    const narrative = dailyPnl >= DAILY_GOAL
      ? `Daily goal achieved. P&L $${dailyPnl.toFixed(0)} on ${positions} positions. All managers ${healthyCount === 3 ? 'healthy' : 'need attention'}. Protecting gains.`
      : dailyPnl > 0
        ? `Making progress. $${dailyPnl.toFixed(0)} of $${DAILY_GOAL} target (${goalPct}%). ${positions} positions deployed with $${deployed.toFixed(0)} capital. ${urgency === 'elevated' ? 'Pushing team harder.' : 'Steady pace.'}`
        : `Behind target. P&L $${dailyPnl.toFixed(0)}. ${urgency} urgency. ${positions} positions. ${healthyCount}/3 managers reporting. Need catalyst plays to recover.`;

    return {
      timestamp: new Date().toISOString(),
      urgency,
      dailyPnl,
      dailyGoalPct: goalPct,
      positions,
      deployed,
      managerHealth: managers,
      narrative,
      learnings: this.getRecentLearnings(5),
    };
  }

  private recordLearning(observation: string, action: string, outcome: string, score: number): void {
    try {
      this.store.saveReport({
        id: `warren-learning-${Date.now()}`,
        agent: 'warren',
        type: 'learning',
        timestamp: new Date().toISOString(),
        summary: observation,
        findings: [action],
        signals: [],
        strategy: { action, rationale: observation, risk: outcome },
        meta: { score, outcome },
      });
    } catch {}
  }

  private getRecentLearnings(limit: number): string[] {
    try {
      const reports = this.store.getReports('warren', limit);
      return reports.map(r => `${r.summary} → ${r.strategy?.action || 'no action'} (${r.meta?.outcome || '?'})`);
    } catch { return []; }
  }

  getLearnings(): Array<{ observation: string; action: string; outcome: string; score: number }> {
    try {
      const reports = this.store.getReports('warren', 50);
      return reports.map(r => ({
        observation: r.summary,
        action: r.strategy?.action || '',
        outcome: String(r.meta?.outcome || ''),
        score: Number(r.meta?.score || 0),
      }));
    } catch { return []; }
  }

  getStatus(): { running: boolean; cycleCount: number; urgency: string } {
    return {
      running: this.running,
      cycleCount: this.cycleCount,
      urgency: this.store.get('warren:urgency') || 'unknown',
    };
  }
}
