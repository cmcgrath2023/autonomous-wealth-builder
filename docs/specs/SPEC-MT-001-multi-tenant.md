# SPEC-MT-001: Multi-Tenant Autonomous Trading Platform

## Overview

Transform MTWM from a single-user self-hosted trading system into a hosted multi-tenant SaaS platform where users sign up, connect their own brokerage accounts, and run autonomous trading powered by shared intelligence.

## Business Model

| Tier | Model | Support | Description |
|------|-------|---------|-------------|
| **Free** | Self-hosted (open source) | Community (Discord, GitHub Issues) | User clones repo, runs locally, configures own keys |
| **Hosted** ($29-49/mo) | Multi-tenant SaaS | In-app guidance, self-healing | 3-day free trial. Sign up, enter API keys, go |
| **Pro** (future) | Isolated container | Priority | Dedicated instance, custom config, SLA |

## Architecture

### Current State (Single Tenant)
```
[UI :3000] → [Gateway :3001] → [Alpaca API]
                             → [OANDA API]
                             → [Forex Service :3003]
```
- All state in-memory (positions, Bayesian beliefs, research stars, research reports)
- Single .env file with one set of broker credentials
- One autonomy engine, one neural trader, one news-desk

### Target State (Multi-Tenant)
```
[UI :3000] → [Auth/Tenant Router] → [Gateway :3001] → [Broker APIs]
                                                     → [Forex Service :3003]
                    ↓
              [Tenant DB]  ← credentials, config, state
                    ↓
              [Shared Services]  ← news-desk, research, market data
```

## Tenant Isolation

### Per-Tenant (isolated)
- Broker credentials (Alpaca API key/secret, OANDA API key/account)
- Positions and trade history
- Bayesian intelligence state (beliefs, observations, avoid/prefer lists)
- Research stars and scoring
- Daily goal config and tracking
- Autonomy config (level, heartbeat interval, enabled agents)
- Position manager rules (stop-loss %, TP %, max positions, budget)
- Decision queue and approval history

### Shared (all tenants)
- News-desk RSS feeds and economic calendar
- Market data (midstream quotes, price history)
- Crypto/forex researcher findings (market-level, not trade-level)
- Neural trader model weights (pre-trained, shared baseline)
- FANN forecast models
- UI and frontend code

## Data Layer

### Tenant Database
Replace in-memory state with a persistent store. Options:
- **SQLite per tenant** (simplest — each tenant gets a .db file)
- **PostgreSQL with tenant_id column** (scalable, standard)
- **Supabase** (hosted Postgres + auth + realtime — already familiar)

### Schema (core tables)
```sql
-- Tenants
tenants (id, email, name, tier, trial_ends_at, subscription_status, created_at)

-- Credentials (encrypted)
tenant_credentials (tenant_id, broker, encrypted_key, encrypted_secret, account_id, mode)

-- Trading Config
tenant_config (tenant_id, simulated_capital, max_positions, crypto_pct, equity_pct,
               stop_loss_pct, take_profit_pct, daily_goal, autonomy_level, heartbeat_ms)

-- Bayesian State
tenant_beliefs (tenant_id, belief_id, domain, subject, alpha, beta, observations,
                avg_return, tags, updated_at)

-- Trade History
tenant_trades (tenant_id, ticker, direction, entry_price, exit_price, qty, pnl,
               opened_at, closed_at, reason, strategy)

-- Research Reports (tenant-scoped strategy/results, shared findings)
tenant_reports (tenant_id, agent, type, summary, strategy_action, strategy_result,
                timestamp)
```

## Authentication & Onboarding

### Sign-Up Flow
1. User provides email + password → create tenant
2. Choose tier (free trial starts automatically for hosted)
3. **Connect Alpaca**: Enter API key + secret, select paper/live
4. **Connect OANDA** (optional): Enter API key + account ID
5. **Configure Strategy**: Set capital, risk level, daily goal, crypto/equity split
6. **Activate**: System starts autonomy engine for this tenant

### Auth Implementation
- JWT tokens with tenant_id claim
- Middleware extracts tenant_id from token on every request
- All gateway operations scoped to tenant: `executor.getPositions(tenantId)`

## Gateway Changes

### Tenant-Aware Services
Every service that currently holds state in memory needs tenant scoping:

