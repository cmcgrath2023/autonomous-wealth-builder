export interface AuthorityRule {
  assetClass: string;
  action: string;
  thresholds: {
    autonomous: number;
    notify: number;
    approve: number;
  };
  conditions: string[];
}

export const EXPANSION_RULES: AuthorityRule[] = [
  // --- Commodity Futures ---
  {
    assetClass: 'commodity_futures',
    action: 'single_trade',
    thresholds: { autonomous: 5_000, notify: 25_000, approve: Infinity },
    conditions: [],
  },
  {
    assetClass: 'commodity_futures',
    action: 'spread_trade',
    thresholds: { autonomous: 10_000, notify: 50_000, approve: Infinity },
    conditions: [],
  },
  {
    assetClass: 'commodity_futures',
    action: 'physical_delivery',
    thresholds: { autonomous: 0, notify: 0, approve: 0 },
    conditions: ['always_approve'],
  },

  // --- Forex ---
  {
    assetClass: 'forex',
    action: 'single_trade',
    thresholds: { autonomous: 10_000, notify: 50_000, approve: Infinity },
    conditions: [],
  },
  {
    assetClass: 'forex',
    action: 'carry_trade',
    thresholds: { autonomous: 5_000, notify: 25_000, approve: Infinity },
    conditions: [],
  },

  // --- Options ---
  {
    assetClass: 'options',
    action: 'covered_call',
    thresholds: { autonomous: 5_000, notify: 25_000, approve: Infinity },
    conditions: [],
  },
  {
    assetClass: 'options',
    action: 'cash_secured_put',
    thresholds: { autonomous: 5_000, notify: 25_000, approve: Infinity },
    conditions: [],
  },
  {
    assetClass: 'options',
    action: 'naked_short',
    thresholds: { autonomous: 0, notify: 0, approve: 0 },
    conditions: ['always_approve'],
  },

  // --- Sector Allocation (percentage-based, thresholds < 1.0) ---
  {
    assetClass: 'sector',
    action: 'commodity_allocation',
    thresholds: { autonomous: 0.15, notify: 0.20, approve: 0.25 },
    conditions: [],
  },
  {
    assetClass: 'sector',
    action: 'datacenter_infra_allocation',
    thresholds: { autonomous: 0.20, notify: 0.25, approve: 0.30 },
    conditions: [],
  },
];

export function checkAuthority(
  assetClass: string,
  action: string,
  value: number,
  portfolioValue: number,
): 'autonomous' | 'notify' | 'approve' {
  const rule = EXPANSION_RULES.find(
    (r) => r.assetClass === assetClass && r.action === action,
  );

  if (!rule) {
    return 'approve';
  }

  // Always-approve conditions bypass normal threshold logic
  if (rule.conditions.includes('always_approve')) {
    return 'approve';
  }

  const { autonomous, notify } = rule.thresholds;

  // Percentage-based rules: thresholds are fractions < 1.0
  if (autonomous < 1.0 && notify < 1.0) {
    const ratio = portfolioValue > 0 ? value / portfolioValue : 1;

    if (ratio <= autonomous) {
      return 'autonomous';
    }
    if (ratio <= notify) {
      return 'notify';
    }
    return 'approve';
  }

  // Absolute dollar-value rules
  if (value <= autonomous) {
    return 'autonomous';
  }
  if (value <= notify) {
    return 'notify';
  }
  return 'approve';
}
