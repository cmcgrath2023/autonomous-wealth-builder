import { TradeSignal, MarketData } from '../../shared/types/index.js';
import { eventBus } from '../../shared/utils/event-bus.js';
import { rsi, macd, bollingerBands, ema, sma } from './indicators.js';
import { neuralForecast } from './neural-forecast.js';
import { v4 as uuid } from 'uuid';

interface PriceHistory {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
}

export class NeuralTrader {
  private priceHistory: Map<string, PriceHistory> = new Map();
  private activeSignals: Map<string, TradeSignal> = new Map();
  private signalHistory: TradeSignal[] = [];
  private maxHistory = 200;

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.on('market:update', (payload) => {
      this.updatePrice(payload.ticker, payload.price);
    });
  }

  updatePrice(ticker: string, price: number) {
    const history = this.priceHistory.get(ticker) || { closes: [], highs: [], lows: [], volumes: [] };

    if (history.closes.length > 0) {
      // Update the latest bar instead of pushing a new one (intrabar update)
      // This prevents flooding historical data with duplicate prices every heartbeat
      const lastIdx = history.closes.length - 1;
      history.closes[lastIdx] = price;
      history.highs[lastIdx] = Math.max(history.highs[lastIdx] || price, price);
      history.lows[lastIdx] = Math.min(history.lows[lastIdx] || price, price);
    } else {
      // First data point
      history.closes.push(price);
      history.highs.push(price);
      history.lows.push(price);
      history.volumes.push(0);
    }

    this.priceHistory.set(ticker, history);
  }

  /** Add a new bar to history (used for hourly transitions) */
  addBar(ticker: string, price: number, volume: number = 0) {
    const history = this.priceHistory.get(ticker) || { closes: [], highs: [], lows: [], volumes: [] };
    history.closes.push(price);
    history.highs.push(price);
    history.lows.push(price);
    history.volumes.push(volume);

    if (history.closes.length > this.maxHistory) {
      history.closes.shift();
      history.highs.shift();
      history.lows.shift();
      history.volumes.shift();
    }

    this.priceHistory.set(ticker, history);
  }

  ingestHistoricalData(ticker: string, data: PriceHistory) {
    this.priceHistory.set(ticker, data);
  }

  getPriceHistory(ticker: string): number[] {
    return this.priceHistory.get(ticker)?.closes || [];
  }

  /**
   * Detect overall market regime from broad index data.
   * Returns 'bear' if SPY/QQQ are trending down, 'bull' if up, 'neutral' otherwise.
   */
  private detectMarketRegime(): 'bull' | 'bear' | 'neutral' {
    // Check SPY and QQQ for broad market direction
    for (const idx of ['SPY', 'QQQ']) {
      const history = this.priceHistory.get(idx);
      if (!history || history.closes.length < 20) continue;
      const closes = history.closes;
      const current = closes[closes.length - 1];
      const ago10 = closes[closes.length - 10];
      const ago20 = closes[closes.length - 20];
      const mom10 = (current - ago10) / ago10;
      const mom20 = (current - ago20) / ago20;
      if (mom10 < -0.02 && mom20 < -0.03) return 'bear';
      if (mom10 > 0.02 && mom20 > 0.03) return 'bull';
    }
    return 'neutral';
  }

  // Inverse/bear ETFs that profit from market declines
  private static INVERSE_ETFS = ['SQQQ', 'SPXS', 'UVXY', 'SH', 'PSQ', 'DOG'];
  // Commodity/metal ETFs that can be safe havens or momentum plays
  private static COMMODITY_ETFS = ['USO', 'UNG', 'UGA', 'DBO', 'GSG', 'DBA', 'SLV', 'GLD', 'SIVR', 'GDX', 'GDXJ'];

  async scan(tickers?: string[]): Promise<TradeSignal[]> {
    const symbols = tickers || Array.from(this.priceHistory.keys());
    const signals: TradeSignal[] = [];
    const regime = this.detectMarketRegime();
    if (regime !== 'neutral') {
      console.log(`[NeuralTrader] Market regime: ${regime.toUpperCase()}`);
    }

    // Run analysis in parallel for all tickers
    const results = await Promise.all(symbols.map(ticker => this.analyze(ticker, regime)));

    for (const signal of results) {
      if (signal) {
        signals.push(signal);
        this.activeSignals.set(signal.id, signal);
        this.signalHistory.push(signal);
        eventBus.emit('signal:new', {
          signalId: signal.id,
          ticker: signal.ticker,
          direction: signal.direction,
          confidence: signal.confidence,
        });
      }
    }

    return signals;
  }

  async analyze(ticker: string, regime: 'bull' | 'bear' | 'neutral' = 'neutral'): Promise<TradeSignal | null> {
    const history = this.priceHistory.get(ticker);
    if (!history || history.closes.length < 30) return null; // 30+ points (lowered from 50 for faster signals)

    const closes = history.closes;
    const current = closes[closes.length - 1];
    const prev = closes[closes.length - 2];

    // ===== INDICATORS =====
    const rsiValues = rsi(closes);
    const currentRsi = rsiValues[rsiValues.length - 1];
    const prevRsi = rsiValues[rsiValues.length - 2] || currentRsi;

    const macdResult = macd(closes);
    const currentMacd = macdResult.histogram[macdResult.histogram.length - 1] || 0;
    const prevMacd = macdResult.histogram[macdResult.histogram.length - 2] || 0;
    const macdLine = macdResult.macd[macdResult.macd.length - 1] || 0;
    const signalLine = macdResult.signal[macdResult.signal.length - 1] || 0;

    const bb = bollingerBands(closes);
    const bbUpper = bb.upper[bb.upper.length - 1] || current;
    const bbLower = bb.lower[bb.lower.length - 1] || current;
    const bbMid = bb.middle[bb.middle.length - 1] || current;
    const bbWidth = bbUpper - bbLower;
    const bbPosition = bbWidth > 0 ? (current - bbLower) / bbWidth : 0.5;

    const ema9 = ema(closes, 9);
    const ema21 = ema(closes, 21);
    const ema50 = ema(closes, 50);
    const emaFast = ema9[ema9.length - 1] || current;
    const emaMid = ema21[ema21.length - 1] || current;
    const emaSlow = ema50.length > 0 ? ema50[ema50.length - 1] : current;

    // Recent momentum: price change over last 5, 10, 20 bars
    const mom5 = closes.length >= 5 ? (current - closes[closes.length - 5]) / closes[closes.length - 5] : 0;
    const mom10 = closes.length >= 10 ? (current - closes[closes.length - 10]) / closes[closes.length - 10] : 0;
    const mom20 = closes.length >= 20 ? (current - closes[closes.length - 20]) / closes[closes.length - 20] : 0;

    // Volatility (average true range approximation)
    const recentCloses = closes.slice(-20);
    const returns = recentCloses.slice(1).map((c, i) => Math.abs((c - recentCloses[i]) / recentCloses[i]));
    const avgVolatility = returns.reduce((s, r) => s + r, 0) / returns.length;

    // ===== SIGNAL SCORING — PAPER TRADING PHASE: BE AGGRESSIVE, LEARN FAST =====
    // Each indicator votes independently. We need patterns to confirm but cast a wider net during paper phase.
    let buyVotes = 0;
    let sellVotes = 0;
    let totalVotes = 0;
    const confirmations: string[] = [];

    // 1. RSI — widened thresholds for paper phase
    if (currentRsi < 30) { buyVotes += 1; confirmations.push(`RSI oversold (${currentRsi.toFixed(1)})`); }
    else if (currentRsi < 40 && prevRsi < currentRsi) { buyVotes += 0.5; confirmations.push(`RSI recovering (${currentRsi.toFixed(1)})`); }
    else if (currentRsi > 70) { sellVotes += 1; confirmations.push(`RSI overbought (${currentRsi.toFixed(1)})`); }
    else if (currentRsi > 60 && prevRsi > currentRsi) { sellVotes += 0.5; confirmations.push(`RSI weakening (${currentRsi.toFixed(1)})`); }
    totalVotes++;

    // 2. MACD — include sustained momentum, not just crossovers
    if (currentMacd > 0 && prevMacd <= 0) { buyVotes += 1; confirmations.push('MACD bullish crossover'); }
    else if (currentMacd < 0 && prevMacd >= 0) { sellVotes += 1; confirmations.push('MACD bearish crossunder'); }
    else if (macdLine > signalLine) { buyVotes += 0.5; confirmations.push('MACD bullish'); }
    else if (macdLine < signalLine) { sellVotes += 0.5; confirmations.push('MACD bearish'); }
    totalVotes++;

    // 3. Bollinger Band position — widened zones
    if (bbPosition < 0.15) { buyVotes += 1; confirmations.push(`BB lower zone (${(bbPosition * 100).toFixed(0)}%)`); }
    else if (bbPosition < 0.30 && current > prev) { buyVotes += 0.5; confirmations.push('BB lower half bounce'); }
    else if (bbPosition > 0.85) { sellVotes += 1; confirmations.push(`BB upper zone (${(bbPosition * 100).toFixed(0)}%)`); }
    else if (bbPosition > 0.70 && current < prev) { sellVotes += 0.5; confirmations.push('BB upper half rejection'); }
    totalVotes++;

    // 4. EMA alignment
    if (emaFast > emaMid && emaMid > emaSlow) { buyVotes += 1; confirmations.push('EMA bullish stack (9>21>50)'); }
    else if (emaFast < emaMid && emaMid < emaSlow) { sellVotes += 1; confirmations.push('EMA bearish stack (9<21<50)'); }
    else if (emaFast > emaMid) { buyVotes += 0.5; confirmations.push('Short-term EMA bullish'); }
    else if (emaFast < emaMid) { sellVotes += 0.5; confirmations.push('Short-term EMA bearish'); }
    totalVotes++;

    // 5. Short-term momentum — lower thresholds
    if (mom5 > 0.01 && mom10 > 0) { buyVotes += 1; confirmations.push(`Positive momentum (+${(mom5 * 100).toFixed(1)}% 5-bar)`); }
    else if (mom5 < -0.01 && mom10 < 0) { sellVotes += 1; confirmations.push(`Negative momentum (${(mom5 * 100).toFixed(1)}% 5-bar)`); }
    else if (mom5 > 0.005) { buyVotes += 0.3; confirmations.push(`Slight upward drift`); }
    else if (mom5 < -0.005) { sellVotes += 0.3; confirmations.push(`Slight downward drift`); }
    totalVotes++;

    // 6. Mean reversion / oversold bounce / overextended — widened
    if (mom20 < -0.03 && currentRsi < 45 && current > prev) {
      buyVotes += 1;
      confirmations.push(`Oversold bounce (${(mom20 * 100).toFixed(1)}% drawdown, recovering)`);
    } else if (mom10 < -0.02 && currentRsi < 40) {
      buyVotes += 0.5;
      confirmations.push(`Beaten down (RSI ${currentRsi.toFixed(0)}, ${(mom10 * 100).toFixed(1)}% drop)`);
    }
    else if (mom20 > 0.05 && currentRsi > 60 && current < prev) {
      sellVotes += 1;
      confirmations.push(`Overextended reversal (${(mom20 * 100).toFixed(1)}% run, topping)`);
    } else if (mom10 > 0.03 && currentRsi > 65) {
      sellVotes += 0.5;
      confirmations.push(`Overheated (RSI ${currentRsi.toFixed(0)}, +${(mom10 * 100).toFixed(1)}% run)`);
    }
    totalVotes++;

    // 7. NEURAL FORECAST — ruv-swarm LSTM+GRU ensemble (ruv-FANN intelligence)
    try {
      const forecast = await neuralForecast(closes);
      if (forecast && forecast.direction !== 'neutral' && forecast.confidence > 0.4) {
        if (forecast.direction === 'up') {
          buyVotes += forecast.modelAgreement; // Full vote if models agree, 0.3 if not
          confirmations.push(`Neural forecast UP (+${(forecast.predictedMove * 100).toFixed(2)}%, agreement: ${(forecast.modelAgreement * 100).toFixed(0)}%)`);
        } else {
          sellVotes += forecast.modelAgreement;
          confirmations.push(`Neural forecast DOWN (${(forecast.predictedMove * 100).toFixed(2)}%, agreement: ${(forecast.modelAgreement * 100).toFixed(0)}%)`);
        }
      }
    } catch {
      // Neural forecast is additive — if it fails, we still have 6 classical votes
    }
    totalVotes++;

    // 8. MARKET REGIME BOOST — adapt to current conditions
    const isInverseETF = NeuralTrader.INVERSE_ETFS.includes(ticker);
    const isCommodityETF = NeuralTrader.COMMODITY_ETFS.includes(ticker);

    if (regime === 'bear') {
      // In bear markets: boost short signals and inverse ETF buys
      if (isInverseETF) {
        // Inverse ETFs go UP when market goes DOWN — treat as buy opportunity
        buyVotes += 1;
        confirmations.push(`Bear regime: ${ticker} is inverse ETF (profits from decline)`);
      } else if (!isCommodityETF && !ticker.includes('-')) {
        // Regular stocks: boost sell/short signals
        sellVotes += 0.5;
        confirmations.push(`Bear regime: selling pressure on equities`);
      }
      // Commodities/metals often rally in bear markets as safe havens
      if (isCommodityETF && mom5 > 0) {
        buyVotes += 0.5;
        confirmations.push(`Bear regime: ${ticker} safe-haven/commodity momentum`);
      }
    } else if (regime === 'bull') {
      // In bull markets: boost buy signals on growth stocks
      if (!isInverseETF && buyVotes > 0) {
        buyVotes += 0.5;
        confirmations.push(`Bull regime: risk-on momentum`);
      }
    }

    // Commodity/energy momentum boost: if trending strongly, amplify
    if (isCommodityETF && Math.abs(mom5) > 0.03) {
      const dir = mom5 > 0 ? 'buy' : 'sell';
      if (dir === 'buy') { buyVotes += 0.5; confirmations.push(`Strong commodity momentum (+${(mom5 * 100).toFixed(1)}% 5-bar)`); }
      else { sellVotes += 0.5; confirmations.push(`Commodity weakness (${(mom5 * 100).toFixed(1)}% 5-bar)`); }
    }
    totalVotes++;

    // ===== CONFIDENCE CALCULATION =====
    const isCrypto = ticker.includes('-');
    let direction: 'buy' | 'sell' | 'short' | 'hold';
    if (buyVotes > sellVotes) {
      direction = 'buy';
    } else if (sellVotes > buyVotes) {
      // For stocks: emit 'short' to open a new short position
      // For crypto: emit 'sell' (can only close longs, can't short on Alpaca)
      // For inverse ETFs: don't short them — they're already our bear play
      direction = isCrypto ? 'sell' : (isInverseETF ? 'sell' : 'short');
    } else {
      direction = 'hold';
    }
    const strongVotes = Math.max(buyVotes, sellVotes);
    const confidence = strongVotes / totalVotes;

    // SPEC-005 AGGRESSIVE PHASE: Lower thresholds to capture opportunities
    // $5K → $10K in 30 days requires aggressive entry with tight stops
    const MIN_CONFIDENCE = 0.30; // 30% — even 2-3 indicators agreeing is enough
    const MIN_CONFIRMATIONS = 1;  // Single strong confirmation can trigger
    const MIN_REWARD_RISK = 0.5;  // Accept lower R:R to capture more moves

    if (confidence < MIN_CONFIDENCE || direction === 'hold') return null;

    if (confirmations.length < MIN_CONFIRMATIONS) return null;

    // ===== EXPECTED VALUE CHECK =====
    const expectedMove = avgVolatility * 5; // 5-bar expected move
    const stopLoss = 0.02; // 2% stop
    const rewardRisk = expectedMove / stopLoss;
    if (rewardRisk < MIN_REWARD_RISK) return null;

    return {
      id: uuid(),
      ticker,
      direction,
      confidence: Math.round(confidence * 100) / 100,
      timeframe: '1h',
      indicators: {
        rsi: Math.round(currentRsi * 100) / 100,
        macd: Math.round(currentMacd * 1000) / 1000,
        bbPosition: Math.round(bbPosition * 100) / 100,
        emaCross: emaFast > emaMid ? 1 : 0,
        mom5: Math.round(mom5 * 10000) / 10000,
        mom20: Math.round(mom20 * 10000) / 10000,
        volatility: Math.round(avgVolatility * 10000) / 10000,
        rewardRisk: Math.round(rewardRisk * 100) / 100,
        confirmations: confirmations.length,
      },
      pattern: confirmations[0] || 'multi_confirm',
      timestamp: new Date(),
      source: 'neural_trader',
    };
  }

  getActiveSignals(): TradeSignal[] {
    return Array.from(this.activeSignals.values());
  }

  getSignalHistory(limit = 50): TradeSignal[] {
    return this.signalHistory.slice(-limit);
  }

  clearSignal(signalId: string) {
    this.activeSignals.delete(signalId);
  }

  /** Diagnostic: show raw indicator scores for all tickers, even if they don't meet the signal threshold */
  async diagnose(): Promise<Record<string, any>> {
    const results: Record<string, any> = {};
    for (const [ticker, history] of this.priceHistory.entries()) {
      const closes = history.closes;
      if (closes.length < 30) {
        results[ticker] = { dataPoints: closes.length, status: 'insufficient_data' };
        continue;
      }

      const current = closes[closes.length - 1];
      const rsiValues = rsi(closes);
      const currentRsi = rsiValues[rsiValues.length - 1];
      const macdResult = macd(closes);
      const currentMacd = macdResult.histogram[macdResult.histogram.length - 1] || 0;
      const bb = bollingerBands(closes);
      const bbUpper = bb.upper[bb.upper.length - 1] || current;
      const bbLower = bb.lower[bb.lower.length - 1] || current;
      const bbWidth = bbUpper - bbLower;
      const bbPosition = bbWidth > 0 ? (current - bbLower) / bbWidth : 0.5;
      const ema9 = ema(closes, 9);
      const ema21 = ema(closes, 21);
      const emaFast = ema9[ema9.length - 1] || current;
      const emaMid = ema21[ema21.length - 1] || current;
      const mom5 = closes.length >= 5 ? (current - closes[closes.length - 5]) / closes[closes.length - 5] : 0;
      const recentCloses = closes.slice(-20);
      const returns = recentCloses.slice(1).map((c, i) => Math.abs((c - recentCloses[i]) / recentCloses[i]));
      const avgVol = returns.reduce((s, r) => s + r, 0) / returns.length;

      // Run full analysis to get signal (or null)
      const signal = await this.analyze(ticker);

      results[ticker] = {
        dataPoints: closes.length,
        price: Math.round(current * 100) / 100,
        rsi: Math.round(currentRsi * 10) / 10,
        macdHist: Math.round(currentMacd * 1000) / 1000,
        bbPosition: Math.round(bbPosition * 100) + '%',
        emaDirection: emaFast > emaMid ? 'bullish' : 'bearish',
        mom5: (mom5 * 100).toFixed(2) + '%',
        volatility: (avgVol * 100).toFixed(2) + '%',
        rewardRisk: Math.round((avgVol * 5 / 0.02) * 100) / 100,
        signalFired: signal !== null,
        confidence: signal?.confidence || 0,
        direction: signal?.direction || 'none',
      };
    }
    return results;
  }
}
