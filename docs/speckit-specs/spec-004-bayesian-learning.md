# SPEC-004: Bayesian Trait Learning & Agent Intelligence

## Summary
Persistent Bayesian learning system (inspired by bar181/savant-ai-results) that tracks performance of every signal, trade, and strategy decision, building quantitative improvement metrics over time.

## Requirements

### R1: Trait Tracking
- Per-ticker traits: signal_accuracy, ticker_behavior, indicator_reliability
- Per-strategy traits: momentum_effectiveness, mean_reversion_effectiveness
- Per-agent traits: decision_quality, timing_accuracy, risk_assessment

### R2: Bayesian Posterior Updates
- Beta distribution with uninformative prior (0.5)
- Pseudo-observations: 5 (prior strength)
- Confidence: asymptotic 1 - 1/(1 + obs × 0.1)
- Trend detection: last 10 posteriors, >±5% threshold

### R3: Agent Intelligence (bar181/fastapi-agents inspired)
- ReACT methodology for agent decision loops
- Persistent memory per agent via RVF containers
- Agent discovery via REST API
- Cross-agent learning: share winning patterns across agent roster

### R4: Quantitative Improvement Dashboard
- Aggregate quality score (target: 56%+ improvement like Savant)
- Trait-by-trait breakdown with trend arrows
- Historical snapshots every 30 minutes
- Win rate, avg return, and Sharpe ratio per strategy

## Tasks
- [x] Build Trait Engine with Beta distribution updates
- [x] Add snapshot history and trend detection
- [x] Expose in Roadmap page UI
- [ ] Wire live trade outcomes to trait updates
- [ ] Add per-strategy trait categories
- [ ] Build cross-agent pattern sharing
- [ ] Implement quantitative improvement dashboard
- [ ] Add agent self-reflection (SAFLA-triggered recalibration)
