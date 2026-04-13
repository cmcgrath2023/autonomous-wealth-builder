/**
 * Post-Mortem Analyst — Wave 1 analyst (learning loop)
 *
 * Runs daily at 4:05 PM ET (after market close) and on-demand. Analyzes
 * every losing trade from that day and produces machine-readable rules
 * that the Risk Manager enforces on subsequent buys. This is how yesterday's
 * losses become tomorrow's filters.
 *
 * Origin: 2026-04-10 incident — a single AFJKU trade (-$6,411) should have
 * been blockable in advance. The loop is: Post-Mortem sees it → writes rule
 * "daily_volume < 150000 → block" → Risk Manager enforces it tomorrow.
 *
 * Uses Haiku (cheap) and returns quickly. No web search, no tool use. Pure
 * reasoning over the closed_trades table.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { GatewayStateStore, ClosedTradeRow, RiskRuleRow } from '../../../gateway/src/state-store.js';
import type { BrainClient } from '../brain-client.js';

const POST_MORTEM_MODEL = 'claude-haiku-4-5-20251001';
const SPAC_SUFFIX_RE = /^[A-Z]{2,5}(U|W|WS|UN)$/;

interface PostMortemRuleDraft {
  ruleType: 'block_pattern' | 'adjust_gate' | 'adjust_sizing' | 'add_filter' | 'none';
  description: string;
  rule: {
    field: string;
    operator: 'gt' | 'lt' | 'eq' | 'contains' | 'matches';
    value: string | number;
    action: 'block' | 'downsize_50' | 'require_catalyst';
  };
  evidence: string;
  pnlImpact: number;
}

export interface PostMortemResult {
  date: string;
  tradesAnalyzed: number;
  losingTrades: number;
  totalLoss: number;
  rulesGenerated: number;
  rules: RiskRuleRow[];
  error?: string;
}

export class PostMortemAnalyst {
  private client: Anthropic | null;
  private store: GatewayStateStore;
  private brain: BrainClient | null;

  constructor(store: GatewayStateStore, brain?: BrainClient | null) {
    this.store = store;
    this.brain = brain ?? null;
    // LLM is optional. If ANTHROPIC_API_KEY is set, use it for richer analysis.
    // If not, fall back to deterministic rule generation from the trade data.
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        this.client = new Anthropic();
      } catch {
        this.client = null;
      }
    } else {
      this.client = null;
    }
  }

  async runDailyPostMortem(dateOverride?: string): Promise<PostMortemResult> {
    const todayStr = dateOverride ?? new Date().toISOString().slice(0, 10);

    // Pull all closed_trades for the target day
    const allClosed = this.store.getClosedTrades(500);
    const closedToday = allClosed.filter(t => (t.closedAt || '').startsWith(todayStr));

    const baseResult: PostMortemResult = {
      date: todayStr,
      tradesAnalyzed: closedToday.length,
      losingTrades: 0,
      totalLoss: 0,
      rulesGenerated: 0,
      rules: [],
    };

    if (closedToday.length === 0) {
      console.log('[POST-MORTEM] No closed trades today. Nothing to analyze.');
      return baseResult;
    }

    const losses = closedToday.filter(t => (t.pnl || 0) < 0);
    const totalLoss = losses.reduce((sum, t) => sum + (t.pnl || 0), 0);
    baseResult.losingTrades = losses.length;
    baseResult.totalLoss = Math.round(totalLoss * 100) / 100;

    if (losses.length === 0) {
      console.log(`[POST-MORTEM] ${closedToday.length} trades today, all profitable. No rules needed.`);
      return baseResult;
    }

    console.log(`[POST-MORTEM] Analyzing ${losses.length} losing trades today (total: $${totalLoss.toFixed(2)})`);

    // Get existing active rules so we don't duplicate them
    const existingRules = this.store.getActiveRiskRules();

    let drafts: PostMortemRuleDraft[] = [];

    // Primary path: LLM-assisted rule generation (when ANTHROPIC_API_KEY is set)
    if (this.client) {
      try {
        const prompt = this.buildPrompt(losses, existingRules);
        const response = await this.client.messages.create({
          model: POST_MORTEM_MODEL,
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        });
        const text = response.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('');
        drafts = this.parseRules(text);
        console.log(`[POST-MORTEM] LLM path produced ${drafts.length} rule drafts`);
      } catch (e: any) {
        console.error(`[POST-MORTEM] LLM call failed, falling back to deterministic: ${e.message}`);
        drafts = this.deterministicRules(losses, existingRules);
      }
    } else {
      // Fallback path: deterministic pattern matching. Still produces valuable
      // rules — SPAC suffix, magnitude-based volume, reason patterns.
      console.log('[POST-MORTEM] No ANTHROPIC_API_KEY — using deterministic rule generation');
      drafts = this.deterministicRules(losses, existingRules);
    }

    // Persist non-'none' drafts to the store
    const persistedRules: RiskRuleRow[] = [];
    for (const draft of drafts) {
      if (draft.ruleType === 'none') continue;
      const rule: RiskRuleRow = {
        id: `pm-${todayStr}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        source: 'post_mortem',
        ruleType: draft.ruleType as RiskRuleRow['ruleType'],
        description: draft.description,
        field: draft.rule.field,
        operator: draft.rule.operator,
        value: String(draft.rule.value),
        action: draft.rule.action,
        evidence: draft.evidence,
        pnlImpact: draft.pnlImpact,
        active: true,
      };
      this.store.addRiskRule(rule);
      persistedRules.push(rule);
      console.log(`[POST-MORTEM] New rule: ${rule.description} (would save $${rule.pnlImpact.toFixed(2)})`);
    }

    // Fire-and-forget Trident regret signal (doesn't block the return)
    if (this.brain && typeof (this.brain as any).recordRule === 'function') {
      const worst = [...losses].sort((a, b) => (a.pnl || 0) - (b.pnl || 0))[0];
      (this.brain as any).recordRule(
        `POST-MORTEM ${todayStr}: ${losses.length} losses totaling $${totalLoss.toFixed(2)}. Worst: ${worst.ticker} ($${(worst.pnl || 0).toFixed(2)}). ${persistedRules.length} rules generated.`,
        'post_mortem',
      ).catch(() => { /* best-effort */ });
    }

    return {
      ...baseResult,
      rulesGenerated: persistedRules.length,
      rules: persistedRules,
    };
  }

  /**
   * Deterministic rule generator — runs when no LLM is available.
   * Applies fixed heuristics to the loss data and produces rules that target
   * the specific failure patterns we've seen. Not as rich as the LLM path,
   * but it doesn't depend on external credentials and is guaranteed to produce
   * output for any recognizable failure pattern.
   */
  private deterministicRules(losses: ClosedTradeRow[], existingRules: RiskRuleRow[]): PostMortemRuleDraft[] {
    const drafts: PostMortemRuleDraft[] = [];
    const existingKeys = new Set(existingRules.map(r => `${r.field}|${r.operator}|${r.value}|${r.action}`));
    const addIfNew = (d: PostMortemRuleDraft) => {
      const k = `${d.rule.field}|${d.rule.operator}|${d.rule.value}|${d.rule.action}`;
      if (!existingKeys.has(k)) {
        drafts.push(d);
        existingKeys.add(k);
      }
    };

    // Pattern 1: SPAC unit / warrant suffix — generate block rule
    for (const t of losses) {
      if (SPAC_SUFFIX_RE.test(t.ticker)) {
        const suffixMatch = t.ticker.match(/(U|W|WS|UN)$/);
        const suffix = suffixMatch ? suffixMatch[1] : 'U';
        addIfNew({
          ruleType: 'block_pattern',
          description: `Block tickers ending in "${suffix}" (SPAC unit / warrant suffix)`,
          rule: { field: 'ticker_suffix', operator: 'eq', value: suffix, action: 'block' },
          evidence: t.ticker,
          pnlImpact: Math.abs(t.pnl || 0),
        });
      }
    }

    // Pattern 2: Large single-trade loss (>$1000) — raise min_volume floor
    const bigLosses = losses.filter(t => (t.pnl || 0) < -1000);
    if (bigLosses.length > 0) {
      const total = bigLosses.reduce((s, t) => s + Math.abs(t.pnl || 0), 0);
      addIfNew({
        ruleType: 'add_filter',
        description: 'Reject tickers with daily_volume < 250,000 (catches illiquid blow-ups)',
        rule: { field: 'daily_volume', operator: 'lt', value: 250_000, action: 'block' },
        evidence: bigLosses.map(t => t.ticker).join(', '),
        pnlImpact: total,
      });
    }

    // Pattern 3: Percent-loss > 10% on a single position — tighten spread filter
    const hugePctLosses = losses.filter(t => {
      const entry = t.entryPrice ?? 0;
      const exit = t.exitPrice ?? 0;
      if (entry <= 0) return false;
      const pct = ((exit - entry) / entry) * 100;
      return pct < -10;
    });
    if (hugePctLosses.length > 0) {
      const total = hugePctLosses.reduce((s, t) => s + Math.abs(t.pnl || 0), 0);
      addIfNew({
        ruleType: 'adjust_gate',
        description: 'Reject tickers with spread > 15 bps (catches illiquid spreads that cause >10% slippage losses)',
        rule: { field: 'spread_bps', operator: 'gt', value: 15, action: 'block' },
        evidence: hugePctLosses.map(t => t.ticker).join(', '),
        pnlImpact: total,
      });
    }

    return drafts;
  }

  private buildPrompt(losses: ClosedTradeRow[], existingRules: RiskRuleRow[]): string {
    const lossesSection = losses.map(t => {
      const entry = t.entryPrice != null ? `$${t.entryPrice.toFixed(2)}` : '?';
      const exit = t.exitPrice != null ? `$${t.exitPrice.toFixed(2)}` : '?';
      const qty = t.qty != null ? t.qty.toString() : '?';
      return `- ${t.ticker}: lost $${Math.abs(t.pnl || 0).toFixed(2)}
    Entry: ${entry} → Exit: ${exit}, Qty: ${qty}
    Reason: ${t.reason || 'unknown'}, Closed: ${t.closedAt}`;
    }).join('\n');

    const existingSection = existingRules.length > 0
      ? existingRules.map(r => `- [${r.field} ${r.operator} ${r.value} → ${r.action}] ${r.description}`).join('\n')
      : '(none — this is the first post-mortem)';

    return `You are the Post-Mortem Analyst for a momentum day-trading system. Your job is to analyze today's losing trades and produce SPECIFIC, MACHINE-READABLE rules that would have prevented each loss.

RULES MUST BE CONCRETE — not "be more careful" but "block tickers with daily_volume < 150000" or "block tickers ending in U" — because a Risk Manager will enforce them programmatically.

TODAY'S LOSING TRADES:
${lossesSection}

EXISTING ACTIVE RULES (do not duplicate these):
${existingSection}

For EACH losing trade, decide if a new rule is justified. Only generate a rule if:
  1. The loss is significant (>$50 or >2% of portfolio)
  2. An existing rule doesn't already cover it
  3. The rule would block a CLASS of trades, not just this one ticker

For each rule you generate, produce a JSON object with this EXACT shape:
{
  "ruleType": "block_pattern" | "adjust_gate" | "adjust_sizing" | "add_filter",
  "description": "Human-readable one-liner",
  "rule": {
    "field": "ticker_suffix" | "daily_volume" | "spread_bps" | "percent_change" | "trade_count" | "ticker_length",
    "operator": "gt" | "lt" | "eq" | "contains" | "matches",
    "value": <number or string>,
    "action": "block" | "downsize_50" | "require_catalyst"
  },
  "evidence": "ticker(s) that prompted this rule",
  "pnlImpact": <dollars this rule would have saved today>
}

If a trade was just normal market noise (small loss, high-volume liquid stock, reasonable hold time), return:
{ "ruleType": "none", "description": "normal market noise", "rule": {...}, "evidence": "...", "pnlImpact": 0 }

RETURN ONLY A JSON ARRAY. NO COMMENTARY. NO MARKDOWN FENCES. NO EXPLANATIONS OUTSIDE THE JSON.`;
  }

  private parseRules(text: string): PostMortemRuleDraft[] {
    // Strip markdown fences if the model added them despite instructions
    const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
    // Extract the first JSON array in the text (defensive)
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start < 0 || end <= start) {
      console.error('[POST-MORTEM] No JSON array found in response');
      return [];
    }
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(parsed)) return [];
      return parsed as PostMortemRuleDraft[];
    } catch (e: any) {
      console.error(`[POST-MORTEM] JSON parse failed: ${e.message}`);
      return [];
    }
  }
}
