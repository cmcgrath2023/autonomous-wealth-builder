# SPEC-GW-002: Gateway Rebuild — Microservice Architecture

## Problem

The current gateway is a single 5,000+ line TypeScript file that:
- Hangs on startup (bootstrap blocks event loop for 30-60s)
- Crashes every few hours (unhandled promises, memory pressure)
- Can't respond to HTTP while heartbeat runs (everything sequential)
- Loses all state on restart (Bayesian beliefs, research stars, trade history)
- One bad action kills the entire system (trading, research, position management)

## Solution

Split into 5 independent processes that communicate via HTTP/IPC. Each can crash and restart without affecting the others.

## Architecture

```
┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│  API Server  │  │  Trade Engine │  │  Research    │
│  (port 3001) │  │  (worker)    │  │  (worker)    │
│              │←→│              │←→│              │
│  HTTP only   │  │  Executes    │  │  News, FACT  │
│  Never blocks│  │  Manages pos │  │  Sectors     │
│  < 50ms resp │  │  Heartbeat   │  │  Bayesian    │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └────────┬────────┘────────┬────────┘
                │                 │
         ┌──────┴───────┐ ┌──────┴───────┐
         │  Data Feed   │ │  State Store │
         │  (worker)    │ │  (SQLite)    │
         │              │ │              │
         │  Midstream   │ │  Beliefs     │
         │  Bootstrap   │ │  Trades      │
         │  Quotes      │ │  Research    │
         └──────────────┘ │  Config      │
                          └──────────────┘
```

## Services

### 1. API Server (port 3001)
- Express HTTP server — ONLY handles HTTP requests
- Never runs long operations — delegates to workers
- Responds in < 50ms for every endpoint
- Proxies to trade engine and research via IPC/HTTP
- Serves: /api/broker/*, /api/positions/*, /api/autonomy/*, /api/research/*, /api/strategy/*

### 2. Trade Engine (worker process)
- Runs the heartbeat loop (120s)
- Executes trades via Alpaca/OANDA APIs
- Position management (stops, TP, trailing)
- Neural trader scan_signals
- Forex scanner
- Communicates results to API server via IPC

### 3. Research Worker (worker process)
- News-desk RSS scanning
- Sector research (energy, defense, metals, AI, crypto)
- FACT cache
- Crypto/forex researchers
- Writes research reports to state store
- Promotes research stars (shared via state store)

### 4. Data Feed (worker process)
- Midstream quote refresh
- Bootstrap ticker data loading (the thing that blocks everything)
- Runs in its own process so it NEVER blocks HTTP or trading
- Feeds price data to state store

### 5. State Store (SQLite)
- Persistent — survives restarts
- Bayesian beliefs with decay (old data loses weight)
- Research stars and reports
- Closed trade history
- Configuration
- Replaces all in-memory Maps that reset on crash

## Implementation Plan

### Phase 1: State Store (prevents data loss on crash)
- Move Bayesian beliefs to SQLite
- Move research stars to SQLite
- Move closed trades to SQLite
- Add belief decay (observations older than 7 days lose 50% weight)

### Phase 2: Separate Data Feed
- Extract bootstrap and midstream into a child process
- API server starts instantly, data loads in background
- Quote data written to shared state

### Phase 3: Separate Trade Engine
- Extract heartbeat, neural trader, position manager, forex scanner
- Runs as worker_threads or child_process
- API server proxies trade requests

### Phase 4: Separate Research
- Extract news-desk, sector research, researchers
- FACT cache in its own process
- Writes to shared state store

## Key Principles

1. **API server never blocks** — every request < 50ms
2. **Workers can crash independently** — trade engine crashing doesn't kill API
3. **State persists** — SQLite survives any crash
4. **Belief decay** — old bad data can't permanently block trading
5. **Health monitoring** — each worker reports health, auto-restart on failure
