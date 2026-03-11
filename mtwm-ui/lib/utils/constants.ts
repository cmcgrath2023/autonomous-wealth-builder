export const MODULE_COLORS: Record<string, string> = {
  trading: '#3b82f6',
  realestate: '#10b981',
  business: '#f59e0b',
  alternatives: '#8b5cf6',
};

export const CATEGORY_COLORS: Record<string, string> = {
  equity: '#3b82f6',
  real_estate: '#10b981',
  crypto: '#f59e0b',
  cash: '#6b7280',
  alternative: '#8b5cf6',
};

export const STATUS_COLORS: Record<string, string> = {
  healthy: '#22c55e',
  active: '#22c55e',
  idle: '#6b7280',
  warning: '#eab308',
  error: '#ef4444',
  critical: '#ef4444',
};

export const AUTHORITY_THRESHOLDS = {
  autonomous: 10_000,
  notifyOwner: 50_000,
  requireApproval: Infinity,
};

export const RISK_LIMITS = {
  maxDrawdown: 0.15,
  kellyFraction: 0.5,
  maxSectorConcentration: 0.25,
  correlationAlert: 0.8,
  emergencyReserveMonths: 12,
};

export const REFRESH_INTERVALS = {
  portfolio: 30_000,
  modules: 30_000,
  decisions: 10_000,
  system: 15_000,
};
