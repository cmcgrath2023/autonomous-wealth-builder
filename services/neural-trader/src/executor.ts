import { TradeSignal, Position, Portfolio } from '../../shared/types/index.js';
import { eventBus } from '../../shared/utils/event-bus.js';

export interface TradeOrder {
  id: string;
  signalId: string;
  ticker: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  type: 'market' | 'limit';
  status: 'pending' | 'filled' | 'rejected' | 'cancelled';
  filledAt?: Date;
  filledPrice?: number;
}

export interface BrokerConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  paperTrading: boolean;
}

export class TradeExecutor {
  private config: BrokerConfig;
  private orders: Map<string, TradeOrder> = new Map();

  constructor(config?: Partial<BrokerConfig>) {
    this.config = {
      apiKey: config?.apiKey || '',
      apiSecret: config?.apiSecret || '',
      baseUrl: config?.baseUrl || 'https://paper-api.alpaca.markets',
      paperTrading: config?.paperTrading ?? true,
    };
  }

  async execute(signal: TradeSignal, quantity: number, positionValue: number): Promise<TradeOrder> {
    const order: TradeOrder = {
      id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      signalId: signal.id,
      ticker: signal.ticker,
      side: signal.direction === 'buy' ? 'buy' : 'sell', // 'short' also maps to 'sell' side for Alpaca
      quantity,
      price: 0,
      type: 'market',
      status: 'pending',
    };

    if (!this.config.apiKey || !this.config.apiSecret) {
      order.status = 'rejected';
      console.error('[Executor] No broker credentials configured — cannot execute trades');
      this.orders.set(order.id, order);
      return order;
    }
    return this.executeLive(order);
  }

  private async executeLive(order: TradeOrder): Promise<TradeOrder> {
    try {
      const response = await fetch(`${this.config.baseUrl}/v2/orders`, {
        method: 'POST',
        headers: {
          'APCA-API-KEY-ID': this.config.apiKey,
          'APCA-API-SECRET-KEY': this.config.apiSecret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: order.ticker.replace('-', '/'), // Alpaca crypto uses BTC/USD format
          qty: order.quantity.toString(),
          side: order.side,
          type: order.type,
          time_in_force: order.ticker.includes('-') ? 'gtc' : 'day', // GTC for crypto
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[Executor] Order rejected: ${error}`);
        order.status = 'rejected';
        this.orders.set(order.id, order);
        return order;
      }

      const result = await response.json() as any;
      // Alpaca returns status like 'new', 'accepted', 'partially_filled', 'filled'
      const alpacaStatus = result.status;
      if (alpacaStatus === 'filled') {
        order.status = 'filled';
        order.filledPrice = parseFloat(result.filled_avg_price) || 0;
        order.filledAt = new Date();
      } else if (alpacaStatus === 'rejected' || alpacaStatus === 'canceled') {
        order.status = 'rejected';
      } else {
        // Order accepted but not yet filled — poll for fill
        order.status = 'pending';
        order.filledPrice = 0;
        this.pollOrderStatus(order, result.id).catch(() => {});
      }

      eventBus.emit('trade:executed', {
        ticker: order.ticker,
        shares: order.quantity,
        price: order.filledPrice,
        side: order.side,
      });

      this.orders.set(order.id, order);
      return order;
    } catch (error) {
      console.error('[Executor] Execution error:', error);
      order.status = 'rejected';
      this.orders.set(order.id, order);
      return order;
    }
  }

  private async pollOrderStatus(order: TradeOrder, alpacaOrderId: string, retries = 10): Promise<void> {
    for (let i = 0; i < retries; i++) {
      await new Promise(r => setTimeout(r, 2000)); // wait 2s between polls
      try {
        const resp = await fetch(`${this.config.baseUrl}/v2/orders/${alpacaOrderId}`, {
          headers: {
            'APCA-API-KEY-ID': this.config.apiKey,
            'APCA-API-SECRET-KEY': this.config.apiSecret,
          },
        });
        if (!resp.ok) continue;
        const data = await resp.json() as any;
        if (data.status === 'filled') {
          order.status = 'filled';
          order.filledPrice = parseFloat(data.filled_avg_price) || 0;
          order.filledAt = new Date();
          eventBus.emit('trade:executed', {
            ticker: order.ticker,
            shares: order.quantity,
            price: order.filledPrice,
            side: order.side,
          });
          this.orders.set(order.id, order);
          return;
        } else if (data.status === 'canceled' || data.status === 'rejected' || data.status === 'expired') {
          order.status = 'rejected';
          this.orders.set(order.id, order);
          return;
        }
      } catch { /* retry */ }
    }
    // If still not filled after retries, mark as pending (may fill later)
    console.warn(`[Executor] Order ${alpacaOrderId} not filled after ${retries} polls — leaving as pending`);
  }

  async getPositions(): Promise<Position[]> {
    if (!this.config.apiKey || !this.config.apiSecret) return [];

    try {
      const response = await fetch(`${this.config.baseUrl}/v2/positions`, {
        headers: {
          'APCA-API-KEY-ID': this.config.apiKey,
          'APCA-API-SECRET-KEY': this.config.apiSecret,
        },
      });

      if (!response.ok) return [];
      const positions = await response.json() as any[];

      return positions.map((p) => ({
        ticker: p.symbol,
        shares: parseFloat(p.qty),
        avgPrice: parseFloat(p.avg_entry_price),
        currentPrice: parseFloat(p.current_price),
        marketValue: parseFloat(p.market_value),
        unrealizedPnl: parseFloat(p.unrealized_pl),
        unrealizedPnlPercent: parseFloat(p.unrealized_plpc) * 100,
        sector: '',
        category: 'equity' as const,
      }));
    } catch {
      return [];
    }
  }

  async getAccount(): Promise<{
    cash: number;
    portfolioValue: number;
    buyingPower: number;
    equity: number;
    lastEquity: number;
    dayPnl: number;
  } | null> {
    if (!this.config.apiKey || !this.config.apiSecret) return null;

    try {
      const response = await fetch(`${this.config.baseUrl}/v2/account`, {
        headers: {
          'APCA-API-KEY-ID': this.config.apiKey,
          'APCA-API-SECRET-KEY': this.config.apiSecret,
        },
      });

      if (!response.ok) return null;
      const account = await response.json() as any;

      const equity = parseFloat(account.equity);
      const lastEquity = parseFloat(account.last_equity);

      return {
        cash: parseFloat(account.cash),
        portfolioValue: parseFloat(account.portfolio_value),
        buyingPower: parseFloat(account.buying_power),
        equity,
        lastEquity,
        dayPnl: equity - lastEquity,
      };
    } catch {
      return null;
    }
  }

  async getPortfolioHistory(period = '1W', timeframe = '1D'): Promise<{ timestamp: number[]; equity: number[]; profit_loss: number[]; profit_loss_pct: number[] } | null> {
    if (!this.config.apiKey || !this.config.apiSecret) return null;
    try {
      const response = await fetch(`${this.config.baseUrl}/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}&intraday_reporting=market_hours&pnl_reset=per_day`, {
        headers: {
          'APCA-API-KEY-ID': this.config.apiKey,
          'APCA-API-SECRET-KEY': this.config.apiSecret,
        },
      });
      if (!response.ok) return null;
      return await response.json() as any;
    } catch {
      return null;
    }
  }

  getOrders(): TradeOrder[] {
    return Array.from(this.orders.values());
  }
}
