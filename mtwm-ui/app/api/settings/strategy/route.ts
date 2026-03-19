import { NextRequest, NextResponse } from 'next/server';
import { getTenantDB, getTenantFromRequest } from '@/src/lib/tenant';

export async function GET(request: NextRequest) {
  const tenant = getTenantFromRequest(request);
  if (!tenant) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getTenantDB();
    const config = db.getTenantConfig(tenant.tenantId);

    if (!config) {
      // Return defaults
      return NextResponse.json({
        capital: 10000,
        dailyGoal: 100,
        riskLevel: 'moderate',
        cryptoPct: 30,
      });
    }

    // Map DB row to the shape the settings UI expects
    const riskLevel = config.stop_loss_pct <= 0.01
      ? 'conservative'
      : config.stop_loss_pct >= 0.04
        ? 'aggressive'
        : 'moderate';

    return NextResponse.json({
      capital: config.simulated_capital,
      dailyGoal: config.daily_goal,
      riskLevel,
      cryptoPct: Math.round(config.crypto_pct * 100),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load strategy';
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const tenant = getTenantFromRequest(request);
  if (!tenant) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { capital, dailyGoal, riskLevel, cryptoPct } = await request.json();

    const RISK_PRESETS: Record<string, { stopLossPct: number; takeProfitPct: number; maxPositions: number }> = {
      conservative: { stopLossPct: 0.01, takeProfitPct: 0.03, maxPositions: 3 },
      moderate:     { stopLossPct: 0.02, takeProfitPct: 0.05, maxPositions: 5 },
      aggressive:   { stopLossPct: 0.04, takeProfitPct: 0.10, maxPositions: 8 },
    };

    const risk = riskLevel && RISK_PRESETS[riskLevel] ? riskLevel : 'moderate';
    const preset = RISK_PRESETS[risk];
    const cryptoFraction = typeof cryptoPct === 'number' ? cryptoPct / 100 : undefined;

    const db = getTenantDB();
    db.saveTenantConfig({
      tenantId: tenant.tenantId,
      ...(capital != null && { simulatedCapital: capital }),
      ...(dailyGoal != null && { dailyGoal }),
      ...(cryptoFraction != null && {
        cryptoPct: cryptoFraction,
        equityPct: 1 - cryptoFraction,
      }),
      stopLossPct: preset.stopLossPct,
      takeProfitPct: preset.takeProfitPct,
      maxPositions: preset.maxPositions,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update strategy';
    return NextResponse.json({ message }, { status: 500 });
  }
}
