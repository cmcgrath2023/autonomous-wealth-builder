import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    const sanitized = query
      .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[REDACTED]')
      .replace(/\b\d{9}\b/g, '[REDACTED]');

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return NextResponse.json({
        response: 'Claude API not configured. Add ANTHROPIC_API_KEY to .env.local.',
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    }

    // Fetch real system state for context
    const [accountRes, positionsRes, phaseRes, signalsRes] = await Promise.all([
      fetch(`${GATEWAY}/api/broker/account`).catch(() => null),
      fetch(`${GATEWAY}/api/broker/positions`).catch(() => null),
      fetch(`${GATEWAY}/api/phase`).catch(() => null),
      fetch(`${GATEWAY}/api/signals`).catch(() => null),
    ]);

    const account = accountRes ? await accountRes.json() : { portfolioValue: 0, cash: 0, connected: false };
    const posData = positionsRes ? await positionsRes.json() : { positions: [] };
    const phase = phaseRes ? await phaseRes.json() : { phase: 'unknown' };
    const signals = signalsRes ? await signalsRes.json() : { active: [] };

    const positions = posData.positions || [];
    const positionSummary = positions.length > 0
      ? positions.map((p: any) => `${p.ticker}: ${p.shares} shares @ $${p.currentPrice} (P&L: $${Math.round(p.unrealizedPnl)})`).join('; ')
      : 'No open positions';

    const systemPrompt = `You are the MTWM (McGrath Trust World Model) manager brain. You provide concise, actionable answers about the portfolio and investment strategy.

Current state:
- Broker: ${account.connected ? 'Alpaca Paper Trading connected' : 'Not connected'}
- Portfolio value: $${Math.round(account.portfolioValue || 0).toLocaleString()}
- Cash: $${Math.round(account.cash || 0).toLocaleString()}
- Phase: ${phase.phase}
- Positions: ${positionSummary}
- Active signals: ${signals.active?.length || 0}

Strategy framework: Robert Allen's Multiple Streams of Income — three Money Mountains (Investment, Real Estate, Marketing). Currently in Phase 1 (paper trading validation). Goal: generate seed capital through trading, then acquire first rental property using Nothing Down creative financing.`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: sanitized }],
      }),
    });

    if (!claudeResponse.ok) {
      return NextResponse.json({ response: 'Error communicating with Claude API.', usage: { inputTokens: 0, outputTokens: 0 } });
    }

    const data = await claudeResponse.json();
    return NextResponse.json({
      response: data.content[0].text,
      usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to process query' }, { status: 500 });
  }
}
