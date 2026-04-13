/**
 * Verify Sell Paths — build-time fitness test
 *
 * This is the test that, had it existed in the original Gateway-v2 build,
 * would have caught the 2026-04-10 -$6,787 incident before it shipped.
 *
 * The bug: 6 independent sell paths existed in gateway-v2 but only 2 of them
 * wrote to the `closed_trades` SQLite table. Every failsafe (circuit breaker,
 * SL dominance halt, daily P&L dashboards) read from that table, so they were
 * all silently blind. The circuit breaker never tripped on a -$1,000 day loss
 * limit despite multiple days of -$1,000+ losses.
 *
 * The rule this enforces:
 *   Every Alpaca sell execution (POST /v2/orders with side:sell, or
 *   DELETE /v2/positions/{ticker}) MUST be accompanied by a call to
 *   `recordClosedTrade(` within ±30 lines in the same file.
 *
 * Usage:
 *   node --import tsx/esm gateway-v2/tests/verify-sell-paths.ts
 *
 * Exit codes:
 *   0 — all sell paths are wired to the store
 *   1 — one or more sell paths are missing the recording call
 *
 * This should be wired into CI and into `npm run build` before any deploy.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SEARCH_ROOTS = [
  join(import.meta.dirname ?? __dirname, '..', 'src'),
  join(import.meta.dirname ?? __dirname, '..', '..', 'gateway-v2', 'src'),
];

// Source files that are ALLOWED to contain a sell execution without an
// adjacent recordClosedTrade — these are either the recorder itself or
// tests/fixtures. Add sparingly and with a justification comment.
const ALLOWLIST = new Set<string>([
  // trade-recorder.ts is where recordClosedTrade lives — no sell calls at all
  'trade-recorder.ts',
  // verify script itself
  'verify-sell-paths.ts',
]);

// Patterns that identify a sell execution. Each match is a "suspicious line"
// that must be justified by a nearby store write.
// Deliberately narrow — we only care about paths that actually hit Alpaca
// or OANDA. Internal wrappers (like fin.ts's private `sellPosition`) are
// allowed to fan out because we verify the wrapper itself records once.
const SELL_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  // POST /v2/orders with side:'sell' (handles both spacing variants)
  { name: 'orders POST side:sell', regex: /side:\s*['"`]sell['"`]/ },
  // DELETE /v2/positions/{ticker}
  { name: 'positions DELETE', regex: /\/v2\/positions\/\$\{[^}]*\}['"`]?,\s*\{\s*method:\s*['"`]DELETE/ },
  // Executor-level sell — only match qualified calls, not `this.sellPosition`
  { name: 'executor.sellPosition', regex: /\bexecutor\.sellPosition\s*\(/ },
  // Forex close via the shared ForexScanner client
  { name: 'forex.closePosition', regex: /\bforex\.closePosition\s*\(/ },
];

// Patterns that count as "the store was written" — any of these within ±30
// lines of a sell pattern makes that sell pass.
const WRITE_PATTERNS: RegExp[] = [
  /recordClosedTrade\s*\(/,
  /store\.recordTrade\s*\(/,
];

const WINDOW = 30;      // lines
const FILES_CHECKED: string[] = [];

interface Violation {
  file: string;
  line: number;
  pattern: string;
  excerpt: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === 'dist' || name === 'tests') continue;
        out.push(...walk(full));
      } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  } catch {}
  return out;
}

function checkFile(path: string): Violation[] {
  const base = path.split('/').pop() || path;
  if (ALLOWLIST.has(base)) return [];

  const src = readFileSync(path, 'utf8');
  const lines = src.split('\n');

  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of SELL_PATTERNS) {
      if (!p.regex.test(line)) continue;
      // Found a suspicious line — scan the window for a write.
      const start = Math.max(0, i - WINDOW);
      const end = Math.min(lines.length, i + WINDOW + 1);
      const windowSrc = lines.slice(start, end).join('\n');
      const hasWrite = WRITE_PATTERNS.some((w) => w.test(windowSrc));
      if (!hasWrite) {
        violations.push({
          file: path,
          line: i + 1,
          pattern: p.name,
          excerpt: line.trim().slice(0, 120),
        });
      }
    }
  }
  return violations;
}

function main(): void {
  const allFiles = new Set<string>();
  for (const root of SEARCH_ROOTS) {
    for (const f of walk(root)) allFiles.add(f);
  }

  const violations: Violation[] = [];
  for (const f of allFiles) {
    FILES_CHECKED.push(f);
    violations.push(...checkFile(f));
  }

  console.log(`[verify-sell-paths] Scanned ${FILES_CHECKED.length} files`);
  if (violations.length === 0) {
    console.log('[verify-sell-paths] OK — every sell path has a nearby recordClosedTrade/recordTrade call');
    process.exit(0);
  }

  console.error(`[verify-sell-paths] FAIL — ${violations.length} sell path(s) without a store write within ±${WINDOW} lines:`);
  for (const v of violations) {
    const rel = v.file.replace(/.*\/services\//, 'services/');
    console.error(`  ${rel}:${v.line}  [${v.pattern}]`);
    console.error(`    ${v.excerpt}`);
  }
  console.error('');
  console.error('Every Alpaca sell path MUST call recordClosedTrade() or store.recordTrade()');
  console.error('within ±30 lines. This rule exists because of the 2026-04-10 incident where');
  console.error('4 of 6 sell paths missed the write and every failsafe went blind.');
  console.error('');
  console.error('Fix: wrap the sell in a recordClosedTrade call from trade-recorder.ts.');
  console.error('If a sell path legitimately does not need to record (extremely rare),');
  console.error('add the filename to ALLOWLIST in verify-sell-paths.ts with a justification.');
  process.exit(1);
}

main();
