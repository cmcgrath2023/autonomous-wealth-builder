import { AgentDB } from 'agentdb';
import { eventBus } from '../utils/event-bus.js';

/**
 * AgentMemory — shared memory layer for all MTWM agents
 *
 * Architecture:
 *   AgentDB (.rvf) is the system-wide vector store and learning engine.
 *   Each agent writes its experiences here. Each agent reads patterns here.
 *   The SkillLibrary auto-promotes winning patterns into reusable skills.
 *   ReasoningBank stores proven strategies searchable by similarity.
 *   ReflexionMemory stores episodes (trades) with critiques for self-improvement.
 *   LearningSystem runs Decision Transformer for optimal action sequences.
 *
 * RuVector provides the HNSW index for sub-millisecond similarity search.
 * SONA micro-LoRA adapts search quality per agent's interaction patterns.
 *
 * Cross-agent learning flow:
 *   1. Agent executes action (trade, scan, rebalance)
 *   2. Outcome recorded as episode in ReflexionMemory
 *   3. Successful patterns stored in ReasoningBank
 *   4. SkillLibrary consolidates high-reward episodes into reusable skills
 *   5. Next time ANY agent faces similar situation, it queries:
 *      - ReasoningBank for proven approaches
 *      - ReflexionMemory for past episodes (successes + failures)
 *      - SkillLibrary for reusable skills
 *   6. LearningSystem trains Decision Transformer on accumulated experiences
 */

export interface TradeEpisode {
  agentId: string;
  ticker: string;
  direction: string;
  confidence: number;
  entryPrice: number;
  exitPrice?: number;
  returnPct?: number;
  success?: boolean;
  indicators: Record<string, number>;
  marketCondition: string; // 'bull' | 'bear' | 'sideways'
  critique?: string;
}

export interface TradingPattern {
  taskType: string;      // e.g., 'oversold_bounce', 'momentum_entry', 'short_exhaustion'
  approach: string;      // human-readable description
  successRate: number;
  ticker?: string;
  direction?: string;
  indicators?: Record<string, number>;
  tags: string[];
}

let agentDBInstance: AgentDB | null = null;
let reflexion: any = null;
let reasoning: any = null;
let skills: any = null;
let learning: any = null;
let initialized = false;

export async function initAgentMemory(dbPath?: string): Promise<void> {
  if (initialized) return;

  try {
    const path = dbPath || './data/mtwm-agent-memory.rvf';
    agentDBInstance = new AgentDB({
      dbPath: path,
      dimension: 384,     // Match EmbeddingService default
      maxElements: 100000,
      enableAttention: true,
    });

    await agentDBInstance.initialize();

    reflexion = agentDBInstance.getController('reflexion');
    reasoning = agentDBInstance.getController('reasoning');
    skills = agentDBInstance.getController('skills');
    learning = agentDBInstance.getController('learning');

    initialized = true;
    console.log(`[AgentDB] Initialized at ${path} — ReasoningBank, ReflexionMemory, SkillLibrary, LearningSystem active`);

    // Wire event listeners for automatic learning
    setupAutoLearning();
  } catch (error: any) {
    console.error('[AgentDB] Init error (non-fatal, falling back to BayesianIntelligence):', error.message);
  }
}

