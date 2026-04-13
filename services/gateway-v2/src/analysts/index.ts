/**
 * Analysts barrel export.
 *
 * Wave 1 (shipped 2026-04-10 — defensive):
 *   - RiskManager     : blocks bad trades before they execute
 *   - PostMortemAnalyst: learns from losing days, writes risk rules
 *
 * Wave 2 (next — offensive):
 *   - CatalystHunter  : finds catalyst-backed tickers, widens universe
 *   - MacroAnalyst    : regime detection + position-sizing multiplier
 *
 * Wave 3 (refinement):
 *   - ExitAnalyst     : targets, trailing stops, time stops
 *   - SectorRotator   : biases universe toward leading sectors
 *
 * Wave 4: Nanobot cron reintroduction — ties all of the above to scheduled
 * triggers instead of in-process timers.
 */

export { RiskManager, DEFAULT_RISK_CONFIG } from './risk-manager.js';
export type { RiskConfig, RiskVerdict, RiskCandidate, RiskPosition } from './risk-manager.js';

export { PostMortemAnalyst } from './post-mortem.js';
export type { PostMortemResult } from './post-mortem.js';

export { MacroAnalyst } from './macro-analyst.js';
export type { MacroVerdict, MarketRegime } from './macro-analyst.js';

export { CatalystHunter } from './catalyst-hunter.js';
export type { CatalystCandidate, CatalystResult } from './catalyst-hunter.js';

export { scanMomentum, persistMomentumStars, persistMomentumData } from './momentum-scanner.js';
export type { MomentumResult, MomentumScanResult } from './momentum-scanner.js';

export { ExitAnalyst } from './exit-analyst.js';
export type { ExitPlan } from './exit-analyst.js';

export { SectorRotator } from './sector-rotator.js';
export type { SectorBias, SectorRotationResult } from './sector-rotator.js';
