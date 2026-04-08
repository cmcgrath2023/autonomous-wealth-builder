# MTWM — Autonomous Wealth Builder

## Session Start (ALWAYS DO FIRST)

On every new conversation, before doing anything else:
1. Call `mcp__trident__cognitive_status` — check Trident health, LoRA epoch, SONA patterns, drift status
2. Call `mcp__trident__search_knowledge` with query relevant to the user's first message
3. Check memory files in `.claude/projects/-Users-cmcgrath-Documents-mtwm/memory/MEMORY.md` for relevant context
4. State what you found briefly — don't hide it

## Trading Panic Protocol (ALWAYS CHECK BEFORE ANY TRADE)

### Alpaca (US Equities)
- Max 10 positions. Count BEFORE buying.
- Budget: $25K deployed max. Check total deployed BEFORE every order.
- Minimum stock price: $10 — NO penny stocks
- Max 1 buy per ticker per day — NO churn
- Crypto buys: DISABLED (re-enable when market recovers)
- SL dominance >70% → HALT all new entries
- Circuit breaker: -$1,000 daily loss limit

### Buy Gates (all must pass)
1. Anti-churn — not already bought today
2. Session sells — not sold by owner today
3. Brain history — `getTickerHistory()` win/loss check
4. Bayesian posterior — reject <40% win rate (3+ observations)
5. Trident LoRA — `shouldBuy()` reasoning from trained model
6. Position limits + budget

### Exit Logic (3 tiers)
| Tier | SL | TP | Applies To |
|------|-----|------|-----------|
| Crypto | -5% | +10% | BTC, ETH, etc. (when enabled) |
| Standard equity | -7% | +15% | Most stocks |
| Resilient sectors | -10% | +20% | Defense, healthcare, utilities, staples, infrastructure, gold |
- Trident LoRA exit consultation on positions outside neutral zone
- EOD: system-bought equity sold at 3:50 PM ET
- Manual trades: NEVER auto-sold if winning — owner must approve

### Manual Trade Protection
- Positions not bought by the system are detected and flagged as manual
- Manual trades that are winning are KEPT through EOD, exits, and rotations
- Only losing manual trades can be auto-exited
- Persistent `_manualTrades` set survives across heartbeats

### OANDA (Forex)
- Max 4 positions
- Budget: $1K account, 25K units per trade at 25:1 leverage
- 7 pairs: EUR/USD, GBP/USD, USD/JPY, AUD/JPY, NZD/JPY, EUR/GBP, AUD/NZD
- Signals require 3/4 indicators (RSI, EMA, momentum, BB) to agree
- Trident LoRA gates every forex entry
- Bank profits at $50+ per position, cut at -$20

### When Things Go Wrong (STOP → ASSESS → ACT)
1. **STOP** — Do NOT place more trades to "fix" the situation
2. **ASSESS** — Count positions, total deployed vs budget, SL dominance, intelligence state
3. **ACT** — Cut worst losers FIRST to get within budget. Only then consider new entries.

### NEVER
- Buy stocks under $10
- Buy the same ticker twice in one day
- Buy crypto (currently disabled)
- Exceed budget "because we have buying power"
- Sell winners to fund speculative losers
- Sell manual trades that are profitable without owner approval
- Buy without checking position count and budget first

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## File Organization

- NEVER save to root folder — use the directories below
- Use `/src` for source code files
- Use `/tests` for test files
- Use `/docs` for documentation and markdown files
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- Use `/examples` for example code

## Project Architecture

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Project Config

- **Topology**: hierarchical-mesh
- **Max Agents**: 15
- **Memory**: hybrid
- **HNSW**: Enabled
- **Neural**: Enabled

## Build & Test

```bash
# Build
npm run build

# Test
npm test

# Lint
npm run lint
```

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal
- Run `npx @claude-flow/cli@latest security scan` after security-related changes

## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- Use Claude Code's Task tool for spawning agents, not just MCP
- ALWAYS batch ALL todos in ONE TodoWrite call (5-10+ minimum)
- ALWAYS spawn ALL agents in ONE message with full instructions via Task tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL Bash commands in ONE message

