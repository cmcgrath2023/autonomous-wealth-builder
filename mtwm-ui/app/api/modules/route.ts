import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const [statusRes, signalsRes, phaseRes, positionsRes] = await Promise.all([
      fetch(`${GATEWAY}/api/status`),
      fetch(`${GATEWAY}/api/signals`),
      fetch(`${GATEWAY}/api/phase`),
      fetch(`${GATEWAY}/api/broker/positions`),
    ]);

    const status = await statusRes.json();
    const signals = await signalsRes.json();
    const phase = await phaseRes.json();
    const { positions } = await positionsRes.json();

    const positionCount = positions?.length || 0;
    const tradingValue = (positions || []).reduce((s: number, p: any) => s + (p.marketValue || 0), 0);
    const tradingPnl = (positions || []).reduce((s: number, p: any) => s + (p.unrealizedPnl || 0), 0);

    return NextResponse.json({
      modules: [
        {
          id: 'trading',
          name: 'Algorithmic Trading',
          status: positionCount > 0 ? 'active' : 'ready',
          allocation: Math.round(tradingValue),
          allocationPercent: 0,
          dayPnl: Math.round(tradingPnl),
          dayPnlPercent: tradingValue > 0 ? (tradingPnl / tradingValue) * 100 : 0,
          activeAgents: status.services?.neuralTrader?.activeSignals || 0,
          lastAction: signals.active?.length > 0
            ? `${signals.active[0].direction.toUpperCase()} signal: ${signals.active[0].ticker}`
            : 'Scanning for signals',
          lastActionTime: new Date().toISOString(),
          metrics: {
            signals: signals.active?.length || 0,
            positions: positionCount,
            phase: phase.phase,
          },
        },
        {
          id: 'realestate',
          name: 'Real Estate',
          status: 'pending',
          allocation: 0,
          allocationPercent: 0,
          dayPnl: 0,
          dayPnlPercent: 0,
          activeAgents: 0,
          lastAction: 'Awaiting first property acquisition',
          lastActionTime: new Date().toISOString(),
          metrics: { properties: 0, avgCapRate: 0, occupancy: 0 },
        },
        {
          id: 'business',
          name: 'Business Operations',
          status: 'pending',
          allocation: 0,
          allocationPercent: 0,
          dayPnl: 0,
          dayPnlPercent: 0,
          activeAgents: 0,
          lastAction: 'Module not yet activated',
          lastActionTime: new Date().toISOString(),
          metrics: { revenue: 0, margin: 0, clients: 0 },
        },
        {
          id: 'alternatives',
          name: 'Alternative Investments',
          status: 'pending',
          allocation: 0,
          allocationPercent: 0,
          dayPnl: 0,
          dayPnlPercent: 0,
          activeAgents: 0,
          lastAction: 'Module not yet activated',
          lastActionTime: new Date().toISOString(),
          metrics: { positions: 0, taxLiens: 0 },
        },
      ],
    });
  } catch {
    return NextResponse.json({ modules: [] });
  }
}
