/**
 * Market Stream — Real-time signal detection via Alpaca WebSocket
 *
 * This is the missing piece. The heartbeat runs every 2 minutes checking
 * stale data. BIRD went from $2.50 to $5.84 in one hour and we didn't
 * notice until 2 hours later. This stream fires the MOMENT a threshold
 * is crossed.
 *
 * Architecture:
 *   Alpaca WebSocket (real-time trades + bars)
 *     → Volume/price threshold detector
 *       → Signal written to PG research_signals
 *         → Thesis generator scores conviction
 *           → If promoted → trade-engine notified via eventBus
 *
 * Thresholds:
 *   - Volume spike: 5-min volume > 50x the ticker's 20-day avg → ALERT
 *   - Price breakout: +15% from open → ALERT
 *   - Price continuation: +20% from a recent exit price → RE-ENTRY ALERT
 *
 * This runs as a long-lived WebSocket connection alongside the heartbeat.
 * It does NOT replace the heartbeat — it supplements it with real-time
 * detection that the 2-minute cycle misses.
 */

import WebSocket from 'ws';
import { GatewayStateStore } from '../../gateway/src/state-store.js';
import { eventBus } from '../../shared/utils/event-bus.js';

// ── Configuration ──────────────────────────────────────────────────

// SIP requires paid data subscription. IEX is free for paper trading.
const ALPACA_STREAM_URL = process.env.ALPACA_MODE === 'live'
  ? 'wss://stream.data.alpaca.markets/v2/sip'
  : 'wss://stream.data.alpaca.markets/v2/iex';

// Alert thresholds
const VOLUME_SPIKE_MULTIPLIER = 50;    // 50x normal 5-min volume
const PRICE_BREAKOUT_PCT = 15;         // +15% from open
const REENTRY_PCT = 20;               // +20% from our exit price

// Bars we subscribe to (1-minute bars for real-time detection)
const BAR_TIMEFRAME = '1Min';

// How many tickers to watch (Alpaca allows up to 10,000)
// Start with the momentum scanner's universe + recent positions
const MAX_WATCH_TICKERS = 500;

// ── Types ──────────────────────────────────────────────────────────

interface StreamAlert {
  ticker: string;
  alertType: 'volume_spike' | 'price_breakout' | 'reentry_signal' | 'continuation';
  magnitude: number;          // how far above threshold (e.g. 100x volume = 100)
  currentPrice: number;
  volume5min: number;
  changeFromOpen: number;     // % change from today's open
  timestamp: Date;
  detail: string;
}

interface BarUpdate {
  T: string;    // message type
  S: string;    // symbol
  o: number;    // open
  h: number;    // high
  l: number;    // low
  c: number;    // close
  v: number;    // volume
  t: string;    // timestamp
  n: number;    // trade count
  vw: number;   // vwap
}

// ── State ──────────────────────────────────────────────────────────

// Per-ticker tracking for volume baseline + open price
const tickerState = new Map<string, {
  openPrice: number;
  avgVolume5min: number;     // rolling average of 5-min volume
  recentVolumes: number[];   // last 20 five-minute volume readings
  lastAlertTime: number;     // prevent alert spam (min 5 min between alerts)
}>();

// Recent exits — for re-entry signal detection
const recentExits = new Map<string, { exitPrice: number; exitTime: number }>();

// ── Stream Manager ─────────────────────────────────────────────────

export class MarketStream {
  private ws: WebSocket | null = null;
  private store: GatewayStateStore;
  private apiKey: string;
  private apiSecret: string;
  private watchlist: string[] = [];
  private pgQuery: ((text: string, params?: unknown[]) => Promise<{ rows: any[] }>) | null = null;
  private reconnectDelay = 5000;
  private running = false;
  private alertCallbacks: Array<(alert: StreamAlert) => void> = [];

  constructor(
    store: GatewayStateStore,
    apiKey: string,
    apiSecret: string,
    pgQuery?: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>,
  ) {
    this.store = store;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.pgQuery = pgQuery ?? null;
  }

