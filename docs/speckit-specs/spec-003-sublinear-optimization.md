# SPEC-003: Sublinear Time Solver Integration

## Summary
Integrate ruvnet/sublinear-time-solver (Rust/WASM) for O(log n) optimization across trading signal scoring, portfolio allocation, and real estate deal batch evaluation.

## Requirements

### R1: Signal Batch Scoring
- Use Forward Push algorithm for rapid signal ranking across all tickers
- Rank signals by composite score (confidence × volatility × momentum)
- Sub-millisecond scoring for real-time heartbeat decisions

### R2: Portfolio Allocation
- Replace brute-force Kelly calculation with Neumann Series solver
- Optimize multi-asset allocation with correlation constraints
- Handle 15+ positions with O(log n) complexity

### R3: Real Estate Batch Evaluation
- Score hundreds of property listings simultaneously
- Use Hybrid Random Walk for large-scale deal ranking
- Johnson-Lindenstrauss dimensionality reduction for property feature vectors

### R4: MCP Integration
- Use `npx sublinear-time-solver mcp` for AI-accessible optimization tools
- 40+ MCP tools available for matrix operations
- Flow-Nexus streaming for cost propagation verification

## Tasks
- [x] Install sublinear-time-solver package
- [ ] Create optimization wrapper service
- [ ] Wire into Neural Trader signal scoring
- [ ] Wire into MinCut portfolio optimization
- [ ] Wire into RE Evaluator batch scoring
- [ ] Benchmark: measure speedup vs current brute-force methods
- [ ] Add MCP server integration for Claude query access
