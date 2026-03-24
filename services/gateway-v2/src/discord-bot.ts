/**
 * Discord Bot — Talk to the Trading Team
 *
 * Lets users converse with Warren (MD), Fin (Trading), Liza (News), Ferd (Research)
 * via Discord. Each agent reads live state from the shared SQLite store and responds
 * in their own voice.
 *
 * Usage:
 *   import { start } from './discord-bot.js';
 *   start('/path/to/gateway-state.db');
 */

import { Client, GatewayIntentBits, EmbedBuilder, Message, TextChannel } from 'discord.js';
import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { loadCredentials, getAlpacaHeaders } from './config-bus.js';

// ─── Agent Definitions ──────────────────────────────────────────────────────

type AgentName = 'warren' | 'fin' | 'liza' | 'ferd';

interface AgentMeta {
  label: string;
  title: string;
  color: number;
  triggers: RegExp;
}

const AGENTS: Record<AgentName, AgentMeta> = {
  warren: { label: 'Warren', title: 'Managing Director', color: 0xFFD700, triggers: /\b(warren|boss)\b/i },
  fin:    { label: 'Fin',    title: 'Trading Manager',    color: 0x2ECC71, triggers: /\b(fin|trading)\b/i },
  liza:   { label: 'Liza',   title: 'News Desk',          color: 0x3498DB, triggers: /\b(liza|news)\b/i },
  ferd:   { label: 'Ferd',   title: 'Research Manager',   color: 0x9B59B6, triggers: /\b(ferd|research)\b/i },
};

const COMMANDS: Record<string, AgentName> = {
  '!status':    'warren',
  '!pnl':       'warren',
  '!positions': 'fin',
  '!news':      'liza',
  '!research':  'ferd',
};

// ─── Agent Response Builders ────────────────────────────────────────────────

function buildWarrenResponse(store: GatewayStateStore, question: string): string {
  const briefingRaw = store.get('warren:briefing');
  const urgency = store.get('warren:urgency') || 'unknown';

  if (!briefingRaw) {
    return 'Systems are still warming up. Give me a minute to get the full picture.';
  }

  let b: any;
  try { b = JSON.parse(briefingRaw); } catch { return 'Briefing data is corrupted. Investigating.'; }

  const healthSummary = (b.managerHealth || [])
    .map((m: any) => `${m.name}: ${m.healthy ? 'online' : 'DOWN'}`)
    .join(', ');

  const goalPct = b.dailyGoalPct ?? 0;
  const pnl = b.dailyPnl ?? 0;
  const positions = b.positions ?? 0;

  const lines: string[] = [];
  lines.push(`We're at **$${pnl.toFixed(0)}** today, **${goalPct}%** of the $500 goal.`);
  lines.push(`${positions} positions running. Urgency: **${urgency}**.`);
  lines.push(`Team: ${healthSummary}.`);

  if (b.learnings && b.learnings.length > 0) {
    lines.push('');
    lines.push('**Recent:**');
    b.learnings.slice(0, 3).forEach((l: string) => lines.push(`- ${l}`));
  }

  if (question.toLowerCase().includes('brief') || question === '!status') {
    lines.push('');
    lines.push(`*${b.narrative || 'No narrative available.'}*`);
  }

  return lines.join('\n');
}

