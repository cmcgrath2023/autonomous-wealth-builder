# MTWM Roadmap

> See also:
> - [Gekko-Buffett Expansion v7](playbooks/MTWM_Gekko_Buffett_Expansion_v7.md) — 24/7 global coverage, forex, metals, REITs, options, $5K→$15K→$250M+ path
> - [Commodities Expansion v1](playbooks/MTWM_Commodities_Expansion_v1.md) — Agricultural, energy, data center infrastructure, rare earths
> - [Expansion Technical Spec](initial-specs/MTWM_Expansion_Technical_Spec.md) — Full implementation spec for all expansion services

## Current State (March 2026)

### Core System (Operational)
- 10 core services: MidStream, Neural Trader, MinCut, SAFLA, Authority Matrix, Witness Chain, RVF Engine, ruv-swarm, Bayesian Intelligence, AgentDB
- 7-vote neural signal engine with 60% confidence floor
- AgentDB vector memory with ReasoningBank, ReflexionMemory, SkillLibrary, SONA
- Transformer embeddings: `all-MiniLM-L6-v2` (384-dim, local)
- Bayesian Intelligence cross-agent belief sharing
- Goalie GOAP strategic planner ($5K → $15K in 90 days)
- Dynamic watchlist via Alpaca screener APIs (23 symbols)
- Short selling support (stocks)
- Defense/DoD + inverse ETF coverage
- Paper trading account: ~$99K
- Real capital: $5K (not yet deployed)

### Expansion Services (Operational — 7 agents)
- [x] **GlobalStream** — 24/7 international market data (7 sessions: Sydney, Tokyo, HK, London, Frankfurt, NY, Crypto)
- [x] **CommoditiesTrader** — 11 contracts (livestock, grains, energy, metals), cattle-corn spread, hog seasonal
- [x] **DataCenterInfra** — 17 AI supply chain assets, copper-AI correlation, nuclear deal monitoring
- [x] **MetalsTrader** — Gold EMA 20/50 momentum, silver RSI+Bollinger volatility, VIX hedge auto-trigger
- [x] **ForexScanner** — 7 pairs (majors + carry + cross), session momentum, carry trade evaluation
- [x] **REITTrader** — 8 REITs (4 sectors), dividend capture, sector rotation, NAV discount, phase allocation
- [x] **OptionsTrader** — Black-Scholes Greeks, CSPs, covered calls, protective puts, collars, IV rank

### OpenClaw Expansion (Operational)
- [x] All 7 expansion agents registered with autonomy levels (observe/suggest/act)
- [x] Night mode heartbeat management
- [x] Authority Matrix expansion rules (commodity, forex, options, sector allocation)

### AG-UI Protocol (Operational)
- [x] SSE streaming at `/api/ag-ui/stream` — all agent events streamed in real-time
- [x] AG-UI event types: RUN, STEP, TEXT_MESSAGE, TOOL_CALL, STATE, CUSTOM
- [x] Frontend Activity Feed page with real-time event display
- [x] Event wiring: trading signals, trade execution, heartbeats, approvals, state changes

### UI Pages (8 total)
- [x] Dashboard, Trading, Real Estate, Agents, Decisions, Strategy, Roadmap
- [x] Global Markets, Commodities, AI Infrastructure
- [x] Agent Activity (AG-UI real-time feed)

### RE Pipeline (Operational)
- [x] 8 OpenClaw RE tasks with real execution handlers
- [x] Market research, Nothing Down opportunities, property evaluation
- [x] Results storage and display in frontend

---

## Phase 1: Prove Profitability (Current → Week 4)

### P1.1 — Embedding Quality
- [x] Install `@xenova/transformers` for real semantic embeddings in AgentDB
- [x] Replace mock embeddings with `all-MiniLM-L6-v2` (384-dim, runs locally)
- [ ] Enable SONA micro-LoRA adaptation for improving search quality over time

### P1.2 — Stock Data Population
- [ ] Verify defense stocks (LMT, RTX, NOC, GD, BA, LHX) load on market open
- [ ] Verify inverse ETFs (SQQQ, SPXS, UVXY) bootstrap correctly
- [ ] Validate Analyst Agent screener APIs work on current Alpaca plan
- [ ] Fallback: if screener unavailable, use manual top-movers scraping

### P1.3 — Trading Loop Validation
- [ ] Run 2 weeks paper trading with all systems active
- [ ] Verify Bayesian priors adjust confidence correctly
- [ ] Verify AgentDB stores episodes and surfaces proven patterns
- [ ] Track win rate, avg return, Sharpe ratio
- [ ] Target: 55%+ win rate, 1.5:1+ reward/risk, positive PnL

### P1.4 — Position Manager Hardening
- [ ] Wire Trait Engine actual trade outcomes (win rate, avg return) into Kelly sizing
- [ ] Verify circuit breaker trips at -5% daily drawdown
- [ ] Test stop-loss and take-profit execution across crypto + stocks

