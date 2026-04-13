/**
 * Manager Orchestrator — Warren (MD) → Fin (Trading). Ops (SRE).
 *
 * STRIPPED 2026-04-10: Liza (news) and Ferd (research) removed. Their output
 * was observational — nothing in trade-engine consumed their state.
 * See docs/intelligence-layers-audit.md for the audit that surfaced this.
 *
 * Current roles:
 *   - Ops   : infrastructure/SRE monitor, 15s cycle
 *   - Warren: computes urgency (normal/elevated/critical) from P&L + positions, 30s cycle
 *   - Fin   : reads Warren's urgency, cuts losers on critical, banks winners > $500, 60s cycle
 */

import { Warren } from './warren.js';
import { Fin } from './fin.js';
import { Ops } from './ops.js';

export { Warren } from './warren.js';
export { Fin } from './fin.js';
export { Ops } from './ops.js';

export interface AllManagers {
  warren: Warren;
  fin: Fin;
  ops: Ops;
}

export function startManagers(dbPath: string): AllManagers {
  // Ops starts first — infrastructure before business logic
  const ops = new Ops(dbPath);
  ops.start();

  // Warren starts next — he's the MD
  const warren = new Warren(dbPath);
  warren.start();

  // Fin executes based on Warren's urgency
  const fin = new Fin(dbPath);
  fin.start().catch((e: any) => console.error('[Managers] Fin failed:', e.message));

  console.log('[Managers] Online — Ops (SRE/15s), Warren (MD/30s) → Fin (60s)');
  return { warren, fin, ops };
}

export function stopManagers(managers: AllManagers): void {
  managers.fin.stop();
  managers.warren.stop();
  managers.ops.stop(); // Ops stops last — keep monitoring until everything else is down
  console.log('[Managers] Offline');
}

export interface ManagerHealthReport {
  ops: ReturnType<Ops['getStatus']>;
  warren: ReturnType<Warren['getStatus']>;
  fin: ReturnType<Fin['getStatus']>;
}

export function getManagerHealth(managers: AllManagers): ManagerHealthReport {
  return {
    ops: managers.ops.getStatus(),
    warren: managers.warren.getStatus(),
    fin: managers.fin.getStatus(),
  };
}