## Swarm Orchestration

- MUST initialize the swarm using CLI tools when starting complex tasks
- MUST spawn concurrent agents using Claude Code's Task tool
- Never use CLI tools alone for execution — Task tool agents do the actual work
- MUST call CLI tools AND Task tool in ONE message for complex work

### 3-Tier Model Routing (ADR-026)

| Tier | Handler | Latency | Cost | Use Cases |
|------|---------|---------|------|-----------|
| **1** | Agent Booster (WASM) | <1ms | $0 | Simple transforms (var→const, add types) — Skip LLM |
| **2** | Haiku | ~500ms | $0.0002 | Simple tasks, low complexity (<30%) |
| **3** | Sonnet/Opus | 2-5s | $0.003-0.015 | Complex reasoning, architecture, security (>30%) |

- Always check for `[AGENT_BOOSTER_AVAILABLE]` or `[TASK_MODEL_RECOMMENDATION]` before spawning agents
- Use Edit tool directly when `[AGENT_BOOSTER_AVAILABLE]`

## Swarm Configuration & Anti-Drift

- ALWAYS use hierarchical topology for coding swarms
- Keep maxAgents at 6-8 for tight coordination
- Use specialized strategy for clear role boundaries
- Use `raft` consensus for hive-mind (leader maintains authoritative state)
- Run frequent checkpoints via `post-task` hooks
- Keep shared memory namespace for all agents

```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

## Swarm Execution Rules

- ALWAYS use `run_in_background: true` for all agent Task calls
- ALWAYS put ALL agent Task calls in ONE message for parallel execution
- After spawning, STOP — do NOT add more tool calls or check status
- Never poll TaskOutput or check swarm status — trust agents to return
- When agent results arrive, review ALL results before proceeding

## V3 CLI Commands

### Core Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | 4 | Project initialization |
| `agent` | 8 | Agent lifecycle management |
| `swarm` | 6 | Multi-agent swarm coordination |
| `memory` | 11 | AgentDB memory with HNSW search |
| `task` | 6 | Task creation and lifecycle |
| `session` | 7 | Session state management |
| `hooks` | 17 | Self-learning hooks + 12 workers |
| `hive-mind` | 6 | Byzantine fault-tolerant consensus |

### Quick CLI Examples

```bash
npx @claude-flow/cli@latest init --wizard
npx @claude-flow/cli@latest agent spawn -t coder --name my-coder
npx @claude-flow/cli@latest swarm init --v3-mode
npx @claude-flow/cli@latest memory search --query "authentication patterns"
npx @claude-flow/cli@latest doctor --fix
```

## Available Agents (60+ Types)

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### Specialized
`security-architect`, `security-auditor`, `memory-specialist`, `performance-engineer`

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`

### GitHub & Repository
`pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

### SPARC Methodology
`sparc-coord`, `sparc-coder`, `specification`, `pseudocode`, `architecture`

## Memory Commands Reference

```bash
# Store (REQUIRED: --key, --value; OPTIONAL: --namespace, --ttl, --tags)
npx @claude-flow/cli@latest memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns

# Search (REQUIRED: --query; OPTIONAL: --namespace, --limit, --threshold)
npx @claude-flow/cli@latest memory search --query "authentication patterns"

# List (OPTIONAL: --namespace, --limit)
npx @claude-flow/cli@latest memory list --namespace patterns --limit 10

# Retrieve (REQUIRED: --key; OPTIONAL: --namespace)
npx @claude-flow/cli@latest memory retrieve --key "pattern-auth" --namespace patterns
```

## Quick Setup

```bash
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest
npx @claude-flow/cli@latest daemon start
npx @claude-flow/cli@latest doctor --fix
```

## Claude Code vs CLI Tools

- Claude Code's Task tool handles ALL execution: agents, file ops, code generation, git
- CLI tools handle coordination via Bash: swarm init, memory, hooks, routing
- NEVER use CLI tools as a substitute for Task tool agents

## Support

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues
