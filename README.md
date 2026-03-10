# Autonomous Wealth Builder

Autonomous wealth generation system combining algorithmic trading, real estate acquisition, and multi-agent coordination — multiple streams of income feeding each other.

**Investment Strategy Foundations:**
- **Michael Burry** — Deep value analysis, contrarian conviction, concentrated positions on highest-confidence setups
- **Warren Buffett** — Buy quality at a discount, compound winners, cut losers fast, let the star run
- **Robert Allen** — *Nothing Down* real estate acquisition, *Multiple Streams of Income* cross-pollination between trading profits and real estate capital deployment

**Target:** 100% return in 30 days (paper proving strategy), then real capital deployment.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AWB UI (Next.js 16)                        │
│  Dashboard │ Trading │ Real Estate │ Agents │ Strategy │ Roadmap    │
│  HeroUI + Tailwind CSS 4 │ Three.js 3D Portfolio Globe             │
│  Port 3000                                                          │
└────────────────────────────┬────────────────────────────────────────┘
                             │ REST API
┌────────────────────────────┴────────────────────────────────────────┐
│                     Gateway (Express) — Port 3001                   │
│  Event Bus (EventEmitter3) │ Service Router │ API Layer             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐               │
│  │ MidStream    │  │ Neural      │  │ MinCut       │               │
│  │ Market Data  │  │ Trader      │  │ Portfolio    │               │
│  │ Alpaca API   │  │ 7-Vote      │  │ Optimizer    │               │
│  │ Dynamic Watch│  │ Signal Sys  │  │ Kelly Sizing │               │
│  └─────────────┘  └─────────────┘  └──────────────┘               │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐               │
│  │ Authority   │  │ SAFLA       │  │ QuDAG        │               │
│  │ Matrix      │  │ Oversight   │  │ Witness      │               │
│  │ Governance  │  │ Drift Detect│  │ SHA-256 Chain│               │
│  │ 3-Phase     │  │ Recalibrate │  │ AES-256 Vault│               │
│  └─────────────┘  └─────────────┘  └──────────────┘               │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐               │
│  │ AgentDB     │  │ Bayesian    │  │ Learning     │               │
│  │ Vector Mem  │  │ Intelligence│  │ Engine       │               │
│  │ RuVector    │  │ Cross-Agent │  │ Event-Driven │               │
│  │ HNSW + SONA │  │ Belief Share│  │ Recording    │               │
│  └─────────────┘  └─────────────┘  └──────────────┘               │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐               │
│  │ Strategic   │  │ Analyst     │  │ Autonomy     │               │
│  │ Planner     │  │ Agent       │  │ Engine       │               │
│  │ Goalie GOAP │  │ 24/7 Scanner│  │ OpenClaw     │               │
│  │ A* Planning │  │ Dynamic WL  │  │ Heartbeat    │               │
│  └─────────────┘  └─────────────┘  └──────────────┘               │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐               │
│  │ RVF Engine  │  │ Trait Engine│  │ RE Evaluator │               │
│  │ Versioned   │  │ Bayesian    │  │ Allen Score  │               │
│  │ Containers  │  │ Beta Dist   │  │ Deal Eval    │               │
│  │ SQLite      │  │ Posteriors  │  │ ND Viability │               │
│  └─────────────┘  └─────────────┘  └──────────────┘               │
│                                                                     │
│  ┌──────────────────────────────────────────────────┐              │
│  │ Sublinear Time Solver (WASM)                     │              │
│  │ Neumann Series │ Push │ Hybrid Random Walk       │              │
│  │ O(log n) optimization for deal scoring & alloc   │              │
│  └──────────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

## Intelligence Stack

AWB uses a three-tier intelligence architecture where every agent learns, stores learnings as vectors, and shares them across the system.

### AgentDB (Vector Memory + Self-Learning)

