export interface InfraAsset {
  symbol: string;
  name: string;
  type: 'futures' | 'stock' | 'etf';
  category: 'copper' | 'uranium' | 'natgas' | 'rare_earth' | 'power';
  thesis: string;
  correlation: string[];
}

export interface AICapexEvent {
  company: string;
  amount: number; // USD billions
  announcementDate: Date;
  focus: string;
  impactedAssets: string[];
}

export interface SupplyChainSignal {
  category: string;
  trigger: string;
  confidence: number;
  assets: string[];
  direction: 'long' | 'short';
  rationale: string;
  timestamp: Date;
}
