export type DecisionPriority = 'low' | 'normal' | 'high' | 'critical';
export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_executed';

export interface Decision {
  id: string;
  module: string;
  title: string;
  description: string;
  amount?: number;
  priority: DecisionPriority;
  status: DecisionStatus;
  createdAt: Date;
  expiresAt?: Date;
  autoExecute: boolean;
  autoExecuteThreshold?: number;
  rvfId?: string; // RVF container for witness chain
  witnessHash?: string;
}
