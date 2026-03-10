# SPEC-008: DataCenterInfra — AI Supply Chain Plays

## Summary
Trade the AI infrastructure supply chain thesis — copper, uranium, natural gas, rare earths, and power utilities correlated with AI/tech capex. 18 assets across 5 categories tracking the physical infrastructure buildout behind the AI revolution.

## Requirements

### R1: Asset Universe
- **Copper** (AI data center demand +72% by 2050): HG futures, FCX, SCCO, COPX ETF
- **Uranium** (nuclear renaissance for AI power): CCJ, CEG, TLN, D, URA ETF
- **Natural Gas** (bridge fuel, +6 bcf/day by 2030): NG futures, LNG, EQT
- **Rare Earth** (semiconductor supply chain): MP, REMX ETF, ALB
- **Power** (data center electricity demand): VST, NEE
- Each asset tracks thesis string and correlation list to related symbols

### R2: AI Capex Event Monitoring
- Ingest AI infrastructure capex announcements (company, amount, focus area)
- Generate signals for events > $10B
- Route to uranium (nuclear/power keywords) or copper (data center keywords)
- Confidence scales with capex size: `amount / 100`, capped at 0.8

### R3: Copper-AI Correlation Strategy
- Track NVDA, MSFT, META, GOOGL average daily change
- When average > 2%: bullish copper signal (HG, FCX, SCCO, COPX), confidence 0.7
- Thesis: AI stock momentum → data center buildout → copper demand

### R4: Nuclear Deal Monitoring
- Aggregate nuclear partnership deals from last 30 days
- Total capex > threshold → uranium sector signal, confidence 0.75
- Track CCJ, CEG, TLN, D, URA as beneficiaries

### R5: Sector Allocation
- Max 20% total portfolio to datacenter infra
- Sub-allocation: copper 35% (7% of portfolio), uranium 30% (6%), natgas 20% (4%), rare earth 10% (2%), power 5% (1%)

### R6: OpenClaw Integration
- Register as OpenClaw agent with `observe` autonomy level
- 15-minute heartbeat interval (longer cycle — thesis-driven, not tick-driven)

## Technical Plan

### New Files
- `services/datacenter-infra/src/index.ts` — Main service class
- `services/datacenter-infra/src/types.ts` — InfraAsset, AICapexEvent, SupplyChainSignal

### Dependencies
- Alpaca Markets API (for stock/ETF quotes)
- Existing MidStream (for real-time price tracking of correlation symbols)

## Tasks
- [ ] Create datacenter-infra service directory and scaffold
- [ ] Define 18 assets across 5 categories with thesis and correlations
- [ ] Implement AI capex event registration and signal generation
- [ ] Implement copper-AI correlation strategy
- [ ] Implement nuclear deal monitoring and aggregation
- [ ] Implement sector allocation calculator
- [ ] Wire into OpenClaw heartbeat system
- [ ] Add gateway routes: GET /infra/assets, /infra/assets/:category, POST /infra/capex-event, GET /infra/allocation/:portfolioValue
- [ ] Create UI page: infrastructure with sector allocation, capex feed, signal list