System-wide vector store powered by [AgentDB v3](https://www.npmjs.com/package/agentdb) with [RuVector](https://www.npmjs.com/package/ruvector) HNSW indexing. All agent learnings are stored as vector embeddings in a single `.rvf` file.

| Component | Role |
|-----------|------|
| **ReasoningBank** | Stores proven trading patterns searchable by semantic similarity |
| **ReflexionMemory** | Trade episodes with self-critiques — learns from wins and losses |
| **SkillLibrary** | Auto-promotes high-reward patterns into reusable skills (every 30min) |
| **LearningSystem** | Decision Transformer + 9 RL algorithms for optimal action sequences |
| **SONA** | Micro-LoRA adapter that improves search quality per-agent over time |
| **HNSW Index** | 61-microsecond similarity search across all stored patterns |

```
Agent executes action → outcome stored as episode (ReflexionMemory)
  → successful patterns → ReasoningBank
  → high-reward patterns → SkillLibrary (reusable skills)
  → all experiences → LearningSystem (Decision Transformer training)

Next time ANY agent faces similar situation:
  → queries ReasoningBank for proven approaches
  → queries ReflexionMemory for past wins/failures
  → queries SkillLibrary for reusable skills
  → SONA adapts search quality based on feedback
```

### Bayesian Intelligence (Cross-Agent Belief Sharing)

Real-time shared belief system where all agents contribute outcomes and query priors before acting.

| Domain | What It Tracks |
|--------|---------------|
| **ticker** | Per-ticker win/loss rate from closed trades |
| **indicator** | Which signal types (RSI oversold, MACD cross) are reliable |
| **strategy** | Which exit reasons (stop-loss, take-profit) work best |
| **timing** | Which times/days produce winning trades |
| **market_condition** | Bull/bear/sideways regime detection |

Confidence adjustment: before executing any trade, the system blends the raw signal confidence with Bayesian priors and AgentDB pattern matches.

```
Raw Signal (0.72) → Bayesian Adjustment (ticker prior: 0.85) → Pattern Boost
(AgentDB: proven pattern found) → Final Confidence (0.76) → Execute if >= 0.60
```

### Trait Engine (Per-Ticker Bayesian Modeling)

```
Prior:      Beta(0.5, 0.5) — uninformative
Update:     posterior = (successes + prior * 5) / (observations + 5)
Confidence: 1 - 1/(1 + observations * 0.1)
Trend:      Last 10 posteriors — improving (>+5%), degrading (>-5%), stable
Snapshots:  Every 30 minutes with aggregate quality score
```

## Neural Trading System (7-Vote Signal Engine)

The Neural Trader uses a multi-confirmation signal system. All 7 indicators must agree at 60%+ before a signal fires.

| Vote | Indicator | Buy Signal | Sell/Short Signal |
|------|-----------|-----------|-------------------|
| 1 | **RSI** | < 25 (oversold) or recovering from < 30 | > 75 (overbought) or falling from > 70 |
| 2 | **MACD** | Bullish crossover or bullish momentum | Bearish crossunder or bearish momentum |
| 3 | **Bollinger Bands** | Lower extreme (< 5%) or bounce from lower | Upper extreme (> 95%) or rejection from upper |
| 4 | **EMA Stack** | Bullish alignment (9 > 21 > 50) | Bearish alignment (9 < 21 < 50) |
| 5 | **Momentum** | Strong 5-bar momentum (> 2%) + positive 10-bar | Weak 5-bar (< -2%) + negative 10-bar |
| 6 | **Mean Reversion** | Oversold bounce (20-bar drawdown > 4%, recovering) | Overextended reversal (20-bar run > 10%, rolling) |
| 7 | **ruv-FANN Neural** | LSTM+GRU ensemble predicts UP with model agreement | LSTM+GRU ensemble predicts DOWN with model agreement |

Additional gates:
- **Confidence floor:** 60% minimum (4+ of 7 indicators confirming)
- **Confirmation count:** 3+ distinct confirmations required
- **Expected value check:** Reward/risk ratio must be >= 1.5:1
- **Concentration limit:** Max 4 positions per asset class

### Short Selling

The system supports short selling as a distinct direction from sell:
- **sell** = close an existing long position
- **short** = open a new short position (stocks only, not crypto on Alpaca)

### ruv-FANN Neural Forecast (Vote #7)

Powered by [ruv-swarm](https://www.npmjs.com/package/ruv-swarm) — CPU-native WASM-based neural inference.

- LSTM and GRU models run in parallel on normalized price data
- Models agree = full vote weight (1.0), disagree = reduced weight (0.3)
- Sub-100ms inference per ticker
- Sliding window sequences with ephemeral training

### Dynamic Watchlist (Analyst Agent + News Desk + Research Agent)

The system does NOT use a hardcoded portfolio. Three agents work together to discover opportunities:

**Analyst Agent (deep_scan):**
1. **Alpaca Screener APIs** — most-actives (by trades + volume), top movers (gainers + losers)
2. **Gem Scanner** — 10%+ penny stock breakouts, recent IPOs (VRDN, MANE, OLOX), small-cap momentum
3. **Sector/ETF Universe** — 160+ symbols across all sectors, commodities, metals, inverse ETFs
4. **Crypto Universe** — 18 major pairs on Alpaca
5. **Oversold bounces** — RSI < 32, short candidates RSI > 72
6. **Bayesian prioritization** — deprioritize tickers with low win rates

**News Desk Agent (scan_feeds):**
- 10 RSS feeds: Yahoo Finance (S&P, DJI, Oil, Gold, BTC, VIX), CNBC (Top + Market), Seeking Alpha (Currents + IPOs)
- Extracts tickers from headlines, detects sentiment (bullish/bearish/neutral)
- Auto-adds discovered tickers to watchlist
- Flags high-priority catalysts: IPOs, crashes, surges, geopolitical events

**Research Agent (deep_research):**
- Queries AgentDB ReasoningBank for proven patterns matching current market regime
- Queries ReflexionMemory for past trade episodes (wins + failures)
- Trains GNN model on accumulated pattern outcomes
- Stores news catalysts as searchable patterns for future reference
- Checks GOAP progress against daily return target, adjusts aggression when behind

## Strategic Planner (Goalie GOAP + MinCut)

Goal-Oriented Action Planning with A* pathfinding toward financial objectives.

- Creates phased capital growth trajectories (100% return in 30 days)
- GOAP actions: scan_signals, trade_crypto, trade_stock, take_profit, rebalance, compound, diversify_re, scale_positions
- Evaluates progress vs expected trajectory every heartbeat
- Feasibility scoring based on daily return target, win rate, volatility, capital size
- Mathematical case generator (proves why targets are achievable)

## Core Services

### Trading Module

| Service | Purpose | Key Algorithms |
|---------|---------|---------------|
| **MidStream** | Live market data from Alpaca (stocks + crypto) | IEX feed, real-time streaming, dynamic watchlist |
| **Neural Trader** | 7-vote technical + neural signal generation | RSI, MACD, BB, EMA, momentum, mean reversion, LSTM+GRU |
| **MinCut** | Portfolio optimization | Kelly criterion, correlation analysis, position sizing |
| **Trade Executor** | Order execution via Alpaca | Market/limit orders, position tracking, short selling |
| **Position Manager** | Stop-loss, take-profit, circuit breaker | Rule-based exits, PnL tracking, daily loss limits |
| **Analyst Agent** | 24/7 dynamic opportunity discovery | Alpaca screener APIs, oversold/overbought scanning |
| **Strategic Planner** | Outcome-based goal planning | Goalie GOAP + A* pathfinding + MinCut Kelly sizing |

### Governance Module

| Service | Purpose | Key Features |
|---------|---------|-------------|
| **Authority Matrix** | Three-phase decision routing | Paper → Real Initial → Real Full thresholds |
| **SAFLA** | Meta-cognitive oversight | Strategy drift detection (0.3 threshold), recalibration |
| **QuDAG Witness** | Tamper-proof audit trail | SHA-256 hash chain, AES-256-GCM credential vault |

### Intelligence Module

| Service | Purpose | Approach |
|---------|---------|---------|
| **AgentDB** | System-wide vector memory | RuVector HNSW, ReasoningBank, ReflexionMemory, SkillLibrary, SONA |
| **Bayesian Intelligence** | Cross-agent belief sharing | Beta-distribution posteriors across 5 domains, confidence adjustment |
| **Trait Engine** | Per-ticker Bayesian modeling | Beta posteriors, trend detection, 30-min snapshots |
| **Learning Engine** | Event-driven recording | Captures signals, trades, risk alerts, decisions, drift events |
| **RVF Engine** | Versioned container storage | Knowledge, roadmap, learning, property, strategy containers |

### Real Estate Module

| Service | Purpose | Allen Techniques |
|---------|---------|-----------------|
| **RE Evaluator** | Deal scoring & analysis | Cap rate, DSCR, cash-on-cash, Nothing Down viability |
| **Property Scout** | Listing aggregation | MLS, FSBO, foreclosures, auctions |
| **Deal Analyst** | Financial underwriting | NOI, debt service, Kelly allocation |
| **Offer Strategist** | Creative term design | Seller financing, lease options, subject-to, wraps |
| **Owner Outreach** | Seller acquisition | Direct outreach, motivated seller ads, follow-up automation |
| **RE Compliance** | Due diligence | Title, liens, zoning, Thurston County records |
| **RE Portfolio Mgr** | Allocation optimizer | MinCut Kelly for RE, reinvestment threshold monitoring |

### Optimization Layer

| Service | Purpose | Complexity |
|---------|---------|-----------|
| **Sublinear Time Solver** | WASM-accelerated optimization | O(log n) via Johnson-Lindenstrauss |
| Neumann Series | Iterative matrix solving | O(k·nnz) |
| Forward/Backward Push | Sparse graph traversal | O(1/ε) |
| Hybrid Random Walk | Monte Carlo for large systems | O(√n/ε) |

## Agent Roster

### Trading & Intelligence Agents (14)
- **Neural Trader** — 7-vote signal generation (6 classical + 1 neural)
- **MinCut Optimizer** — Portfolio optimization, Kelly sizing, strategy evaluation
- **SAFLA** — Risk oversight and drift monitoring
- **MidStream** — Real-time market data ingestion, dynamic watchlist
- **QuDAG Witness** — Audit chain and credential management
- **Authority Matrix** — Governance threshold enforcement
- **Trait Learner** — Bayesian learning from trade outcomes
- **Bayesian Intelligence** — Cross-agent shared belief synchronization
- **Analyst Agent** — 24/7 opportunity scanner (260+ tickers, penny stocks, IPOs, gems)
- **News Desk Agent** — RSS feed intelligence (Yahoo Finance, CNBC, Seeking Alpha)
- **Research Agent** — AgentDB-powered autonomous research, GNN training, GOAP tracking
- **Strategic Planner** — Goalie GOAP goal-oriented planning
- **ruv-FANN (ruv-swarm)** — LSTM+GRU neural price forecasting
- **Autonomy Engine** — OpenClaw 2-minute heartbeat orchestration

### Real Estate Agents (6) — "Platoon of Robert Allens"
- **Property Scout** — Listing scanner for Olympia/Tumwater WA
- **Deal Analyst** — Underwriting with Allen scoring
- **Offer Strategist** — Nothing Down term sheet design
- **Owner Outreach** — Direct seller acquisition + ad campaigns
- **RE Compliance** — Title/lien/zoning verification
- **RE Portfolio Mgr** — Kelly-based allocation and reinvestment timing

## Robert Allen Strategy Framework

### Three Money Mountains
1. **Real Estate** — Rental properties via Nothing Down techniques
2. **Investment** — Algorithmic paper trading → real capital
3. **Marketing** — Revenue through info products and consulting

### Nothing Down Techniques (12)
Seller financing, lease option, subject-to, wraparound mortgage, hard money + refi, partner split, blanket mortgage, contract for deed, equity sharing, option assignment, master lease, and government programs.

### 5-Phase Reinvestment Strategy
1. **Foundation** — Paper trading, system calibration
2. **Capital Building** — Proven trading strategies, profit accumulation
3. **First Property** — Deploy trading profits into RE via creative financing
4. **Portfolio Growth** — Multiple streams, diversified income
5. **Financial Fortress** — Self-sustaining wealth machine

## Autonomy System (OpenClaw-style)

Heartbeat-driven autonomous operations with three levels:
- **Observe** — Monitor only, no autonomous actions
- **Suggest** — Generate signals and queue for approval
- **Act** — Execute within Authority Matrix thresholds

Features: configurable heartbeat interval (1min–1hr), crypto 24/7 (no night mode), per-agent enable/disable, activity feed logging.

Heartbeat: 2 minutes during market hours. Every cycle runs all 12 agents in sequence.

### Registered Heartbeat Actions (12)
1. `neural-trader:scan_signals` — Scan and execute trades with Bayesian-adjusted confidence
2. `neural-trader:check_exits` — Stop-loss, take-profit, circuit breaker checks
3. `midstream-feed:refresh_quotes` — Market data health check
4. `safla-oversight:check_drift` — Strategy drift monitoring
5. `trait-learner:snapshot_traits` — Bayesian trait snapshots
6. `authority-matrix:check_pending` — Pending decision alerts
7. `qudag-witness:verify_chain` — Witness chain integrity verification
8. `mincut-optimizer:evaluate_strategy` — GOAP progress evaluation
9. `analyst-agent:deep_scan` — Dynamic opportunity discovery (260+ tickers, penny stocks, IPOs, gems)
10. `news-desk:scan_feeds` — RSS intelligence from Yahoo Finance, CNBC, Seeking Alpha (10 feeds)
11. `bayesian-intel:sync_intelligence` — Cross-agent learning sync + RVF persistence
12. `research-agent:deep_research` — AgentDB ReasoningBank queries, GNN training, GOAP progress tracking

## Real Estate Pipeline — Olympia/Tumwater WA

Target market: Thurston County, WA (Olympia, Tumwater, Lacey)

**Market Benchmarks:**
- Median home price: $450K
- Median rent: $1,800/mo
- Target cap rate: >8%
- Target cash-on-cash: >12%
- Target DSCR: >1.25
- Property tax: ~1.05%

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, HeroUI, Tailwind CSS 4, Three.js/R3F |
| Backend | Express gateway, TypeScript, EventEmitter3 |
| Vector Store | AgentDB v3 (RuVector HNSW, SONA, .rvf format) |
| Storage | SQLite (RVF containers, witness chain) |
| Broker | Alpaca Markets (paper + live trading) |
| Neural | ruv-swarm (LSTM, GRU — CPU-native WASM) |
| Planning | Goalie GOAP (A* pathfinding, STRIPS-style) |
| Optimization | sublinear-time-solver (Rust/WASM) |
| Security | AES-256-GCM vault, SHA-256 witness chain, scrypt KDF |
| AI | Claude API for query processing |

## API Endpoints

### Intelligence
- `GET /api/intelligence` — Cross-agent collective intelligence summary
- `GET /api/intelligence/beliefs` — All Bayesian beliefs (filterable by domain)
- `GET /api/intelligence/ticker/:ticker` — Bayesian prior for a ticker
- `GET /api/intelligence/top-performers` — Best performing tickers by win rate
- `GET /api/intelligence/worst-performers` — Worst performing (avoid/short)
- `GET /api/intelligence/timing` — Best trading times
- `GET /api/memory/stats` — AgentDB memory statistics
- `GET /api/memory/patterns` — Query ReasoningBank for proven patterns
- `GET /api/memory/episodes` — Query ReflexionMemory for past trades
- `GET /api/memory/skills` — Query SkillLibrary for reusable skills

### Trading
- `GET /api/signals` — Active and historical signals
- `POST /api/signals/scan` — Trigger manual signal scan
- `GET /api/signals/diagnose` — Raw indicator scores for all tickers

### Strategy
- `POST /api/strategy/plan` — Create GOAP strategy plan
- `GET /api/strategy/current` — Current active strategy
- `GET /api/strategy/progress` — Progress vs expected trajectory
- `GET /api/strategy/case` — Mathematical feasibility case

## Running

```bash
# Gateway (port 3001)
cd services && npx tsx gateway/src/server.ts

# UI (port 3000)
cd mtwm-ui && npm run dev
```

## Project Structure

```
mtwm/
├── services/
│   ├── gateway/src/          # Express API gateway + autonomy engine
│   ├── midstream/src/        # Market data (Alpaca) + dynamic watchlist
│   ├── neural-trader/src/    # 7-vote signal engine + neural forecast + executor
│   ├── mincut/src/           # Portfolio optimizer + strategic planner (GOAP)
│   ├── authority-matrix/src/ # Governance + risk controls
│   ├── safla/src/            # Strategy drift detection
│   ├── qudag/src/            # Witness chain + credential vault
│   ├── rvf-engine/src/       # Container storage + knowledge + learning + traits
│   ├── realestate/src/       # Property evaluator + RE agent roster
│   └── shared/
│       ├── types/            # Shared TypeScript interfaces
│       ├── crypto/           # SHA-256, AES-256 utilities
│       ├── utils/            # Event bus
│       └── intelligence/     # BayesianIntelligence + AgentDB memory layer
├── mtwm-ui/
│   ├── app/                  # Pages: dashboard, trading, realestate, agents, etc.
│   ├── components/           # HeroUI components, Three.js portfolio globe
│   ├── stores/               # Zustand state management
│   └── lib/                  # Utilities, formatters, RuVector client
├── docs/
│   ├── playbooks/            # Gekko-Buffett Expansion, Commodities Expansion
│   ├── initial-specs/        # Original AWB Spec v6
│   ├── prompts/              # Setup prompts
│   └── ROADMAP.md            # Future roadmap (6 phases)
├── speckit-specs/            # Generated specifications (constitution, trading, RE, optimization, etc.)
└── README.md
```