```typescript
// Before (single tenant)
const bayesianIntel = new BayesianIntelligence();
const researchStars = new Map();

// After (multi-tenant)
const tenantServices = new Map<string, {
  bayesianIntel: BayesianIntelligence;
  researchStars: Map<string, ResearchStar>;
  positionManager: PositionManager;
  adaptiveState: AdaptiveState;
  executor: TradeExecutor;  // configured with tenant's broker keys
}>();

function getTenantServices(tenantId: string) {
  if (!tenantServices.has(tenantId)) {
    // Initialize from database
    tenantServices.set(tenantId, createTenantServices(tenantId));
  }
  return tenantServices.get(tenantId);
}
```

### Heartbeat per Tenant
The autonomy engine runs one heartbeat loop that iterates over active tenants:

```typescript
async function runHeartbeat() {
  const activeTenants = await db.getActiveTenants();
  for (const tenant of activeTenants) {
    const services = getTenantServices(tenant.id);
    await runTenantActions(tenant, services);
  }
}
```

### Shared vs Tenant Actions
| Action | Scope | Runs |
|--------|-------|------|
| news-desk:scan_feeds | Shared | Once per heartbeat |
| crypto-researcher:deep_scan | Shared | Once per heartbeat |
| forex-researcher:analyze_sessions | Shared | Once per heartbeat |
| midstream-feed:refresh_quotes | Shared | Once per heartbeat |
| neural-trader:scan_signals | Per tenant | For each active tenant |
| neural-trader:check_exits | Per tenant | For each active tenant |
| forex-scanner:manage_positions | Per tenant | For each active tenant |
| forex-scanner:execute_forex | Per tenant | For each active tenant |
| bayesian-intel:sync_intelligence | Per tenant | For each active tenant |

## Billing Integration

### Stripe
- Stripe Checkout for sign-up
- Stripe Billing for recurring subscriptions
- Webhook to update tenant subscription_status
- Grace period: 3 days past due before suspending autonomy

### Trial Logic
```typescript
function canTrade(tenant: Tenant): boolean {
  if (tenant.tier === 'free') return false; // self-hosted only
  if (tenant.subscription_status === 'active') return true;
  if (tenant.trial_ends_at && new Date() < tenant.trial_ends_at) return true;
  return false;
}
```

## UI Changes

### New Pages
- `/signup` — registration + tier selection
- `/onboard` — broker connection wizard (step-by-step)
- `/settings` — manage credentials, strategy config, subscription
- `/billing` — plan management, invoices

### Existing Pages (tenant-scoped)
All existing pages work as-is but data is scoped to the logged-in tenant. The auth middleware already exists — just needs to carry tenant_id.

## Security

- Broker credentials encrypted at rest (AES-256, key from tenant password or KMS)
- Tenant data isolation enforced at query level (every DB query includes tenant_id)
- Rate limiting per tenant (prevent one tenant from consuming all resources)
- API keys never logged or exposed in research reports
- Credential vault (qudag) scoped per tenant

## Infrastructure

### Hosted Tier
- **Compute**: Single server running gateway + UI (start simple)
- **Database**: PostgreSQL (Supabase or self-hosted)
- **Domain**: Separate from private instance
- **SSL**: Cloudflare or Let's Encrypt
- **Monitoring**: Healthcheck per tenant, alert on failures

### Scaling Path
- 1-10 tenants: Single process, in-memory tenant services
- 10-50 tenants: Worker processes per tenant group
- 50+: Kubernetes with tenant pods (Pro tier = dedicated pod)

## Implementation Phases

### Phase 2a: Foundation (1-2 weeks)
- [ ] Tenant database schema + migrations
- [ ] Auth system (signup, login, JWT with tenant_id)
- [ ] Credential storage (encrypted)
- [ ] Onboarding wizard UI

### Phase 2b: Tenant Isolation (1-2 weeks)
- [ ] Scope gateway services per tenant
- [ ] Tenant-aware heartbeat loop
- [ ] Per-tenant Bayesian state persistence
- [ ] Per-tenant position manager and config

### Phase 2c: Billing (1 week)
- [ ] Stripe integration (checkout, subscriptions, webhooks)
- [ ] Trial logic and expiration
- [ ] Billing UI page

### Phase 2d: Polish (1 week)
- [ ] Separate domain setup
- [ ] Monitoring and alerting per tenant
- [ ] Onboarding email flow
- [ ] Landing page

## Open Questions
- Do tenants share the same neural trader model, or does each tenant's model diverge over time?
- Should the free tier include a paper-trading-only hosted option to reduce friction?
- What's the tenant limit per server before we need to scale horizontally?
