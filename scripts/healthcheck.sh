#!/bin/bash
# MTWM Health Check — monitors UI (3000), Gateway (3001), Tunnel, Forex, Autonomy
# Called every 60s by launchd: com.mtwm.healthcheck
# FIXED: checks HTTP response codes, not just port listeners
# 307 redirects from auth middleware count as ALIVE

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/Users/cmcgrath"

LOG="/tmp/mtwm-healthcheck.log"
FAIL_FILE="/tmp/mtwm-ui-fail-count"
GW_FAIL_FILE="/tmp/mtwm-gw-fail-count"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"; }
tail -500 "$LOG" > "$LOG.tmp" 2>/dev/null; mv "$LOG.tmp" "$LOG" 2>/dev/null

# Returns HTTP status code, "000" means no connection at all
http_code() {
  /usr/bin/curl -s -o /dev/null -w "%{http_code}" --max-time "${2:-10}" "$1" 2>/dev/null
}

# ---- UI (port 3000) ----
# Any HTTP response (200, 307, 404, etc.) means Next.js is alive
# Only "000" (connection refused/timeout) means actually down
UI_CODE=$(http_code "http://localhost:3000")
if [ "$UI_CODE" = "000" ] || [ -z "$UI_CODE" ]; then
  FAILS=$(cat "$FAIL_FILE" 2>/dev/null || echo 0)
  FAILS=$((FAILS + 1))
  echo "$FAILS" > "$FAIL_FILE"
  if [ "$FAILS" -ge 3 ]; then
    log "UI DOWN ($FAILS consecutive failures, last code=$UI_CODE) — restarting"
    rm -f /Users/cmcgrath/Documents/mtwm/mtwm-ui/.next/dev/lock
    /usr/bin/pkill -f "next dev" 2>/dev/null
    sleep 2
    cd /Users/cmcgrath/Documents/mtwm/mtwm-ui
    nohup /opt/homebrew/bin/npm run dev > /tmp/mtwm-ui.log 2>&1 &
    sleep 12
    UI_VERIFY=$(http_code "http://localhost:3000")
    [ "$UI_VERIFY" != "000" ] && [ -n "$UI_VERIFY" ] && log "UI RESTORED (HTTP $UI_VERIFY)" || log "UI still starting..."
    echo "0" > "$FAIL_FILE"
  else
    log "UI WARN — fail $FAILS/3 (code=$UI_CODE, waiting before restart)"
  fi
else
  echo "0" > "$FAIL_FILE"
  log "UI OK (HTTP $UI_CODE)"
fi

# ---- Gateway (port 3001) ----
GW_CODE=$(http_code "http://localhost:3001/api/status")
if [ "$GW_CODE" = "000" ] || [ -z "$GW_CODE" ]; then
  GW_FAILS=$(cat "$GW_FAIL_FILE" 2>/dev/null || echo 0)
  GW_FAILS=$((GW_FAILS + 1))
  echo "$GW_FAILS" > "$GW_FAIL_FILE"
  if [ "$GW_FAILS" -ge 2 ]; then
    log "GATEWAY DOWN ($GW_FAILS failures, last code=$GW_CODE) — restarting"
    /usr/sbin/lsof -ti:3001 | /usr/bin/xargs kill 2>/dev/null
    sleep 3
    /usr/sbin/lsof -ti:3001 | /usr/bin/xargs kill -9 2>/dev/null
    sleep 1
    cd /Users/cmcgrath/Documents/mtwm/services
    # Source env so Trident/Brain keys are available (dotenv doesn't always override)
    set -a; source /Users/cmcgrath/Documents/mtwm/services/gateway/.env.local 2>/dev/null; set +a
    nohup /opt/homebrew/bin/node --import tsx/esm gateway-v2/src/index.ts >> /tmp/mtwm-gateway.log 2>&1 &
    sleep 15
    GW_VERIFY=$(http_code "http://localhost:3001/api/status")
    [ "$GW_VERIFY" != "000" ] && [ -n "$GW_VERIFY" ] && log "GATEWAY RESTORED (HTTP $GW_VERIFY)" || log "GATEWAY STARTING"
    echo "0" > "$GW_FAIL_FILE"
  else
    log "GATEWAY WARN — fail $GW_FAILS/2 (code=$GW_CODE)"
  fi
else
  echo "0" > "$GW_FAIL_FILE"
  log "GATEWAY OK"
fi

# ---- Autonomy ----
AUTO=$(/usr/bin/curl -sf --max-time 5 http://localhost:3001/api/autonomy/status 2>/dev/null)
if echo "$AUTO" | /usr/bin/grep -q '"enabled":false'; then
  log "AUTONOMY OFF — toggling on"
  /usr/bin/curl -sf -X POST http://localhost:3001/api/autonomy/toggle >/dev/null 2>&1
  log "AUTONOMY TOGGLED"
else
  log "AUTONOMY OK"
fi

# ---- Cloudflare Tunnel ----
if ! /usr/bin/pgrep -x cloudflared >/dev/null 2>&1; then
  log "TUNNEL DOWN — restarting"
  nohup /opt/homebrew/bin/cloudflared tunnel run mtwm > /tmp/mtwm-tunnel.log 2>&1 &
  sleep 5
  /usr/bin/pgrep -x cloudflared >/dev/null 2>&1 && log "TUNNEL RESTORED" || log "TUNNEL FAILED"
else
  log "TUNNEL OK"
fi

# ---- Forex Service (port 3003) ----
FX_CODE=$(http_code "http://localhost:3003/api/forex/health" 5)
if [ "$FX_CODE" = "000" ] || [ -z "$FX_CODE" ]; then
  log "FOREX SERVICE DOWN — restarting"
  cd /Users/cmcgrath/Documents/mtwm/services
  nohup /opt/homebrew/bin/node --import tsx/esm forex-scanner/src/server.ts >> /tmp/mtwm-forex-service.log 2>&1 &
  sleep 3
  FX_VERIFY=$(http_code "http://localhost:3003/api/forex/health" 5)
  [ "$FX_VERIFY" != "000" ] && [ -n "$FX_VERIFY" ] && log "FOREX SERVICE RESTORED" || log "FOREX SERVICE STARTING"
else
  log "FOREX SERVICE OK"
fi
