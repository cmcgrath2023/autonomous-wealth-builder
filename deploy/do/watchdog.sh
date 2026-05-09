#!/bin/bash
# AWB watchdog — run via cron every 5 minutes
# Restarts the Docker stack if the API is unresponsive

API="http://127.0.0.1:3001/api/status"
COMPOSE_FILE="/opt/awb/deploy/do/docker-compose.yml"
LOG="/opt/awb/logs/watchdog.log"

ts() { date "+%Y-%m-%d %H:%M:%S"; }

if curl -sf --max-time 10 "$API" > /dev/null 2>&1; then
  exit 0
fi

echo "$(ts) API unresponsive — restarting stack" >> "$LOG"
docker compose -f "$COMPOSE_FILE" restart awb-services >> "$LOG" 2>&1
echo "$(ts) Restart triggered" >> "$LOG"
