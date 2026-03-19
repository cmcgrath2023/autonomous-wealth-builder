import { NextRequest, NextResponse } from 'next/server';
import { getTenantDB, getTenantFromRequest } from '@/src/lib/tenant';

const OANDA_API_URL = 'https://api-fxpractice.oanda.com';
const OANDA_LIVE_URL = 'https://api-fxtrade.oanda.com';

export async function POST(request: NextRequest) {
  const tenant = getTenantFromRequest(request);
  if (!tenant) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { apiKey, accountId, skipped } = await request.json();

    // Allow skipping OANDA setup
    if (skipped || (!apiKey && !accountId)) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    if (!apiKey || !accountId) {
      return NextResponse.json(
        { message: 'Both API key and account ID are required' },
        { status: 400 },
      );
    }

    // Validate credentials by hitting the OANDA account endpoint
    // Try practice first, then live
    let validated = false;
    for (const baseUrl of [OANDA_API_URL, OANDA_LIVE_URL]) {
      try {
        const res = await fetch(`${baseUrl}/v3/accounts/${accountId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          validated = true;
          break;
        }
      } catch {
        // Try next URL
      }
    }

    if (!validated) {
      console.warn('[onboard/oanda] Could not validate OANDA credentials — saving anyway');
    }

    const db = getTenantDB();
    db.saveTenantCredentials({
      tenantId: tenant.tenantId,
      broker: 'oanda',
      apiKey,
      apiSecret: apiKey, // OANDA uses a single token; store it in both fields
      accountId,
      mode: 'live',
    });

    return NextResponse.json({ ok: true, broker: 'oanda' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save OANDA credentials';
    return NextResponse.json({ message }, { status: 500 });
  }
}