function setupAutoLearning() {
  // === TRADE CLOSED → store episode + update patterns ===
  eventBus.on('trade:closed' as any, async (payload: any) => {
    if (!initialized) return;

    const { ticker, success, returnPct, pnl, reason } = payload;

    try {
      // 1. Store as reflexion episode
      if (reflexion) {
        await reflexion.storeEpisode({
          sessionId: `trading-${new Date().toISOString().slice(0, 10)}`,
          task: `trade_${ticker}_${payload.direction || 'unknown'}`,
          input: JSON.stringify({
            ticker,
            direction: payload.direction,
            confidence: payload.confidence,
            indicators: payload.indicators,
          }),
          output: JSON.stringify({
            exitPrice: payload.exitPrice,
            returnPct,
            pnl,
            reason,
          }),
          critique: success
            ? `Winning trade on ${ticker}: +${(returnPct * 100).toFixed(1)}% via ${reason}. Pattern worth repeating.`
            : `Losing trade on ${ticker}: ${(returnPct * 100).toFixed(1)}% loss via ${reason}. Avoid similar setups or tighten stops.`,
          reward: success ? Math.max(returnPct * 10, 0.1) : Math.min(returnPct * 10, -0.1),
          success,
          tags: [ticker, success ? 'win' : 'loss', reason],
          metadata: { ticker, direction: payload.direction, returnPct, pnl, reason },
        });
      }

      // 2. If successful, store as reasoning pattern
      if (success && reasoning && returnPct > 0.01) {
        await reasoning.storePattern({
          taskType: `profitable_${payload.direction || 'trade'}`,
          approach: `${ticker} ${payload.direction} — ${reason}. Return: +${(returnPct * 100).toFixed(1)}%`,
          successRate: 1.0,
          tags: [ticker, payload.direction || 'buy', 'profitable'],
          metadata: {
            ticker,
            direction: payload.direction,
            returnPct,
            indicators: payload.indicators,
          },
        });
      }

      // 3. Record experience for Decision Transformer
      if (learning) {
        await learning.recordExperience({
          sessionId: `mtwm-trading`,
          toolName: 'trade_executor',
          action: `${payload.direction}_${ticker}`,
          stateBefore: { ticker, indicators: payload.indicators },
          stateAfter: { returnPct, pnl, reason },
          outcome: success ? 'profit' : 'loss',
          reward: learning.calculateReward({
            success,
            targetAchieved: returnPct > 0.02,
            efficiencyScore: Math.min(Math.abs(returnPct) / 0.05, 1),
            qualityScore: success ? 0.8 : 0.2,
            rewardFunction: 'shaped',
          }),
          success,
          metadata: { ticker, direction: payload.direction, returnPct },
        });
      }
    } catch (e: any) {
      // Non-fatal — learning is additive
      console.warn('[AgentDB] Episode storage error:', e.message);
    }
  });

  // === SIGNAL GENERATED → record for pattern matching ===
  eventBus.on('signal:new', async (payload) => {
    if (!initialized || !learning) return;

    try {
      await learning.recordExperience({
        sessionId: 'mtwm-signals',
        toolName: 'neural_trader',
        action: `signal_${payload.direction}_${payload.ticker}`,
        stateBefore: { ticker: payload.ticker },
        stateAfter: { direction: payload.direction, confidence: payload.confidence },
        outcome: 'signal_generated',
        reward: 0, // Unknown until trade closes
        success: true,
        metadata: payload,
      });
    } catch {
      // Non-fatal
    }
  });

  // === PERIODIC SKILL CONSOLIDATION ===
  // Every 30 minutes, promote winning patterns to reusable skills
  setInterval(async () => {
    if (!skills) return;
    try {
      const result = await skills.consolidateEpisodesIntoSkills({
        minAttempts: 3,
        minReward: 0.5,
        timeWindowDays: 7,
        extractPatterns: true,
      });
      if (result.created > 0 || result.updated > 0) {
        console.log(`[AgentDB] Skill consolidation: ${result.created} created, ${result.updated} updated`);
        eventBus.emit('intelligence:updated' as any, {
          beliefId: 'skill_consolidation',
          posterior: 0,
          agentSource: 'agentdb',
          insight: `${result.created} new skills from ${result.patterns.length} patterns`,
        });
      }
    } catch {
      // Non-fatal
    }
  }, 30 * 60 * 1000);
}

// === PUBLIC API — agents call these ===

/** Query ReasoningBank for proven strategies before making a decision */
export async function queryPatterns(
  task: string,
  options?: { k?: number; minSuccessRate?: number; tags?: string[] },
): Promise<TradingPattern[]> {
  if (!reasoning) return [];

  try {
    const results = await reasoning.searchPatterns({
      task,
      k: options?.k || 5,
      threshold: 0.3,
      filters: {
        minSuccessRate: options?.minSuccessRate || 0.6,
        tags: options?.tags,
      },
    });

    return results.map((r: any) => ({
      taskType: r.taskType,
      approach: r.approach,
      successRate: r.successRate,
      ticker: r.metadata?.ticker,
      direction: r.metadata?.direction,
      indicators: r.metadata?.indicators,
      tags: r.tags || [],
    }));
  } catch {
    return [];
  }
}

/** Query ReflexionMemory for past episodes on a specific scenario */
export async function queryEpisodes(
  task: string,
  options?: { k?: number; onlySuccesses?: boolean; onlyFailures?: boolean },
): Promise<any[]> {
  if (!reflexion) return [];

  try {
    return await reflexion.retrieveRelevant({
      task,
      k: options?.k || 10,
      onlySuccesses: options?.onlySuccesses,
      onlyFailures: options?.onlyFailures,
    });
  } catch {
    return [];
  }
}

/** Query SkillLibrary for reusable skills */
export async function querySkills(
  task: string,
  options?: { k?: number; minSuccessRate?: number },
): Promise<any[]> {
  if (!skills) return [];

  try {
    return await skills.searchSkills({
      task,
      k: options?.k || 5,
      minSuccessRate: options?.minSuccessRate || 0.5,
    });
  } catch {
    return [];
  }
}

/** Get system-wide learning metrics */
export function getMemoryStats(): {
  initialized: boolean;
  reasoning: any;
  skills: any;
  reflexion: any;
} {
  return {
    initialized,
    reasoning: reasoning ? reasoning.getPatternStats?.() : null,
    skills: skills ? null : null, // Skills doesn't have a stats method
    reflexion: reflexion ? reflexion.getTaskStats?.('trade', 30) : null,
  };
}

/** Get the AgentDB instance for advanced operations */
export function getAgentDB(): AgentDB | null {
  return agentDBInstance;
}

/** Shut down cleanly */
export async function closeAgentMemory(): Promise<void> {
  if (agentDBInstance) {
    await agentDBInstance.close();
    initialized = false;
    console.log('[AgentDB] Memory closed');
  }
}
