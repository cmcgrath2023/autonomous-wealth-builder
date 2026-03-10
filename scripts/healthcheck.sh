#!/bin/bash
# MTWM Health Check — monitors UI (3000), Gateway (3001), and Cloudflare tunnel
# Runs every 60s via launchd: com.mtwm.healthcheck

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin"
export HOME="/Users/cmcgrath"

LOG="/Users/cmcgrath/Documents/mtwm/logs/healthcheck.log"
mkdir -p "$(dirname "$LOG")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"
}

# Trim log to last 1000 lines to prevent bloat
tail -1000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" 2>/dev/null

# Check and restart Next.js UI on port 3000
check_ui() {
  if ! lsof -i:3000 -t >/dev/null 2>&1; then
    log "UI DOWN on port 3000 — restarting Next.js"
    cd /Users/cmcgrath/Documents/mtwm/mtwm-ui
    nohup npm run dev >> /Users/cmcgrath/Documents/mtwm/logs/ui.log 2>&1 &
    sleep 8
    if lsof -i:3000 -t >/dev/null 2>&1; then
      log "UI RESTORED on port 3000 (PID: $(lsof -i:3000 -t | head -1))"
    else
      log "UI FAILED to restart — check logs/ui.log"
    fi
  fi
}

# Check and restart Gateway on port 3001
check_gateway() {
  if ! lsof -i:3001 -t >/dev/null 2>&1; then
    log "GATEWAY DOWN on port 3001 — restarting"
    cd /Users/cmcgrath/Documents/mtwm/services/gateway
    nohup npx tsx src/server.ts >> /Users/cmcgrath/Documents/mtwm/logs/gateway.log 2>&1 &
    sleep 12
    if lsof -i:3001 -t >/dev/null 2>&1; then
      log "GATEWAY RESTORED on port 3001 (PID: $(lsof -i:3001 -t | head -1))"
    else
      log "GATEWAY FAILED to restart — check logs/gateway.log"
    fi
  fi
}

# Check Cloudflare tunnel (cloudflared)
check_tunnel() {
  if ! pgrep -x cloudflared >/dev/null 2>&1; then
    log "CLOUDFLARE TUNNEL DOWN — restarting"
    nohup cloudflared tunnel run mtwm >> /Users/cmcgrath/Documents/mtwm/logs/tunnel.log 2>&1 &
    sleep 5
    if pgrep -x cloudflared >/dev/null 2>&1; then
      log "TUNNEL RESTORED"
    else
      log "TUNNEL FAILED to restart — check tunnel config"
    fi
  fi
}

check_ui
check_gateway
check_tunnel
