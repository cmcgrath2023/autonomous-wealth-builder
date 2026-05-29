import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface YFinanceProfile {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  industry?: string | null;
  website?: string | null;
  quoteType?: string | null;
  summary?: string | null;
  marketCap?: number | null;
  avgDailyVolume?: number | null;
  currentPrice?: number | null;
  targetMeanPrice?: number | null;
  targetMedianPrice?: number | null;
  targetHighPrice?: number | null;
  targetLowPrice?: number | null;
  analystCount?: number | null;
  recommendationKey?: string | null;
  recommendationMean?: number | null;
  revenueGrowth?: number | null;
  profitMargins?: number | null;
  operatingMargins?: number | null;
  returnOnEquity?: number | null;
  debtToEquity?: number | null;
  freeCashflow?: number | null;
  recentUpgrades?: number;
  recentDowngrades?: number;
}

export async function fetchYFinanceProfiles(symbols: string[]): Promise<YFinanceProfile[]> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
  if (unique.length === 0) return [];

  const python = process.env.YFINANCE_PYTHON || process.env.PYTHON_BIN || 'python3';
  const script = join(process.cwd(), 'scripts', 'yfinance_bridge.py');
  if (!existsSync(script)) return [];

  try {
    const { stdout } = await execFileAsync(python, [script, ...unique], {
      timeout: 45_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout || '{}') as { ok?: boolean; profiles?: YFinanceProfile[]; error?: string };
    if (!parsed.ok || !Array.isArray(parsed.profiles)) return [];
    return parsed.profiles;
  } catch (e: any) {
    if (process.env.LOG_YFINANCE_BRIDGE_ERRORS === 'true') {
      console.warn(`[yfinance] bridge failed: ${e.message}`);
    }
    return [];
  }
}

export async function fetchYFinanceProfile(symbol: string): Promise<YFinanceProfile | null> {
  const profiles = await fetchYFinanceProfiles([symbol]);
  return profiles[0] ?? null;
}
