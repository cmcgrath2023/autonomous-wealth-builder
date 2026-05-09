#!/bin/bash
# AWB pre-open healthcheck — run via cron at 9:25 AM ET weekdays
# Verifies all critical systems are up before market open

set -euo pipefail

API="http://127.0.0.1:3001/api/status"
DISCORD_WEBHOOK="${DISCORD_WEBHOOK_URL:-}"

check() {
  local name="$1" url="$2"
  if curl -sf --max-time 5 "$url" > /dev/null 2>&1; then
    echo "OK: $name"
    return 0
  else
    echo "FAIL: $name"
    return 1
  fi
}

fails=0

# 1. API server
check "API Server" "$API" || ((fails++))

# 2. Trident
check "Trident" "https://trident.cetaceanlabs.com/v1/health" || ((fails++))

# 3. Docker containers running
containers=$(docker compose -f /opt/awb/deploy/do/docker-compose.yml ps --status running -q 2>/dev/null | wc -l)
if [ "$containers" -ge 1 ]; then
  echo "OK: Docker ($containers containers)"
else
  echo "FAIL: Docker (no containers running)"
  ((fails++))
fi

# 4. Disk space (>1GB free)
avail=$(df /opt/awb/data | tail -1 | awk '{print $4}')
if [ "$avail" -gt 1048576 ]; then
  echo "OK: Disk ($(( avail / 1048576 ))GB free)"
else
  echo "WARN: Disk low ($(( avail / 1024 ))MB free)"
fi

# Report
if [ $fails -gt 0 ]; then
  msg="⚠️ AWB Pre-Open Check: $fails failures detected"
  echo "$msg"
  if [ -n "$DISCORD_WEBHOOK" ]; then
    curl -sf -X POST "$DISCORD_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"$msg\"}" > /dev/null 2>&1 || true
  fi
  exit 1
else
  echo "All systems GO for market open"
  exit 0
fi