async function buildFinResponse(store: GatewayStateStore, question: string): Promise<string> {
  const lines: string[] = [];

  // Live positions from Alpaca
  const headers = getAlpacaHeaders();
  let positions: any[] = [];
  if (headers) {
    try {
      const creds = loadCredentials();
      const base = creds.alpaca?.baseUrl || 'https://paper-api.alpaca.markets';
      const res = await fetch(`${base}/v2/positions`, { headers, signal: AbortSignal.timeout(5000) });
      if (res.ok) positions = await res.json() as any[];
    } catch { /* use empty */ }
  }

  if (positions.length === 0) {
    lines.push('No open positions right now. Flat book.');
  } else {
    lines.push(`Got **${positions.length}** positions running.`);
    const sorted = positions.sort((a, b) => parseFloat(b.unrealized_pl) - parseFloat(a.unrealized_pl));
    const top = sorted.slice(0, 8);
    for (const p of top) {
      const pnl = parseFloat(p.unrealized_pl || '0');
      const sym = p.symbol;
      const side = parseFloat(p.qty) > 0 ? 'LONG' : 'SHORT';
      const arrow = pnl >= 0 ? '+' : '';
      lines.push(`  **${sym}** ${side} | ${arrow}$${pnl.toFixed(2)}`);
    }
    if (sorted.length > 8) lines.push(`  ...and ${sorted.length - 8} more.`);
  }

  // Today's closed trades
  const todayTrades = store.getTodayTrades();
  const realizedPnl = todayTrades.reduce((s, t) => s + t.pnl, 0);
  if (todayTrades.length > 0) {
    lines.push('');
    lines.push(`**Closed today:** ${todayTrades.length} trades, realized **$${realizedPnl.toFixed(2)}**.`);
    const winners = todayTrades.filter(t => t.pnl > 0);
    const losers = todayTrades.filter(t => t.pnl <= 0);
    lines.push(`  W/L: ${winners.length}/${losers.length}`);
    const best = todayTrades.sort((a, b) => b.pnl - a.pnl)[0];
    if (best && best.pnl > 0) lines.push(`  Star: **${best.ticker}** +$${best.pnl.toFixed(2)}`);
  }

  // Goal progress
  const finStatusRaw = store.get('manager_fin_status');
  if (finStatusRaw) {
    try {
      const fs = JSON.parse(finStatusRaw);
      lines.push('');
      lines.push(`Goal progress: **${(fs.goalProgress || 0).toFixed(0)}%** of $500.`);
    } catch { /* skip */ }
  }

  // Alerts for outsized winners
  for (const p of positions) {
    const pnl = parseFloat(p.unrealized_pl || '0');
    if (pnl > 100) {
      lines.push(`\n**Alert:** ${p.symbol} is running hot at +$${pnl.toFixed(0)}. Trailing stop is tight.`);
    }
  }

  return lines.join('\n') || 'Book is quiet. Waiting for setups.';
}

function buildLizaResponse(store: GatewayStateStore, question: string): string {
  const lines: string[] = [];

  // Sentiment
  const sentRaw = store.get('market_sentiment');
  if (sentRaw) {
    try {
      const s = JSON.parse(sentRaw);
      const emoji = s.label === 'bullish' ? 'Bullish' : s.label === 'bearish' ? 'Bearish' : 'Neutral';
      lines.push(`**Sentiment:** ${emoji} (${s.score?.toFixed(2) || '?'}) from ${s.headlineCount || 0} headlines.`);
    } catch { /* skip */ }
  }

  // Active catalysts
  const catRaw = store.get('active_catalysts');
  if (catRaw) {
    try {
      const c = JSON.parse(catRaw);
      if (c.catalysts && c.catalysts.length > 0) {
        lines.push(`**Active catalysts:** ${c.catalysts.join(', ')}.`);
      } else {
        lines.push('No strong catalyst themes right now.');
      }
    } catch { /* skip */ }
  }

  // Critical events
  const critRaw = store.get('critical_events');
  if (critRaw) {
    try {
      const ce = JSON.parse(critRaw);
      if (ce.events && ce.events.length > 0) {
        lines.push('');
        lines.push('**Critical headlines:**');
        ce.events.slice(0, 5).forEach((e: string) => lines.push(`- ${e}`));
      }
    } catch { /* skip */ }
  }

  // Economic calendar alerts
  const econRaw = store.get('econ_calendar_alerts');
  if (econRaw) {
    try {
      const ea = JSON.parse(econRaw);
      if (ea.alerts && ea.alerts.length > 0) {
        lines.push('');
        lines.push(`**Calendar:** ${ea.alerts.join(' | ')}`);
      }
    } catch { /* skip */ }
  }

  // Latest news reports
  const reports = store.getReports('liza', 3);
  if (reports.length > 0) {
    const latest = reports[0];
    if (latest.summary) {
      lines.push('');
      lines.push(`**Latest scan:** ${latest.summary}`);
    }
  } else {
    // Try news-desk agent reports
    const ndReports = store.getReports('news-desk', 3);
    if (ndReports.length > 0) {
      lines.push('');
      lines.push(`**News desk:** ${ndReports[0].summary}`);
    }
  }

  return lines.join('\n') || 'Wire is quiet. No major headlines to report.';
}

