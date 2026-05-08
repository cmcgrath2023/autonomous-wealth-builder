#!/bin/bash
# MTWM Gateway Watchdog — runs via cron every 5 min
# If gateway is dead, restart it

LOGFILE="/tmp/mtwm-watchdog.log"
GATEWAY_DIR="/Users/cmcgrath/Documents/mtwm/services"

if ! pgrep -f "gateway-v2/src/index.ts" > /dev/null 2>&1; then
    echo "$(date): Gateway dead — restarting" >> $LOGFILE
    cd $GATEWAY_DIR
    nohup /opt/homebrew/bin/node --import tsx/esm gateway-v2/src/index.ts >> /tmp/mtwm-gateway.log 2>&1 &
    echo "$(date): Gateway restarted PID $!" >> $LOGFILE
else
    # Only log every hour to avoid spam
    MINUTE=$(date +%M)
    if [ "$MINUTE" = "00" ]; then
        echo "$(date): Gateway alive" >> $LOGFILE
    fi
fi