### P1.5 — Frontend Stability
- [ ] Fix Next.js dev server crashes (recurring issue)
- [x] Improve RE page layout with HeroUI cards
- [ ] Add profitability dashboard (win rate, PnL curve, Sharpe)

### P1.6 — API Key Configuration
- [ ] Configure `COMMODITIES_API_KEY` for CommoditiesTrader
- [ ] Configure `METALS_API_KEY` for MetalsTrader
- [ ] Configure `OANDA_API_KEY` / `OANDA_ACCOUNT_ID` for ForexScanner
- [ ] Evaluate IBKR for futures execution (metals, commodities)

---

## Phase 2: Expand Asset Classes (Weeks 4–8) — COMPLETE

> Full details: [Gekko-Buffett Expansion v7](playbooks/MTWM_Gekko_Buffett_Expansion_v7.md), [Commodities Expansion v1](playbooks/MTWM_Commodities_Expansion_v1.md)

### P2.1 — REITs (REITTrader Service) ✓
- [x] Build `REITTrader` service with 8 REITs across 4 sectors
- [x] Strategies: dividend capture, sector rotation, discount-to-NAV
- [x] Phase allocation: 100% REITs → 25% REITs as physical RE scales up

### P2.2 — Precious Metals (MetalsTrader Service) ✓
- [x] Build `MetalsTrader` service — gold/silver/MGC
- [x] Gold momentum: EMA 20/50 crossover system
- [x] Silver volatility: RSI + Bollinger mean reversion
- [x] Gold hedge: auto-add when VIX > 25 or SPY down > 3% intraday

### P2.3 — Commodities & AI Supply Chain ✓
- [x] CommoditiesTrader: 11 contracts (LE, HE, GF, ZC, ZS, ZW, CL, NG, HG, GC, SI)
- [x] DataCenterInfra: 17 assets (copper, uranium, natgas, rare earth, power)
- [x] Cattle-corn spread, hog seasonal strategies
- [x] Copper-AI correlation, nuclear deal monitoring

### P2.4 — Forex (ForexScanner Service) ✓
- [x] Build `ForexScanner` — 7 pairs (majors, carry, cross)
- [x] Session momentum: London/NY open volatility
- [x] Carry trades: long AUD/JPY, NZD/JPY

### P2.5 — Global Market Coverage (GlobalStream Service) ✓
- [x] Build `GlobalStream` — 7 sessions (Sydney→Tokyo→HK→London→Frankfurt→NY→Crypto)
- [x] Yahoo Finance + Alpaca data sources
- [x] Active session detection with UTC time comparison

### P2.6 — Options (OptionsTrader Service) ✓
- [x] Build `OptionsTrader` — defined-risk only
- [x] Income: cash-secured puts, covered calls
- [x] Hedging: protective puts, collars
- [x] Black-Scholes Greeks calculator, IV rank/percentile

### P2.7 — Fixed Income
- [ ] Treasury ETFs (TLT, SHY, IEF, TIPS)
- [ ] Corporate bond ETFs (LQD, HYG)
- [ ] Rate-sensitive rotation on Fed signals
- [ ] Bond-stock correlation tracking for portfolio hedging

---

## Phase 3: Intelligence Upgrades (Weeks 4–12)

### P3.1 — AG-UI (Agent User Interaction Protocol) ✓
- [x] SSE streaming of all agent events to frontend
- [x] Event types: signals, trades, heartbeats, approvals, state changes
- [x] Activity Feed page with real-time display
- [ ] Interactive approval flows for Authority Matrix decisions (human-in-loop)
- [ ] Agent reasoning chain visualization (show WHY signals fire)

### P3.2 — Transformer Embeddings for AgentDB ✓
- [x] Deploy `all-MiniLM-L6-v2` locally
- [x] Real semantic similarity for pattern matching
- [ ] SONA micro-LoRA training from feedback signals
- [ ] Target: 54% → 90% pattern retrieval accuracy over 10 sessions

### P3.3 — Decision Transformer Training
- [ ] Accumulate 50+ trade episodes
- [ ] Train Decision Transformer on historical action sequences
- [ ] Use for action prediction: "given this market state, what's the optimal action?"
- [ ] Compare DT predictions vs Neural Trader signals — ensemble when both agree

### P3.4 — Causal Memory Graph
- [ ] Enable CausalMemoryGraph in AgentDB
- [ ] Track causal relationships: "this indicator pattern CAUSED this outcome"
- [ ] Doubly robust estimation for intervention analysis

### P3.5 — Federated Learning Across Agents
- [ ] Each agent exports learned LoRA adapters
- [ ] FederatedLearningCoordinator merges with quality filtering (min 0.7)
- [ ] Consolidated model distributed back to all agents

---

## Phase 4: Real Capital Deployment (Weeks 8–12)