function buildFerdResponse(store: GatewayStateStore, question: string): string {
  const lines: string[] = [];

  // Research recommendations
  const recsRaw = store.get('research_recommendations');
  if (recsRaw) {
    try {
      const r = JSON.parse(recsRaw);
      if (r.sectors && r.sectors.length > 0) {
        lines.push('**Sector recommendations:**');
        r.sectors.forEach((s: string) => lines.push(`- ${s}`));
      }
    } catch { /* skip */ }
  }

  // Research stars
  const stars = store.getResearchStars();
  if (stars.length > 0) {
    lines.push('');
    lines.push(`**Top research stars** (${stars.length} total):`);
    stars.slice(0, 6).forEach(s => {
      lines.push(`  **${s.symbol}** [${s.sector}] score ${s.score.toFixed(1)} — ${s.catalyst}`);
    });
  }

  // Sector performance from Ferd status
  const statusRaw = store.get('manager_ferd_status');
  if (statusRaw) {
    try {
      const fs = JSON.parse(statusRaw);
      const perf = (fs.sectorPerformance || []) as any[];
      const promoted = perf.filter((s: any) => s.status === 'promoted');
      const demoted = perf.filter((s: any) => s.status === 'demoted');

      if (promoted.length > 0) {
        lines.push('');
        lines.push('**Performing sectors:**');
        promoted.forEach((s: any) => {
          lines.push(`  ${s.sector}: ${(s.winRate * 100).toFixed(0)}% win on ${s.trades} trades, $${s.totalPnl.toFixed(0)} P&L`);
        });
      }
      if (demoted.length > 0) {
        lines.push('');
        lines.push('**Underperforming:**');
        demoted.forEach((s: any) => {
          lines.push(`  ${s.sector}: ${(s.winRate * 100).toFixed(0)}% win, $${s.totalPnl.toFixed(0)} P&L — AVOID`);
        });
      }

      // Catalyst alignment
      if (fs.catalystAlignment && fs.catalystAlignment.length > 0) {
        lines.push('');
        lines.push(`**Catalyst-aligned:** ${fs.catalystAlignment.join(', ')}`);
      }
    } catch { /* skip */ }
  }

  // FACT cache stats
  const factRaw = store.get('fact_cache');
  if (factRaw) {
    try {
      const cache = JSON.parse(factRaw) as any[];
      const proven = cache.filter((e: any) => e.winRate >= 0.6);
      lines.push('');
      lines.push(`**FACT cache:** ${cache.length} strategies, ${proven.length} proven (60%+ win rate).`);
    } catch { /* skip */ }
  }

  return lines.join('\n') || 'Still gathering data. Need more closed trades to form sector opinions.';
}

// ─── Agent Router ───────────────────────────────────────────────────────────

function detectAgent(content: string): AgentName {
  // Check explicit commands first
  const firstWord = content.trim().split(/\s/)[0].toLowerCase();
  if (COMMANDS[firstWord]) return COMMANDS[firstWord];

  // Check agent triggers
  if (AGENTS.fin.triggers.test(content)) return 'fin';
  if (AGENTS.liza.triggers.test(content)) return 'liza';
  if (AGENTS.ferd.triggers.test(content)) return 'ferd';
  if (AGENTS.warren.triggers.test(content)) return 'warren';

  // "team" or fallback to Warren
  return 'warren';
}

// ─── LLM Conversational Layer ────────────────────────────────────────────

const AGENT_PERSONAS: Record<AgentName, string> = {
  warren: `You are Warren, the Managing Director of a family office trading desk called Deep Canyon. You're sharp, direct, and take ownership. When things go wrong you don't make excuses. You speak like a seasoned Wall Street MD — confident, sometimes blunt, occasionally witty. You have strong opinions about risk management and hate losing money. Keep responses under 200 words.`,
  fin: `You are Fin, the Trading Manager at Deep Canyon. You execute trades and monitor positions. You're precise, numbers-focused, and slightly intense about P&L. You speak in trader shorthand when appropriate. Keep responses under 200 words.`,
  liza: `You are Liza, the News Desk analyst at Deep Canyon. You scan headlines and identify catalysts. You're quick, informed, and connect dots between macro events and trading opportunities. Keep responses under 200 words.`,
  ferd: `You are Ferd, the Research Manager at Deep Canyon. You do deep sector analysis and find research stars. You're thoughtful, data-driven, and sometimes contrarian. Keep responses under 200 words.`,
};

