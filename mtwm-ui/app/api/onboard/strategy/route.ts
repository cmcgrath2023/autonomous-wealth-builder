import { NextRequest, NextResponse } from 'next/server';
import { getTenantDB, getTenantFromRequest } from '@/src/lib/tenant';

type RiskLevel = 'conservative' | 'moderate' | 'aggressive';

const RISK_PRESETS: Record<RiskLevel, { stopLossPct: number; takeProfitPct: number; maxPositions: number }> = {
  conservative: { stopLossPct: 0.01, takeProfitPct: 0.03, maxPositions: 3 },
  moderate:     { stopLossPct: 0.02, takeProfitPct: 0.05, maxPositions: 5 },
  aggressive:   { stopLossPct: 0.04, takeProfitPct: 0.10, maxPositions: 8 },
};

export async function POST(request: NextRequest) {
  const tenant = getTenantFromRequest(request);
  if (!tenant) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { capital, dailyGoal, riskLevel, cryptoPct } = await request.json();

    if (capital == null || capital <= 0) {
      return NextResponse.json(
        { message: 'A valid capital amount is required' },
        { status: 400 },
      );
    }

    const risk: RiskLevel = ['conservative', 'moderate', 'aggressive'].includes(riskLevel)
      ? riskLevel
      : 'moderate';

    const preset = RISK_PRESETS[risk];
    const cryptoFraction = typeof cryptoPct === 'number' ? cryptoPct / 100 : 0.3;

    const db = getTenantDB();
    db.saveTenantConfig({
      tenantId: tenant.tenantId,
      simulatedCapital: capital,
      dailyGoal: dailyGoal || 100,
      cryptoPct: cryptoFraction,
      equityPct: 1 - cryptoFraction,
      stopLossPct: preset.stopLossPct,
      takeProfitPct: preset.takeProfitPct,
      maxPositions: preset.maxPositions,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save strategy config';
    return NextResponse.json({ message }, { status: 500 });
  }
}