### P4.1 — Paper → Real Transition
- [ ] Achieve 55%+ win rate over 100+ trades in paper
- [ ] Achieve positive Sharpe ratio (> 1.0)
- [ ] Pass manual review of all system decisions
- [ ] Switch Authority Matrix to `real_initial` phase
- [ ] Deploy $5K real capital with tightened thresholds

### P4.2 — Risk Management for Real Capital
- [ ] Reduce max position size to 10% of portfolio
- [ ] Reduce daily loss limit to 2%
- [ ] Require 70% confidence floor (up from 60%) for real trades
- [ ] Add pre-trade sanity checks (price staleness, spread width)

### P4.3 — Performance Tracking
- [ ] Daily portfolio snapshots to RVF
- [ ] Weekly performance reports (auto-generated)
- [ ] Drawdown alerts via event bus
- [ ] Target: 3x capital ($5K → $15K) in 90 days

---

## Phase 5: Real Estate Integration (Weeks 12–24)

### P5.1 — First Property Acquisition
- [ ] Calculate reinvestment threshold from trading profits
- [ ] Activate RE agent platoon for Olympia/Tumwater WA
- [ ] Score and rank pipeline deals using Allen evaluation
- [ ] Execute first Nothing Down acquisition

### P5.2 — RE Automation
- [ ] Automated property screening from public listing sources
- [ ] Automated seller outreach campaigns
- [ ] Due diligence checklist automation (title, liens, zoning)
- [ ] Property management integration

### P5.3 — Cross-Asset Optimization
- [ ] MinCut optimization across trading + RE portfolio
- [ ] Kelly sizing for combined asset allocation
- [ ] Cash flow reinvestment routing (trading profits → RE down payments)
- [ ] Tax efficiency awareness (capital gains vs rental income)

---

## Phase 6: Scale & Diversify (Months 6–12)

### P6.1 — Advanced Strategies
- [ ] Pairs trading (long/short correlated assets)
- [ ] Statistical arbitrage across crypto exchanges
- [ ] Calendar spreads (options)
- [ ] Sector rotation based on macro regime

### P6.2 — System Hardening
- [ ] Production deployment (not just local dev)
- [ ] Monitoring and alerting (Prometheus/Grafana or equivalent)
- [ ] Automated testing for trading logic
- [ ] Disaster recovery (backup strategies, failover)

### P6.3 — Marketing Stream (Third Mountain)
- [ ] System performance reports as content
- [ ] Trading insights newsletter
- [ ] Educational content on algorithmic trading + RE
- [ ] Revenue stream from knowledge products

---

## Technical Debt & Maintenance

- [ ] Fix EventBus TypeScript union type errors (pre-existing, non-blocking)
- [ ] Add integration tests for signal → trade → outcome → learning loop
- [ ] Reduce gateway server.ts size (currently 1700+ lines — consider splitting)
- [ ] Add proper error boundaries in Next.js UI
- [ ] Implement proper logging (structured JSON logs vs console.log)
- [ ] Add health check endpoint with dependency status

---

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| agentdb | 3.0.0-alpha.10 | Vector memory, HNSW, ReasoningBank, SONA |
| @xenova/transformers | ^2.x | Real semantic embeddings (all-MiniLM-L6-v2) |
| @ag-ui/core | ^0.0.47 | AG-UI protocol types and event schemas |
| @ag-ui/client | ^0.0.x | AG-UI client SDK |
| ruv-swarm | ^1.0.20 | LSTM/GRU neural forecasting |
| sublinear-time-solver | ^1.5.0 | WASM optimization |
| goalie | (GOAP planner) | Strategic goal planning |
| better-sqlite3 | ^11.x | RVF + AgentDB storage |
| ruvector | ^0.1.99 | HNSW vector indexing (via AgentDB) |
| @ruvector/graph-transformer | ^2.0.4 | Graph intelligence (via AgentDB) |

---

## Speckit Specs (14 total)

| # | Spec | Status |
|---|------|--------|
| 001 | Autonomous Trading System | Active |
| 002 | Real Estate Pipeline | Active |
| 003 | Sublinear Time Solver | Active |
| 004 | Bayesian Learning | Active |
| 005 | Small Capital Strategy | Active |
| 006 | GlobalStream — International Markets | Built |
| 007 | CommoditiesTrader — Ag + Energy | Built |
| 008 | DataCenterInfra — AI Supply Chain | Built |
| 009 | OpenClaw Expansion — Multi-Service | Built |
| 010 | Authority Matrix Expansion | Built |
| 011 | MetalsTrader — Precious Metals | Built |
| 012 | ForexScanner — Currency Pairs | Built |
| 013 | REITTrader — Liquid Real Estate | Built |
| 014 | OptionsTrader — Options | Built |

---

*This roadmap is a living document. Priorities shift based on market conditions, trading performance, and capital availability.*
