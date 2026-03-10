# SPEC-009: OpenClaw Expansion — Multi-Service Autonomy

## Summary
Integrate GlobalStream, CommoditiesTrader, and DataCenterInfra into the OpenClaw autonomy engine with heartbeat management, night mode, and per-agent autonomy levels (observe/suggest/act).

## Requirements

### R1: Agent Registration
- Register expansion services as OpenClaw agents with independent configurations:
  - GlobalStream: `observe` mode, 60s heartbeat
  - CommoditiesTrader: `suggest` mode, 300s heartbeat
  - DataCenterInfra: `observe` mode, 900s heartbeat
- Each agent tracked with id, name, service reference, autonomy level, heartbeat interval, enabled flag, last heartbeat timestamp

### R2: Autonomy Level Enforcement
- **Observe**: Read-only — service monitors and logs, no signals emitted upstream
- **Suggest**: Signals route to `pendingApproval` queue for human review
- **Act**: Signals auto-execute through Authority Matrix → trade execution
- Runtime level changes via API: `POST /openclaw/expansion/autonomy/:agentId`

### R3: Night Mode
- Configurable night window (default 22:00-06:00 UTC)
- Night heartbeat interval: 300s (5 min) regardless of per-agent setting
- Night mode env vars: `OPENCLAW_NIGHT_MODE_START`, `OPENCLAW_NIGHT_MODE_END`, `OPENCLAW_NIGHT_HEARTBEAT`

### R4: Event Routing
- GlobalStream quotes → pass through to consumers
- CommoditiesTrader signals → route through autonomy level gate
- DataCenterInfra signals → route through autonomy level gate
- All heartbeats aggregated to `agentHeartbeat` events

### R5: Lifecycle Management
- `startAll()` / `stopAll()` for bulk lifecycle control
- Individual agent enable/disable
- Status endpoint: `GET /openclaw/expansion/status`

## Technical Plan

### New Files
- `services/gateway/src/openclaw-expansion.ts` — Agent registration, heartbeat management, event routing

### Modified Files
- `services/gateway/src/server.ts` — Import and initialize expansion module

## Tasks
- [ ] Create openclaw-expansion.ts with agent registration
- [ ] Implement autonomy level routing (observe/suggest/act)
- [ ] Implement night mode heartbeat slowdown
- [ ] Wire all 3 expansion services into event handlers
- [ ] Add gateway routes for status and autonomy control
- [ ] Test autonomy level transitions
- [ ] Test night mode heartbeat behavior
