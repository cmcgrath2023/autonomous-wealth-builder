import { NextRequest, NextResponse } from 'next/server';
import { getTenantDB, getTenantFromRequest } from '@/src/lib/tenant';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ broker: string }> },
) {
  const tenant = getTenantFromRequest(request);
  if (!tenant) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { broker } = await params;

    if (!broker) {
      return NextResponse.json({ message: 'Broker name is required' }, { status: 400 });
    }

    const db = getTenantDB();

    // Check credentials exist before deleting
    const existing = db.getTenantCredentials(tenant.tenantId, broker);
    if (!existing) {
      return NextResponse.json({ message: 'No credentials found for this broker' }, { status: 404 });
    }

    // TenantDB doesn't expose a deleteCredentials method, so we run the
    // query through the underlying DB instance. Access the private db via
    // a targeted approach: re-instantiate or use a raw helper.
    // For now, use the saveTenantCredentials with empty values is not ideal,
    // so we access the DB directly through a small workaround.
    const dbInstance = (db as unknown as { db: import('better-sqlite3').Database }).db;
    dbInstance
      .prepare('DELETE FROM tenant_credentials WHERE tenant_id = ? AND broker = ?')
      .run(tenant.tenantId, broker);

    return NextResponse.json({ ok: true, broker });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to remove broker';
    return NextResponse.json({ message }, { status: 500 });
  }
}
