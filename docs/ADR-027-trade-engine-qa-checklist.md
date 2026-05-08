# ADR-027: Trade Engine QA/QE Checklist

**Status:** ACTIVE — MANDATORY for every trade engine code change
**Date:** 2026-04-23
**Context:** $40K+ paper losses caused by untested code, blind spots, and regressions. Every major loss traces to a failure that a basic checklist would have caught.

---

## Failure Catalog (What This Prevents)

| Date | Loss | Root Cause | Checklist Item That Would Have Caught It |
|------|------|-----------|----------------------------------------|
| 2026-04-10 | -$6,411 | AFJKU SPAC unit, no quality gate | #3 — Verify buy filters on known bad inputs |
| 2026-04-20 | -$1,300+ | EOD fallback sold winning positions | #5 — Trace every sell path end-to-end |
| 2026-04-21 | -$1,742 | Circuit breaker blocked stop loss check | #4 — Verify stop loss fires when CB is tripped |
| 2026-04-21 | -$485 | $100 stop never executed (heartbeat only) | #6 — Verify broker stop order is placed on buy |
| 2026-04-22 | -$656 | AXTI bled past stop between heartbeats | #6 — Broker stop, not polling |
| 2026-04-22 | Missed | RSI-2 scan blocked by circuit breaker | #4 — CB must not block scans, only buys |
| 2026-04-23 | -$6,400 | XNDU held from old engine, no stop placed | #7 — Verify existing positions have stops |
| 2026-04-17 | -$29K cum. | 17 buys in one day, MAX_POSITIONS ignored | #2 — Verify position limit holds across restarts |

---

## PRE-DEPLOY CHECKLIST

Run every item before telling the user "it's deployed" or "it works."

### 1. STATE CHECK — What is the system's current state?

- [ ] Query `trade_engine_status` — is the engine running? What mode?
- [ ] Query `circuit_breaker_*` for today — is it tripped?
- [ ] Query `positions_snapshot` — what positions exist right now?
- [ ] Query `recent_buys_today` — what was bought today?
- [ ] Query `session_sells_today` — what was sold today?
- [ ] Query `sell_attempts` — any failed sells?
- [ ] Query `manual_trades_today` — any manual trade detections?
- [ ] Count open Alpaca positions vs MAX_POSITIONS — are we at limit?

**Command:**
```sql
SELECT key, substr(value, 1, 200) FROM config WHERE key IN (
  'trade_engine_status', 'positions_snapshot', 'recent_buys_today',
  'session_sells_today', 'sell_attempts', 'manual_trades_today',
  'stop_loss_log', 'rsi2_scan', 'orb_scan'
);
SELECT key FROM config WHERE key LIKE 'circuit_breaker_%' AND value='tripped';
```

### 2. POSITION LIMIT — Does MAX_POSITIONS hold?

- [ ] Trace the buy path: where is `MAX_POSITIONS` checked?
- [ ] Does the check re-read positions AFTER any sells in the same heartbeat?
- [ ] If positions are sold externally (by user, by reconciler), does the engine re-fill slots?
- [ ] If yes, is that intended? Does it respect `_sessionSells`?
- [ ] Simulate: engine has 5 positions, user sells 3 manually. Next heartbeat — what happens?

### 3. BUY FILTERS — Will garbage get through?

- [ ] Test with known bad inputs: AFJKU (SPAC unit), BBLGW (warrant), penny stock $3
- [ ] Verify price floor ($10 minimum) is checked
- [ ] Verify SPAC suffix regex catches `/^[A-Z]{2,5}(U|W|WS)$/`
- [ ] For RSI-2: verify RSI(2) < threshold AND price > SMA(200) are both checked
- [ ] For ORB: verify gap range (1-8%) rejects gaps >8%

### 4. CIRCUIT BREAKER — What does it block, what does it NOT block?

- [ ] CB must NOT block: stop loss checks, sell execution, position monitoring, scans
- [ ] CB must block: new buy execution only
- [ ] Verify by reading the code: does the CB `return` early before critical sections?
- [ ] Grep for `circuitBreakerTripped` — every usage must be reviewed
- [ ] If CB is currently tripped, confirm the scan still runs (check `rsi2_scan` date after 3:50 PM)

