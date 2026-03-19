import { NextRequest, NextResponse } from 'next/server';
import { getTenantDB, getTenantFromRequest } from '@/src/lib/tenant';

const ALPACA_PAPER_URL = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE_URL = 'https://api.alpaca.markets';

export async function POST(request: NextRequest) {
  const tenant = getTenantFromRequest(request);
  if (!tenant) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { apiKey, apiSecret, mode } = await request.json();

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { message: 'API key and secret are required' },
        { status: 400 },
      );
    }

    const brokerMode = mode === 'live' ? 'live' : 'paper';

    // Validate credentials by hitting the Alpaca account endpoint
    const baseUrl = brokerMode === 'live' ? ALPACA_LIVE_URL : ALPACA_PAPER_URL;
    try {
      const res = await fetch(`${baseUrl}/v2/account`, {
        headers: {
          'APCA-API-KEY-ID': apiKey,
          'APCA-API-SECRET-KEY': apiSecret,
        },
      });

      if (!res.ok) {
        return NextResponse.json(
          { message: 'Invalid Alpaca credentials. Please check your API key and secret.' },
          { status: 400 },
        );
      }
    } catch {
      // If we can't reach Alpaca, save anyway but warn
      console.warn('[onboard/alpaca] Could not validate Alpaca credentials — saving anyway');
    }

    const db = getTenantDB();
    db.saveTenantCredentials({
      tenantId: tenant.tenantId,
      broker: 'alpaca',
      apiKey,
      apiSecret,
      mode: brokerMode,
    });

    return NextResponse.json({ ok: true, broker: 'alpaca', mode: brokerMode });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save Alpaca credentials';
    return NextResponse.json({ message }, { status: 500 });
  }
}
