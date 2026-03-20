/**
 * Config Bus — Single source of truth for credentials and configuration.
 * All workers import this instead of loading their own vault/env combos.
 */

import { CredentialVault } from '../../qudag/src/vault.js';

export interface BrokerCredentials {
  alpaca: { apiKey: string; apiSecret: string; mode: 'paper' | 'live'; baseUrl: string } | null;
  oanda: { apiKey: string; accountId: string; mode: 'practice' | 'live'; baseUrl: string } | null;
}

let _creds: BrokerCredentials | null = null;

export function loadCredentials(): BrokerCredentials {
  if (_creds) return _creds;

  let alpacaKey = process.env.ALPACA_API_KEY || process.env.APCA_API_KEY_ID || '';
  let alpacaSec = process.env.ALPACA_API_SECRET || process.env.APCA_API_SECRET_KEY || '';
  let alpacaMode: 'paper' | 'live' = 'paper';
  let oandaKey = process.env.OANDA_API_KEY || '';
  let oandaAcct = process.env.OANDA_ACCOUNT_ID || '';

  // Vault — single attempt, shared key
  try {
    const vaultKey = process.env.MTWM_VAULT_KEY || 'mtwm-local-dev-key';
    const vault = new CredentialVault(vaultKey);

    const vk = vault.retrieve('alpaca-api-key');
    const vs = vault.retrieve('alpaca-api-secret');
    const vm = vault.retrieve('alpaca-mode');
    if (vk && vs) {
      alpacaKey = vk;
      alpacaSec = vs;
      alpacaMode = (vm === 'live' ? 'live' : 'paper');
    }

    const ok = vault.retrieve('oanda-api-key');
    const oa = vault.retrieve('oanda-account-id');
    if (ok) oandaKey = ok;
    if (oa) oandaAcct = oa;
  } catch {
    // Vault unavailable — env vars only
  }

  const alpacaBase = alpacaMode === 'live' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
  const isPractice = oandaAcct.startsWith('101-') || process.env.OANDA_MODE === 'practice';
  const oandaBase = isPractice ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com';

  _creds = {
    alpaca: alpacaKey && alpacaSec ? { apiKey: alpacaKey, apiSecret: alpacaSec, mode: alpacaMode, baseUrl: alpacaBase } : null,
    oanda: oandaKey && oandaAcct ? { apiKey: oandaKey, accountId: oandaAcct, mode: isPractice ? 'practice' : 'live', baseUrl: oandaBase } : null,
  };

  const aStatus = _creds.alpaca ? `Alpaca ${_creds.alpaca.mode}` : 'Alpaca NOT SET';
  const oStatus = _creds.oanda ? `OANDA ${_creds.oanda.mode}` : 'OANDA NOT SET';
  console.log(`[ConfigBus] ${aStatus} | ${oStatus}`);

  return _creds;
}

export function getAlpacaHeaders(): Record<string, string> | null {
  const creds = loadCredentials();
  if (!creds.alpaca) return null;
  return {
    'APCA-API-KEY-ID': creds.alpaca.apiKey,
    'APCA-API-SECRET-KEY': creds.alpaca.apiSecret,
  };
}

export function getAlpacaDataHeaders(): Record<string, string> | null {
  return getAlpacaHeaders();
}

export const ALPACA_DATA_URL = 'https://data.alpaca.markets';
export const FOREX_SERVICE_URL = 'http://localhost:3003';
