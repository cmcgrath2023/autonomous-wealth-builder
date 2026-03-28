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
import { brain } from '../brain-client.js';

async function postToDiscord(text: string): Promise<void> {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
}

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

      // 7. Autonomous MD Review — Warren thinks and acts using Brain reasoning
      // Every 20 cycles (~10 min), Warren evaluates the team and issues directives
      if (this.cycleCount % 20 === 0 && this.cycleCount > 5) {
        try {
          await this.runTeamReview(dailyPnl, positions, deployed, managers, urgency);
        } catch (e: any) {
          console.error(`[Warren] Team review error: ${e.message}`);
        }
      }

      // 8. Record learning
      this.recordLearning(
        `Cycle ${this.cycleCount}: P&L $${dailyPnl.toFixed(0)}, ${positions} pos, urgency=${urgency}`,
        urgency !== 'normal' ? `Pushing team: ${urgency}` : 'Monitoring — on track',
        dailyPnl >= DAILY_GOAL ? 'goal_met' : dailyPnl > 0 ? 'progressing' : 'behind',
        dailyPnl / DAILY_GOAL,
      );

      if (this.cycleCount % 10 === 0) { // Log every 5 minutes
        console.log(`[Warren] #${this.cycleCount} | P&L: $${dailyPnl.toFixed(0)}/${DAILY_GOAL} | ${positions} pos | ${urgency} | ${managers.filter(m => m.healthy).length}/${managers.length} healthy`);
      }

      // Post to Discord on: urgency changes, market open, market close, and hourly during market
      const now = new Date();
      const etTime = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false });
      const [etHourStr, etMinStr] = etTime.split(':');
      const etHour = parseInt(etHourStr);
      const etMin = parseInt(etMinStr || '0');
      const etDayName = now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
      const isWeekday = !['Sat', 'Sun'].includes(etDayName);
      const isSunday = etDayName === 'Sun';
      const isMarketHours = isWeekday && etHour >= 9 && etHour < 17;
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
      const today = now.toISOString().slice(0, 10);

      if (this.cycleCount > 3) {
        const prevUrgency = this.store.get('warren:prev_urgency') || '';
        const unhealthyManagers = managers.filter(m => !m.healthy);

        // Urgency change — weekdays only
        if (isWeekday && urgency !== prevUrgency) {
          this.store.set('warren:prev_urgency', urgency);
          await postToDiscord(`👔 **Warren** ${urgency === 'critical' ? '🚨' : urgency === 'elevated' ? '⚡' : ''}\n${briefing.narrative}`);
        }

        // Market open briefing (9:30-9:35 ET, weekdays)
        const lastOpenPost = this.store.get('warren:last_open_post') || '';
        if (isWeekday && etHour === 9 && etMin >= 30 && etMin <= 35 && lastOpenPost !== today) {
          this.store.set('warren:last_open_post', today);
          await postToDiscord(`👔 **Warren** [${timeStr} ET] 🔔 MARKET OPEN\n${briefing.narrative}`);
        }

        // Market close summary (4:00-4:05 ET, weekdays)
        const lastClosePost = this.store.get('warren:last_close_post') || '';
        if (isWeekday && etHour === 16 && etMin <= 5 && lastClosePost !== today) {
          this.store.set('warren:last_close_post', today);
          const pnlEmoji = dailyPnl >= 0 ? '📈' : '📉';
          await postToDiscord(`👔 **Warren** [${timeStr} ET] ${pnlEmoji} MARKET CLOSE\nDaily P&L: $${dailyPnl.toFixed(2)} | ${positions} positions | ${deployed > 0 ? '$' + deployed.toFixed(0) + ' deployed' : 'flat'}\n${briefing.narrative}`);
        }

        // Hourly heartbeat — weekdays during market hours ONLY
        const lastHourlyPost = parseInt(this.store.get('warren:last_hourly_hour') || '-1');
        if (isMarketHours && etMin <= 2 && etHour !== lastHourlyPost) {
          this.store.set('warren:last_hourly_hour', String(etHour));
          await postToDiscord(`👔 **Warren** [${timeStr} ET]\n${briefing.narrative}`);
        }

        // Sunday evening weekly plan (6:00-6:05 PM ET)
        const lastWeeklyPost = this.store.get('warren:last_weekly_post') || '';
        if (isSunday && etHour === 18 && etMin <= 5 && lastWeeklyPost !== today) {
          this.store.set('warren:last_weekly_post', today);
          await postToDiscord(`👔 **Warren** [${timeStr} ET] 📋 WEEKLY PLAN\n${briefing.narrative}\n\nUpdated morning briefing at 7:00 AM ET Monday.`);
        }

        // Manager health alerts — weekdays only
        if (isWeekday && unhealthyManagers.length > 0 && this.cycleCount % 60 === 0) {
          await postToDiscord(`👔 **Warren** ⚠️\nManagers down: ${unhealthyManagers.map(m => m.name).join(', ')} — restarting`);
        }
      } else {
        this.store.set('warren:prev_urgency', urgency);
      }
    } catch (e: any) {
      console.error(`[Warren] Cycle error: ${e.message}`);
    }
  }

  private checkManagerHealth(): ManagerHealth[] {
    const now = Date.now();
    const managers: ManagerHealth[] = [];

    for (const name of ['fin', 'liza', 'ferd']) {
      const raw = this.store.get(`manager_${name}_status`) || this.store.get(`manager:${name}:status`);
      let lastReport: string | null = null;
      let lastAction = 'unknown';
      let healthy = false;

      if (raw) {
        try {
          const status = JSON.parse(raw);
          lastReport = status.lastCycle || status.lastScan || status.timestamp || null;
          lastAction = status.action || status.actions?.[0] || 'idle';
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

  private lastPushedUrgency: Urgency | null = null;

  private pushManagers(urgency: Urgency, dailyPnl: number, managers: ManagerHealth[]): void {
    this.store.set('warren:daily_pnl', String(dailyPnl));

    // Only push directives when urgency actually changes — prevents overwriting every 30s
    if (urgency === this.lastPushedUrgency) return;
    this.lastPushedUrgency = urgency;

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
          await postToDiscord(`👔 **Warren** 💰\nBANKING outsized winner: ${ticker} +$${pnl.toFixed(0)}`);
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

  // ── Autonomous Team Review — Warren as thinking MD ────────────────────

  private async runTeamReview(dailyPnl: number, positions: number, deployed: number, managers: ManagerHealth[], urgency: Urgency): Promise<void> {
    const finStatus = this.store.get('manager_fin_status');
    const lizaStatus = this.store.get('manager_liza_status');
    const ferdStatus = this.store.get('manager_ferd_status');
    const forexRaw = this.store.get('forex_positions');
    const tradeStatus = this.store.get('trade_engine_status');

    const context = [
      `Daily P&L: $${dailyPnl.toFixed(2)} of $${DAILY_GOAL} target (${Math.round(dailyPnl/DAILY_GOAL*100)}%)`,
      `Positions: ${positions}, Deployed: $${deployed.toFixed(0)}, Urgency: ${urgency}`,
      `Managers: ${managers.map(m => `${m.name}=${m.healthy?'UP':'DOWN'}`).join(', ')}`,
      finStatus ? `Fin: ${JSON.parse(finStatus).actions?.slice(0,3).join('; ') || 'idle'}` : 'Fin: no report',
      lizaStatus ? `Liza: ${JSON.parse(lizaStatus).lastAction || 'idle'}` : 'Liza: no report',
      ferdStatus ? `Ferd: ${JSON.parse(ferdStatus).lastAction || 'idle'}` : 'Ferd: no report',
      tradeStatus ? `TradeEngine: heartbeat ${JSON.parse(tradeStatus).heartbeatNumber || 0}` : 'TradeEngine: no status',
    ].join('\n');

    // Ask Brain for strategic assessment
    const BRAIN_URL = process.env.BRAIN_SERVER_URL || 'https://brain.oceanicai.io';
    const brainKey = process.env.BRAIN_API_KEY || '';
    const brainHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (brainKey) brainHeaders['Authorization'] = `Bearer ${brainKey}`;

    try {
      const res = await fetch(`${BRAIN_URL}/v1/transfer`, {
        method: 'POST',
        headers: brainHeaders,
        body: JSON.stringify({
          prompt: `You are Warren, MD of Deep Canyon trading desk. Review the team's performance and issue 2-3 specific directives. Be blunt. What needs to change RIGHT NOW to hit the $500 daily target?`,
          context,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const data = await res.json() as any;
        const review = typeof data.response === 'string' ? data.response : JSON.stringify(data.response);

        console.log(`[Warren] TEAM REVIEW: ${review.substring(0, 200)}`);

        // Store directives for other managers to read
        this.store.set('warren:team_review', JSON.stringify({
          review: review.substring(0, 500),
          timestamp: new Date().toISOString(),
          dailyPnl,
          urgency,
        }));

        // Post to Discord if we're behind target
        if (dailyPnl < DAILY_GOAL * 0.5) {
          await postToDiscord(`👔 **Warren** 📋 TEAM REVIEW\n${review.substring(0, 400)}`);
        }

        // Record to Brain for historical tracking
        brain.recordRule(`TEAM REVIEW: P&L $${dailyPnl.toFixed(0)} | ${review.substring(0, 200)}`, 'warren:review').catch(() => {});
      }
    } catch (e: any) {
      // Brain unavailable — issue basic directives based on rules
      if (dailyPnl < 0) {
        this.store.set('fin:directive', 'tighten_stops_reduce_exposure');
        console.log('[Warren] Brain offline — issuing defensive directives');
      }
      if (positions < 4) {
        this.store.set('fin:directive', 'fill_open_slots');
        console.log('[Warren] Brain offline — need more positions');
      }
    }

    // Check specific issues and act
    // Issue 1: Empty forex positions = wasted capital
    try {
      const fxRes = await fetch('http://localhost:3003/api/forex/positions', { signal: AbortSignal.timeout(5000) });
      if (fxRes.ok) {
        const fxData = await fxRes.json() as any;
        if ((fxData.count || 0) < 2) {
          console.log(`[Warren] DIRECTIVE: Forex only ${fxData.count} positions — need more. 25K buying power sitting idle.`);
          this.store.set('warren:forex_directive', 'increase_positions');
        }
      }
    } catch {}

    // Issue 2: Trade engine not running
    if (tradeStatus) {
      try {
        const ts = JSON.parse(tradeStatus);
        const age = Date.now() - new Date(ts.lastHeartbeat || 0).getTime();
        if (age > 5 * 60_000) {
          console.log(`[Warren] CRITICAL: Trade engine stale ${Math.round(age/60_000)}m — demanding restart`);
          await postToDiscord(`👔 **Warren** 🚨\nTrade engine down for ${Math.round(age/60_000)} minutes! Tara, fix this NOW.`);
          this.store.set('restart_request:trade_engine', new Date().toISOString());
        }
      } catch {}
    }

    // Issue 3: No research stars = blind trading
    try {
      const stars = this.store.getResearchStars();
      if (stars.length < 3) {
        console.log(`[Warren] DIRECTIVE: Only ${stars.length} research stars — Ferd needs to deliver more picks`);
        this.store.set('ferd:directive', 'urgent_research_needed');
      }
    } catch {}
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