### 5. SELL PATHS — Trace every path that can close a position

- [ ] List ALL sell paths in the engine (grep for `sellPosition`, `DELETE.*position`, `v2/orders.*sell`)
- [ ] List ALL sell paths outside the engine (Fin, Warren, Ops, reconciler, API server, Discord bot)
- [ ] For each sell path: is the result recorded in `closed_trades`?
- [ ] For each sell path: is the result recorded in `sell_attempts`?
- [ ] For each sell path: does it cancel the broker stop order first?
- [ ] Can any sell path sell a WINNING position without user approval?
- [ ] Simulate: position at +$500 — trace through every sell path. Does it survive?

### 6. BROKER STOP ORDERS — Are they placed on every buy?

- [ ] After `buyPosition` succeeds, is a stop order placed with Alpaca?
- [ ] Verify stop order type: `type: 'stop'`, `side: 'sell'`, `time_in_force: 'gtc'`
- [ ] Verify stop price calculation: is it correct for the strategy? (RSI-2: 5%, ORB: OR low)
- [ ] Query Alpaca for open orders after a buy — does the stop order exist?
- [ ] If buy fills but stop order fails, is the failure logged AND visible (not just console)?
- [ ] Verify: `stop_order_{SYMBOL}` key is written to state store

**Command to verify open stop orders:**
```
curl -s ${ALPACA_BASE}/v2/orders?status=open | python3 -c "import sys,json; [print(f'{o[\"symbol\"]} {o[\"side\"]} {o[\"type\"]} @{o.get(\"stop_price\",\"?\")}') for o in json.load(sys.stdin)]"
```

### 7. EXISTING POSITIONS — Do they have protection?

- [ ] On engine startup, check all existing positions
- [ ] For each position WITHOUT a broker stop order, place one
- [ ] This prevents the XNDU scenario (old position, no stop, bleeds for days)
- [ ] Log every "retrofit stop" to the state store

### 8. COMPILATION + RESTART

- [ ] `npx tsc --noEmit` — zero errors
- [ ] Kill trade engine process, verify it restarts
- [ ] After restart, verify `trade_engine_status` updates within 3 minutes
- [ ] Verify mode is correct (RSI2_CONNORS, not KISS or old mode)
- [ ] Verify heartbeat count resets or increments

### 9. END-TO-END VERIFICATION (after deploy)

- [ ] Wait for one full heartbeat cycle (2 minutes)
- [ ] Check `positions_snapshot` — does the engine see all positions?
- [ ] Check `stop_loss_log` — is it evaluating positions correctly?
- [ ] If near scan time (3:50 PM or 9:48 AM), wait for scan and check `rsi2_scan` or `orb_scan`
- [ ] Check `sell_attempts` — any failed sells?
- [ ] Compare engine's position count with Alpaca's position count — do they match?

### 10. REGRESSION CHECK — Did the change break anything else?

- [ ] Does forex management still run? (check for `[FX]` in logs or forex position changes)
- [ ] Does the reconciler still run? (check `[RECON]` output)
- [ ] Does Trident still receive data? (check brain calls don't error)
- [ ] Does PG still receive theses? (check research_theses table)
- [ ] Does Discord still receive notifications?
- [ ] Are all existing stop orders still in place? (don't accidentally cancel them)

---

## WHEN TO RUN THIS CHECKLIST

1. **Every code change to trade-engine.ts** — full checklist
2. **Every code change to any file that trade-engine imports** — items 3-6, 8-10
3. **Every gateway restart** — items 1, 7, 8, 9
4. **Start of every trading day** — items 1, 4, 7
5. **After any user-reported issue** — full checklist starting with item 1

---

## NON-NEGOTIABLE RULES

1. **Never tell the user "it works" without running items 1, 4, 8, and 9**
2. **Never deploy during market hours without running the full checklist**
3. **Every sell attempt must be persisted to state store, not just console.log**
4. **Every buy must have a broker stop order — no exceptions**
5. **Circuit breaker must never block exits or scans — only new buys**
6. **Existing positions must have stop protection on engine startup**
