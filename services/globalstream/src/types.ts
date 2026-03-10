export interface GlobalStreamConfig {
  alpacaKey: string;
  alpacaSecret: string;
  ibkrEnabled: boolean;
  yahooEnabled: boolean;
  heartbeatMs: number;
}

export interface SessionStatus {
  id: string;
  name: string;
  isOpen: boolean;
  nextOpen: Date;
  nextClose: Date;
  instruments: string[];
}

export type DataSourceType = 'alpaca' | 'ibkr' | 'yahoo' | 'crypto';
