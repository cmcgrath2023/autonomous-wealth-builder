/**
 * Manager Orchestrator — Warren (MD) → Fin (Trading), Liza (News), Ferd (Research)
 *
 * Warren starts first, then his direct reports. All use shared state store
 * for coordination. Each manager has learning/observation capabilities
 * that feed the Bayesian intelligence layer.
 */

import { Warren } from './warren.js';
import { Fin } from './fin.js';
import { Liza } from './liza.js';
import { Ferd } from './ferd.js';
import { Ops } from './ops.js';

export { Warren } from './warren.js';
export { Fin } from './fin.js';
export { Liza } from './liza.js';
export { Ferd } from './ferd.js';
export { Ops } from './ops.js';

export interface AllManagers {
  warren: Warren;
  fin: Fin;
  liza: Liza;
  ferd: Ferd;
  ops: Ops;
}

export function startManagers(dbPath: string): AllManagers {
  // Ops starts first — infrastructure before business logic
  const ops = new Ops(dbPath);
  ops.start();

  // Warren starts next — he's the MD
  const warren = new Warren(dbPath);
  warren.start();

  // Then his direct reports
  const fin = new Fin(dbPath);
  const liza = new Liza(dbPath);
  const ferd = new Ferd(dbPath);

  fin.start().catch((e: any) => console.error('[Managers] Fin failed:', e.message));
  liza.start().catch((e: any) => console.error('[Managers] Liza failed:', e.message));
  ferd.start().catch((e: any) => console.error('[Managers] Ferd failed:', e.message));

  console.log('[Managers] Family Office online — Ops (SRE/15s), Warren (MD/30s) → Fin (60s), Liza (90s), Ferd (120s)');
  return { warren, fin, liza, ferd, ops };
}

export function stopManagers(managers: AllManagers): void {
  managers.ferd.stop();
  managers.liza.stop();
  managers.fin.stop();
  managers.warren.stop();
  managers.ops.stop(); // Ops stops last — keep monitoring until everything else is down
  console.log('[Managers] Family Office offline');
}

export function getManagerHealth(managers: AllManagers) {
  return {
    ops: managers.ops.getStatus(),
    warren: managers.warren.getStatus(),
    fin: managers.fin.getStatus(),
    liza: managers.liza.getStatus(),
    ferd: managers.ferd.getStatus(),
  };
}
