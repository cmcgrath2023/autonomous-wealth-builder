export interface RVFContainer {
  id: string;
  version: number;
  type: 'property' | 'strategy' | 'portfolio' | 'decision' | 'agent_config';
  name: string;
  createdAt: Date;
  updatedAt: Date;
  witnessHash: string;
  parentHash?: string;
  signature?: string;
  payload: Record<string, unknown>;
  metadata: RVFMetadata;
}

export interface RVFMetadata {
  author: string;
  description: string;
  tags: string[];
  attestations: RVFAttestation[];
}

export interface RVFAttestation {
  timestamp: Date;
  action: string;
  actor: string;
  hash: string;
  previousHash: string;
}

export interface RVFPropertyContainer extends RVFContainer {
  type: 'property';
  payload: {
    address: string;
    purchasePrice: number;
    currentValuation: number;
    cashFlow: number;
    capRate: number;
    occupancy: number;
    documents: string[];
    valuationHistory: { date: Date; value: number }[];
  };
}

export interface RVFStrategyContainer extends RVFContainer {
  type: 'strategy';
  payload: {
    algorithm: string;
    parameters: Record<string, number>;
    backtestResults: { period: string; return: number; sharpe: number; maxDrawdown: number }[];
    activeFrom: Date;
    version: number;
  };
}
