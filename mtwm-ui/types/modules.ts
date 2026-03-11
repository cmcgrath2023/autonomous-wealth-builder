export type ModuleId = 'trading' | 'realestate' | 'business' | 'alternatives';

export interface ModuleStatus {
  id: ModuleId;
  name: string;
  status: 'active' | 'idle' | 'warning' | 'error';
  allocation: number;
  allocationPercent: number;
  dayPnl: number;
  dayPnlPercent: number;
  activeAgents: number;
  lastAction: string;
  lastActionTime: Date;
  metrics: Record<string, number>;
}
