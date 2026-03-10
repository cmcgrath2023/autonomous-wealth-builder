/**
 * Gateway Routes for Expansion Services
 */

import { Router } from 'express';
import type { GlobalStream } from '../../../globalstream/src/index.js';
import type { CommoditiesTrader } from '../../../commodities-trader/src/index.js';
import type { DataCenterInfra } from '../../../datacenter-infra/src/index.js';
import type { ForexScanner } from '../../../forex-scanner/src/index.js';
import type { MetalsTrader } from '../../../metals-trader/src/index.js';
import type { OptionsTrader } from '../../../options-trader/src/index.js';
import type { OpenClawExpansion } from '../openclaw-expansion.js';
import { COMMODITY_CONTRACTS } from '../../../commodities-trader/src/index.js';
import { DATACENTER_ASSETS } from '../../../datacenter-infra/src/index.js';

export function createExpansionRoutes(
  openClaw: OpenClawExpansion,
  globalStream: GlobalStream,
  commodities: CommoditiesTrader,
  dataCenterInfra: DataCenterInfra,
  forexScanner?: ForexScanner,
  metalsTrader?: MetalsTrader,
  optionsTrader?: OptionsTrader
): Router {
  const router = Router();

  // Global Stream endpoints
  router.get('/global/sessions', (_req, res) => {
    const sessions = globalStream.getActiveSessions();
    res.json({ sessions });
  });

  router.get('/global/quotes', (_req, res) => {
    const quotes = globalStream.getAllQuotes();
    res.json({ quotes });
  });

  router.get('/global/quote/:symbol', (req, res) => {
    const quote = globalStream.getQuote(req.params.symbol);
    if (quote) {
      res.json({ quote });
    } else {
      res.status(404).json({ error: 'Quote not found' });
    }
  });

  // Commodities endpoints
  router.get('/commodities/contracts', (_req, res) => {
    res.json({ contracts: COMMODITY_CONTRACTS });
  });

  router.post('/commodities/spread/evaluate', async (_req, res) => {
    const quotes = await commodities.fetchQuotes(['LE', 'ZC']);
    const quoteMap = new Map(quotes.map(q => [q.symbol, q]));
    const cattleQuote = quoteMap.get('LE');
    const cornQuote = quoteMap.get('ZC');
    const spread = cattleQuote && cornQuote ? commodities.evaluateCattleCornSpread(cattleQuote, cornQuote) : null;
    res.json({ spread });
  });

  router.post('/commodities/seasonal/evaluate', async (_req, res) => {
    const quotes = await commodities.fetchQuotes(['HE']);
    const hogQuote = quotes.find(q => q.symbol === 'HE');
    const signal = hogQuote ? commodities.evaluateHogSeasonal(hogQuote) : null;
    res.json({ signal });
  });

  // DataCenter Infra endpoints
  router.get('/infra/assets', (_req, res) => {
    res.json({ assets: DATACENTER_ASSETS });
  });

  router.get('/infra/assets/:category', (req, res) => {
    const category = req.params.category as any;
    const assets = dataCenterInfra.getAssetsByCategory(category);
    res.json({ assets });
  });

  router.post('/infra/capex-event', (req, res) => {
    const event = req.body;
    event.announcementDate = new Date(event.announcementDate || Date.now());
    dataCenterInfra.registerCapexEvent(event);
    res.json({ registered: true });
  });

  router.get('/infra/allocation/:portfolioValue', (req, res) => {
    const portfolioValue = parseFloat(req.params.portfolioValue);
    const allocation = dataCenterInfra.getSectorAllocation(portfolioValue);
    res.json({ allocation });
  });

  // Forex Scanner endpoints
  router.get('/forex/pairs', (_req, res) => {
    res.json({
      pairs: [
        { symbol: 'EUR/USD', base: 'EUR', quote: 'USD', category: 'major', spread: 1.0 },
        { symbol: 'GBP/USD', base: 'GBP', quote: 'USD', category: 'major', spread: 1.5 },
        { symbol: 'USD/JPY', base: 'USD', quote: 'JPY', category: 'major', spread: 1.2 },
        { symbol: 'AUD/JPY', base: 'AUD', quote: 'JPY', category: 'carry', spread: 3.0 },
        { symbol: 'NZD/JPY', base: 'NZD', quote: 'JPY', category: 'carry', spread: 4.0 },
        { symbol: 'EUR/GBP', base: 'EUR', quote: 'GBP', category: 'cross', spread: 2.0 },
        { symbol: 'AUD/NZD', base: 'AUD', quote: 'NZD', category: 'cross', spread: 3.0 },
      ],
    });
  });

  router.get('/forex/quotes', (_req, res) => {
    if (!forexScanner) {
      return res.json({ quotes: [], session: 'unknown', connected: false });
    }
    const quotes = forexScanner.getQuotes();
    const session = forexScanner.getActiveSession();
    res.json({ quotes, session, connected: quotes.length > 0 });
  });

  router.get('/forex/session', (_req, res) => {
    if (!forexScanner) {
      return res.json({ session: 'unknown', sessions: {} });
    }
    const active = forexScanner.getActiveSession();
    res.json({
      session: active,
      sessions: {
        asian: forexScanner.isSessionOpen('asian'),
        london: forexScanner.isSessionOpen('london'),
        newyork: forexScanner.isSessionOpen('newyork'),
        overlap: forexScanner.isSessionOpen('overlap'),
      },
    });
  });

  router.post('/forex/scan', async (_req, res) => {
    if (!forexScanner) {
      return res.json({ signals: [], error: 'Forex scanner not configured' });
    }
    const momentum = forexScanner.evaluateSessionMomentum();
    const carry = forexScanner.evaluateCarryTrades();
    res.json({ signals: [...momentum, ...carry] });
  });

  // Metals Trader endpoints
  router.get('/metals/quotes', async (_req, res) => {
    if (!metalsTrader) {
      return res.json({ quotes: [], connected: false });
    }
    const quotesMap = metalsTrader.getQuotes();
    const quotes = Array.from(quotesMap.values());
    res.json({ quotes, connected: quotes.length > 0 });
  });

  router.get('/metals/assets', (_req, res) => {
    res.json({
      assets: [
        { symbol: 'GC', name: 'Gold Futures', type: 'futures', category: 'gold', proxy: 'GLD' },
        { symbol: 'SI', name: 'Silver Futures', type: 'futures', category: 'silver', proxy: 'SLV' },
        { symbol: 'GLD', name: 'Gold ETF', type: 'etf', category: 'gold' },
        { symbol: 'SLV', name: 'Silver ETF', type: 'etf', category: 'silver' },
        { symbol: 'MGC', name: 'Micro Gold Futures', type: 'futures', category: 'gold', proxy: 'GLD' },
      ],
    });
  });

  router.post('/metals/scan', async (_req, res) => {
    if (!metalsTrader) {
      return res.json({ signals: [], error: 'Metals trader not configured' });
    }
    await metalsTrader.onHeartbeat();
    const quotes = Array.from(metalsTrader.getQuotes().values());
    res.json({ quotes, scanned: true });
  });

  // Options Trader endpoints
  router.get('/options/strategies', (_req, res) => {
    res.json({
      strategies: [
        { id: 'covered_call', name: 'Covered Call', risk: 'defined', direction: 'neutral-bullish', description: 'Sell calls against owned shares for income' },
        { id: 'cash_secured_put', name: 'Cash-Secured Put', risk: 'defined', direction: 'bullish', description: 'Sell puts to get paid to buy at discount' },
        { id: 'protective_put', name: 'Protective Put', risk: 'defined', direction: 'hedging', description: 'Buy puts for portfolio insurance' },
        { id: 'collar', name: 'Collar', risk: 'defined', direction: 'neutral', description: 'Zero-cost hedge with put+call' },
      ],
    });
  });

  router.post('/options/evaluate/covered-call', (req, res) => {
    if (!optionsTrader) {
      return res.json({ signal: null, error: 'Options trader not configured' });
    }
    const { underlying, price, shares, ivRank } = req.body;
    const signal = optionsTrader.evaluateCoveredCall(underlying, price, shares, ivRank);
    res.json({ signal });
  });

  router.post('/options/evaluate/csp', (req, res) => {
    if (!optionsTrader) {
      return res.json({ signal: null, error: 'Options trader not configured' });
    }
    const { underlying, price, ivRank } = req.body;
    const signal = optionsTrader.evaluateCashSecuredPut(underlying, price, ivRank);
    res.json({ signal });
  });

  router.post('/options/evaluate/collar', (req, res) => {
    if (!optionsTrader) {
      return res.json({ signal: null, error: 'Options trader not configured' });
    }
    const { underlying, price, shares } = req.body;
    const signal = optionsTrader.evaluateCollar(underlying, price, shares);
    res.json({ signal });
  });

  // Forex open trades
  router.get('/forex/trades', async (_req, res) => {
    if (!forexScanner) {
      return res.json({ trades: [], account: null });
    }
    const trades = await forexScanner.getOpenTrades();
    res.json({ trades });
  });

  // Close a forex position
  router.post('/forex/close/:instrument', async (req, res) => {
    if (!forexScanner) {
      return res.json({ error: 'Forex scanner not configured' });
    }
    try {
      const result = await forexScanner.closePosition(req.params.instrument.replace('_', '/'));
      res.json({ result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // OpenClaw expansion control
  router.get('/openclaw/expansion/status', (_req, res) => {
    const agents = openClaw.getStatus();
    // Strip service references to avoid circular JSON
    const safe = agents.map((a: any) => ({
      id: a.id,
      name: a.name,
      autonomyLevel: a.autonomyLevel,
      heartbeatInterval: a.heartbeatInterval,
      enabled: a.enabled,
      lastHeartbeat: a.lastHeartbeat,
    }));
    res.json({ agents: safe });
  });

  router.post('/openclaw/expansion/autonomy/:agentId', (req, res) => {
    const { agentId } = req.params;
    const { level } = req.body;
    const success = openClaw.setAutonomyLevel(agentId, level);
    res.json({ success });
  });

  return router;
}
