import { NextResponse } from 'next/server';

const GATEWAY = process.env.NEXT_PUBLIC_RUFLOW_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const [accountRes, positionsRes, signalsRes, phaseRes, riskRes, decisionsRes] = await Promise.all([
      fetch(`${GATEWAY}/api/broker/account`),
      fetch(`${GATEWAY}/api/broker/positions`),
      fetch(`${GATEWAY}/api/signals`),
      fetch(`${GATEWAY}/api/phase`),
      fetch(`${GATEWAY}/api/risk`),
      fetch(`${GATEWAY}/api/decisions`),
    ]);

    const account = await accountRes.json();
    const { positions } = await positionsRes.json();
    const signals = await signalsRes.json();
    const phase = await phaseRes.json();
    const risk = await riskRes.json();
    const { decisions } = await decisionsRes.json();

    const posCount = positions?.length || 0;
    const totalPnl = (positions || []).reduce((s: number, p: any) => s + (p.unrealizedPnl || 0), 0);
    const activeSignals = signals.active?.length || 0;
    const pendingDecisions = decisions?.length || 0;

    const sections = [];

    // Account overview
    sections.push({
      title: 'Account Overview',
      content: account.connected
        ? `Portfolio value: $${Math.round(account.portfolioValue).toLocaleString()}. Cash: $${Math.round(account.cash).toLocaleString()}. Buying power: $${Math.round(account.buyingPower).toLocaleString()}. ${posCount} open position${posCount !== 1 ? 's' : ''}.`
        : 'Broker not connected. Configure Alpaca credentials to begin paper trading.',
      priority: account.connected ? 'info' : 'action',
    });

    // Trading activity
    if (posCount > 0) {
      const pnlDir = totalPnl >= 0 ? 'up' : 'down';
      sections.push({
        title: 'Trading Activity',
        content: `${posCount} position${posCount !== 1 ? 's' : ''} ${pnlDir} $${Math.abs(Math.round(totalPnl)).toLocaleString()} total unrealized P&L. ${activeSignals} active signal${activeSignals !== 1 ? 's' : ''} from Neural Trader. Phase: ${phase.phase}.`,
        priority: 'info',
      });
    } else {
      sections.push({
        title: 'Trading Activity',
        content: `No open positions. ${activeSignals} signal${activeSignals !== 1 ? 's' : ''} detected. Phase: ${phase.phase}. Thresholds — autonomous: $${phase.thresholds?.autonomous || 0}, notify: $${phase.thresholds?.notify || 0}.`,
        priority: 'info',
      });
    }

    // Pending decisions
    if (pendingDecisions > 0) {
      sections.push({
        title: 'Action Required',
        content: `${pendingDecisions} decision${pendingDecisions !== 1 ? 's' : ''} awaiting approval in the decision queue.`,
        priority: 'action',
      });
    }

    // Risk monitor
    const alerts = risk.alerts || [];
    sections.push({
      title: 'Risk Monitor',
      content: alerts.length > 0
        ? alerts.join(' ')
        : `Drawdown: ${((risk.portfolioDrawdown || 0) * 100).toFixed(1)}% (limit ${((risk.maxDrawdown || 0) * 100).toFixed(0)}%). Kelly fraction: ${risk.kellyFraction || 0}. No risk alerts.`,
      priority: alerts.length > 0 ? 'warning' : 'info',
    });

    // Real estate pipeline
    sections.push({
      title: 'Real Estate Pipeline',
      content: 'No properties in pipeline. Trading profits will fund first acquisition using Nothing Down creative financing strategies.',
      priority: 'info',
    });

    return NextResponse.json({
      generatedAt: new Date().toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }),
      sections,
    });
  } catch {
    return NextResponse.json({
      generatedAt: new Date().toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }),
      sections: [{ title: 'System Status', content: 'Unable to reach gateway. Ensure services are running on port 3001.', priority: 'warning' }],
    });
  }
}
