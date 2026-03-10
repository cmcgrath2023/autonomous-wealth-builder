# SPEC-002: Real Estate Acquisition Pipeline

## Summary
Autonomous real estate acquisition system for Olympia/Tumwater WA using Robert Allen Nothing Down techniques, powered by 6 specialized agents operating as a "platoon of Robert Allens."

## Requirements

### R1: Market Intelligence
- Target area: Thurston County (Olympia, Tumwater, Lacey)
- Data sources: MLS, FSBO listings, county records, foreclosure auctions
- Sub-market analysis: Olympia (government), Tumwater (industrial), Lacey (JBLM)
- Track: median prices, rent levels, vacancy rates, appreciation trends
- Benchmarks: median $450K, rent $1,800/mo, tax 1.05%, target cap >8%

### R2: Deal Evaluation (RE Evaluator)
- Allen-weighted scoring (cap rate, DSCR, cash-on-cash, Nothing Down viability)
- Nothing Down techniques: seller financing, lease option, subject-to, wraparound, partner split, hard money+refi
- Scoring thresholds: >7/10 = actively pursue, 5-7 = monitor, <5 = pass
- Motivated seller signals: DOM >90, price drops, pre-foreclosure, divorce/estate

### R3: Outreach & Acquisition
- **Motivated seller advertising**: Facebook/Google ads targeting distressed sellers in Thurston County
- **Direct outreach**: Letters to FSBO, expired listings, pre-foreclosure, absentee owners
- **Follow-up automation**: Scheduled touch points, response tracking, conversion metrics
- **Budget control**: Configurable ad spend per channel, Authority Matrix approval for spends >$500

### R4: Agent Roster (6 Agents)
| Agent | Role | Heartbeat Actions |
|-------|------|-------------------|
| Property Scout | Deal sourcer | Scan listings, check foreclosures, track price drops |
| Deal Analyst | Underwriter | Evaluate pipeline, update market benchmarks |
| Offer Strategist | Negotiator | Draft offers, model counteroffers |
| Owner Outreach | Acquisitions | Generate outreach, check responses, schedule follow-ups |
| RE Compliance | Due diligence | Verify active deals, check county records |
| RE Portfolio Mgr | Optimizer | Check reinvestment ready, optimize allocation |

### R5: Reinvestment Bridge
- Monitor trading profits accumulation
- Calculate reinvestment threshold: $10K-25K (creative) or $40K-60K (conventional)
- Auto-trigger property search escalation when threshold approached
- Kelly-based allocation: what % of trading profits to deploy into RE

### R6: Budget & Fund Access
- Per-agent spending budgets (ad spend, outreach costs, due diligence fees)
- Authority Matrix approval for spends above thresholds
- Track ROI per channel (ads vs direct mail vs agent referrals)
- Briefing feed updates on spend and pipeline progress

### R7: Nothing Down Decision Matrix
| Seller Situation | Recommended Technique | Risk | Cash Needed |
|-----------------|----------------------|------|-------------|
| Retiring landlord | Seller financing | Low | $0-5K |
| Pre-foreclosure | Subject-to | Medium | $2-5K |
| FSBO >90 DOM | Lease option | Low | $1-3K |
| Estate/divorce | Below-market purchase | Low | Down payment |
| Absentee owner | Master lease | Low | $0-2K |
| Distressed property | Hard money + refi | Medium | Rehab costs |

## Technical Plan

### New Services
- `realestate/src/evaluator.ts` — Deal scoring engine (done)
- `realestate/src/agent-roster.ts` — Agent definitions (done)
- `realestate/src/property-scout.ts` — Listing scanner (planned)
- `realestate/src/outreach-engine.ts` — Ad campaigns & direct outreach (planned)

### Integration Points
- Sublinear Time Solver: batch property evaluation optimization
- MinCut Kelly: reinvestment allocation sizing
- Authority Matrix: spend approval routing
- Briefing Panel: pipeline progress surfacing
- Witness Chain: all RE decisions audited

## Tasks
- [x] Create RE Evaluator with Allen scoring
- [x] Define 6 RE agent roles
- [x] Build task queue for Olympia/Tumwater
- [x] Add gateway endpoints for pipeline
- [x] Build Real Estate UI page
- [ ] Implement Property Scout listing scraper
- [ ] Build Outreach Engine with ad campaign management
- [ ] Wire budget system with Authority Matrix
- [ ] Add Zillow/Redfin/county records data sources
- [ ] Create offer letter templates (6 Nothing Down variants)
- [ ] Build due diligence checklist automation
- [ ] Integrate reinvestment threshold monitoring with trading P&L
- [ ] Add motivated seller ad campaign framework (Facebook/Google)
- [ ] Surface RE pipeline in dashboard briefing feed