  /** Register a callback for when an alert fires. */
  onAlert(cb: (alert: StreamAlert) => void): void {
    this.alertCallbacks.push(cb);
  }

  /** Set the watchlist of tickers to monitor. */
  setWatchlist(tickers: string[]): void {
    this.watchlist = tickers.slice(0, MAX_WATCH_TICKERS);
    console.log(`[stream] Watchlist updated: ${this.watchlist.length} tickers`);

    // If already connected, resubscribe
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.subscribe();
    }
  }

  /** Track a recent exit for re-entry signal detection. */
  trackExit(ticker: string, exitPrice: number): void {
    recentExits.set(ticker, { exitPrice, exitTime: Date.now() });
    // Expire after 24 hours
    setTimeout(() => recentExits.delete(ticker), 24 * 60 * 60 * 1000);
  }

  /** Start the WebSocket connection. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
    console.log('[stream] Market stream starting');
  }

  stop(): void {
    this.running = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log('[stream] Market stream stopped');
  }

  // ── Connection management ──────────────────────────────────────

  private connect(): void {
    if (!this.running) return;

    try {
      this.ws = new WebSocket(ALPACA_STREAM_URL);

      this.ws.on('open', () => {
        console.log('[stream] WebSocket connected to Alpaca SIP');
        // Authenticate
        this.ws?.send(JSON.stringify({
          action: 'auth',
          key: this.apiKey,
          secret: this.apiSecret,
        }));
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const messages = JSON.parse(data.toString());
          for (const msg of Array.isArray(messages) ? messages : [messages]) {
            this.handleMessage(msg);
          }
        } catch {}
      });

      this.ws.on('close', () => {
        console.log(`[stream] WebSocket closed, reconnecting in ${this.reconnectDelay / 1000}s`);
        if (this.running) {
          setTimeout(() => this.connect(), this.reconnectDelay);
          this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 60000);
        }
      });

      this.ws.on('error', (err: Error) => {
        console.error(`[stream] WebSocket error: ${err.message}`);
      });
    } catch (e: any) {
      console.error(`[stream] Connection failed: ${e.message}`);
      if (this.running) {
        setTimeout(() => this.connect(), this.reconnectDelay);
      }
    }
  }

  private handleMessage(msg: any): void {
    if (msg.T === 'success' && msg.msg === 'authenticated') {
      console.log('[stream] Authenticated');
      this.reconnectDelay = 5000; // reset backoff
      this.subscribe();
      return;
    }

    if (msg.T === 'subscription') {
      console.log(`[stream] Subscribed to ${msg.bars?.length || 0} bar streams`);
      return;
    }

    // 1-minute bar update
    if (msg.T === 'b') {
      this.processBar(msg as BarUpdate);
    }
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.watchlist.length === 0) return;

    this.ws.send(JSON.stringify({
      action: 'subscribe',
      bars: this.watchlist,
    }));
  }

  // ── Bar processing + alert detection ───────────────────────────

  private processBar(bar: BarUpdate): void {
    const ticker = bar.S;
    const price = bar.c;
    const volume = bar.v;

    // Initialize or update ticker state
    let state = tickerState.get(ticker);
    if (!state) {
      state = {
        openPrice: bar.o,
        avgVolume5min: volume,
        recentVolumes: [volume],
        lastAlertTime: 0,
      };
      tickerState.set(ticker, state);
      return; // need at least 2 bars to detect anything
    }

    // Update rolling volume
    state.recentVolumes.push(volume);
    if (state.recentVolumes.length > 20) state.recentVolumes.shift();
    state.avgVolume5min = state.recentVolumes.reduce((s, v) => s + v, 0) / state.recentVolumes.length;

    // Rate limit: no more than 1 alert per ticker per 5 minutes
    const now = Date.now();
    if (now - state.lastAlertTime < 5 * 60 * 1000) return;

    // ── Check 1: Volume spike ──────────────────────────────────
    if (state.avgVolume5min > 0 && volume > state.avgVolume5min * VOLUME_SPIKE_MULTIPLIER) {
      const magnitude = Math.round(volume / state.avgVolume5min);
      this.fireAlert({
        ticker,
        alertType: 'volume_spike',
        magnitude,
        currentPrice: price,
        volume5min: volume,
        changeFromOpen: state.openPrice > 0 ? ((price - state.openPrice) / state.openPrice) * 100 : 0,
        timestamp: new Date(),
        detail: `${magnitude}x normal volume (${volume.toLocaleString()} vs avg ${Math.round(state.avgVolume5min).toLocaleString()})`,
      });
      state.lastAlertTime = now;
    }

    // ── Check 2: Price breakout from open ──────────────────────
    if (state.openPrice > 0) {
      const changeFromOpen = ((price - state.openPrice) / state.openPrice) * 100;
      if (changeFromOpen >= PRICE_BREAKOUT_PCT) {
        this.fireAlert({
          ticker,
          alertType: 'price_breakout',
          magnitude: changeFromOpen,
          currentPrice: price,
          volume5min: volume,
          changeFromOpen,
          timestamp: new Date(),
          detail: `+${changeFromOpen.toFixed(1)}% from open ($${state.openPrice.toFixed(2)} → $${price.toFixed(2)})`,
        });
        state.lastAlertTime = now;
      }
    }

    // ── Check 3: Re-entry signal (sold it, it kept running) ────
    const recentExit = recentExits.get(ticker);
    if (recentExit) {
      const changeFromExit = ((price - recentExit.exitPrice) / recentExit.exitPrice) * 100;
      if (changeFromExit >= REENTRY_PCT) {
        this.fireAlert({
          ticker,
          alertType: 'reentry_signal',
          magnitude: changeFromExit,
          currentPrice: price,
          volume5min: volume,
          changeFromOpen: state.openPrice > 0 ? ((price - state.openPrice) / state.openPrice) * 100 : 0,
          timestamp: new Date(),
          detail: `+${changeFromExit.toFixed(1)}% from our exit at $${recentExit.exitPrice.toFixed(2)} — continuation after we sold`,
        });
        state.lastAlertTime = now;
        recentExits.delete(ticker); // only alert once per exit
      }
    }
  }

  // ── Alert dispatch ─────────────────────────────────────────────

  private fireAlert(alert: StreamAlert): void {
    console.log(`[STREAM ALERT] ${alert.alertType.toUpperCase()} ${alert.ticker}: ${alert.detail}`);

    // Write to PG research_signals for thesis pipeline
    if (this.pgQuery) {
      const signalType = alert.alertType === 'volume_spike' ? 'volume_surge' :
                         alert.alertType === 'price_breakout' ? 'momentum_breakout' :
                         alert.alertType === 'reentry_signal' ? 'momentum_breakout' :
                         'technical_breakout';
      this.pgQuery(`
        INSERT INTO research_signals (symbol, sector, signal_type, headline, confidence, decay_hours,
          metadata, created_by, detected_at)
        VALUES ($1, '', $2, $3, $4, 4, $5, 'market_stream', NOW())
      `, [
        alert.ticker,
        signalType,
        alert.detail.slice(0, 200),
        Math.min(0.95, 0.6 + alert.magnitude / 500),
        JSON.stringify({
          alertType: alert.alertType,
          magnitude: alert.magnitude,
          price: alert.currentPrice,
          volume: alert.volume5min,
          changeFromOpen: alert.changeFromOpen,
        }),
      ]).catch((e: any) => console.log(`[stream] PG write failed: ${e.message?.slice(0, 40)}`));
    }

    // Emit on eventBus for trade-engine to pick up
    eventBus.emit('stream:alert' as any, alert);

    // Call registered callbacks
    for (const cb of this.alertCallbacks) {
      try { cb(alert); } catch {}
    }
  }
}