async function llmConverse(agent: AgentName, context: string, question: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `${AGENT_PERSONAS[agent]}\n\nHere is the current state of the trading desk:\n${context}`,
        messages: [{ role: 'user', content: question }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.content?.[0]?.text || null;
  } catch {
    return null;
  }
}

async function getAgentResponse(agent: AgentName, store: GatewayStateStore, question: string): Promise<string> {
  // Build context from live state
  const dataResponse = agent === 'warren' ? buildWarrenResponse(store, question)
    : agent === 'fin' ? await buildFinResponse(store, question)
    : agent === 'liza' ? buildLizaResponse(store, question)
    : buildFerdResponse(store, question);

  // For commands (!status, !positions etc), return data directly
  if (question.startsWith('!')) return dataResponse;

  // For conversation, use LLM with live data as context
  const llmResponse = await llmConverse(agent, dataResponse, question);
  return llmResponse || dataResponse;
}

// ─── Discord Client ─────────────────────────────────────────────────────────

export function start(dbPath?: string): Client {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error('[DiscordBot] DISCORD_BOT_TOKEN not set. Bot will not start.');
    throw new Error('DISCORD_BOT_TOKEN is required');
  }

  const resolvedDb = dbPath || process.env.GATEWAY_DB_PATH || '';
  const store = new GatewayStateStore(resolvedDb || undefined);
  console.log(`[DiscordBot] State store opened: ${resolvedDb || 'default path'}`);

  const allowedChannels = process.env.DISCORD_CHANNEL_IDS
    ? new Set(process.env.DISCORD_CHANNEL_IDS.split(',').map(id => id.trim()))
    : null; // null = all channels

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once('ready', () => {
    const guilds = client.guilds.cache.map(g => `${g.name} (${g.id})`).join(', ');
    console.log(`[DiscordBot] Connected as ${client.user?.tag}. Guilds: ${guilds || 'NONE'}. Listening on ${allowedChannels ? allowedChannels.size + ' channels' : 'all channels'}.`);
  });

  client.on('messageCreate', async (message: Message) => {
    console.log(`[DiscordBot] MSG from ${message.author.tag} in #${(message.channel as TextChannel).name || message.channel.id}: "${message.content.substring(0, 50)}"`);
    // Ignore bots and empty messages
    if (message.author.bot || !message.content.trim()) return;

    // Channel filter
    if (allowedChannels && !allowedChannels.has(message.channel.id)) return;

    const content = message.content.trim();

    // Only respond to commands, mentions, or messages that reference an agent
    const isCommand = content.startsWith('!');
    const isMention = message.mentions.has(client.user!);
    const hasAgentName = /\b(warren|boss|fin|trading|liza|news|ferd|research|team)\b/i.test(content);

    if (!isCommand && !isMention && !hasAgentName) return;

    const agent = detectAgent(content);
    const meta = AGENTS[agent];

    try {
      const response = await getAgentResponse(agent, store, content);

      const embed = new EmbedBuilder()
        .setColor(meta.color)
        .setAuthor({ name: `${meta.label} | ${meta.title}` })
        .setDescription(response.slice(0, 4096)) // Discord embed limit
        .setFooter({ text: `${meta.label} | ${new Date().toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit' })}` })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      console.log(`[DiscordBot] ${meta.label} responded to ${message.author.tag} in #${(message.channel as TextChannel).name || message.channel.id}`);
    } catch (err: any) {
      console.error(`[DiscordBot] Error building ${agent} response:`, err.message);
      await message.reply(`${meta.label} is having trouble right now. Try again in a moment.`).catch(() => {});
    }
  });

  client.on('error', (err) => {
    console.error('[DiscordBot] Client error:', err.message);
  });

  client.login(token).catch((err) => {
    console.error(`[DiscordBot] Login failed: ${err.message}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('[DiscordBot] Shutting down...');
    client.destroy();
    store.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return client;
}
