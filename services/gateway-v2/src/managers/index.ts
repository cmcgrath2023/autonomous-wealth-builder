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

export { Warren } from './warren.js';
export { Fin } from './fin.js';
export { Liza } from './liza.js';
export { Ferd } from './ferd.js';

export interface AllManagers {
  warren: Warren;
  fin: Fin;
  liza: Liza;
  ferd: Ferd;
}

export function startManagers(dbPath: string): AllManagers {
  // Warren starts first — he's the MD
  const warren = new Warren(dbPath);
  warren.start();

  // Then his direct reports
  const fin = new Fin(dbPath);
  const liza = new Liza(dbPath);
  const ferd = new Ferd(dbPath);

  fin.start().catch((e: any) => console.error('[Managers] Fin failed:', e.message));
  liza.start().catch((e: any) => console.error('[Managers] Liza failed:', e.message));
  ferd.start().catch((e: any) => console.error('[Managers] Ferd failed:', e.message));

  console.log('[Managers] Family Office online — Warren (MD/30s) → Fin (60s), Liza (90s), Ferd (120s)');
  return { warren, fin, liza, ferd };
}

export function stopManagers(managers: AllManagers): void {
  managers.ferd.stop();
  managers.liza.stop();
  managers.fin.stop();
  managers.warren.stop();
  console.log('[Managers] Family Office offline');
}

export function getManagerHealth(managers: AllManagers) {
  return {
    warren: managers.warren.getStatus(),
    fin: managers.fin.getStatus(),
    liza: managers.liza.getStatus(),
    ferd: managers.ferd.getStatus(),
  };
}
