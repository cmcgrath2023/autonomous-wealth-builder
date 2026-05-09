#cloud-config
package_update: true
packages:
  - git
  - docker.io
  - docker-compose-plugin

write_files:
  - path: /opt/awb/.env.runtime
    permissions: "0600"
    content: |
      ALPACA_API_KEY=__ALPACA_API_KEY__
      ALPACA_API_SECRET=__ALPACA_API_SECRET__
      ALPACA_MODE=paper
      BRAIN_API_KEY=__BRAIN_API_KEY__
      BRAIN_SERVER_URL=https://trident.cetaceanlabs.com
      DISCORD_WEBHOOK_URL=__DISCORD_WEBHOOK_URL__
      DISCORD_BOT_TOKEN=__DISCORD_BOT_TOKEN__
      DATABASE_URL=__DATABASE_URL__
      AWB_GATEWAY_LOCK_PATH=/app/services/data/awb-gateway.lock
      GATEWAY_DB_PATH=/app/services/data/gateway-state.db
      AWB_SERVICES_TAG=latest
      AWB_UI_TAG=latest

  - path: /etc/systemd/system/awb-stack.service
    permissions: "0644"
    content: |
      [Unit]
      Description=AWB docker compose stack
      After=docker.service network-online.target
      Requires=docker.service

      [Service]
      Type=simple
      WorkingDirectory=/opt/awb
      Environment=COMPOSE_PROJECT_NAME=awb
      Environment=AWB_COMPOSE_FILE=/opt/awb/deploy/do/docker-compose.build.yml
      ExecStart=/bin/sh -lc 'exec /usr/bin/docker compose -f "$AWB_COMPOSE_FILE" up'
      ExecStop=/bin/sh -lc 'exec /usr/bin/docker compose -f "$AWB_COMPOSE_FILE" down'
      Restart=always
      RestartSec=10
      KillMode=control-group
      TimeoutStartSec=0

      [Install]
      WantedBy=multi-user.target

runcmd:
  - systemctl enable docker
  - systemctl start docker
  - mkdir -p /opt/awb /opt/awb/data /opt/awb/logs
  - bash -lc 'if [ -d /opt/awb/.git ]; then cd /opt/awb && git pull --ff-only; else git clone --branch main https://github.com/cmcgrath2023/autonomous-wealth-builder.git /opt/awb; fi'
  - chmod +x /opt/awb/deploy/do/healthcheck.sh /opt/awb/deploy/do/watchdog.sh
  - systemctl daemon-reload
  - systemctl enable --now awb-stack.service
  # Watchdog: restart if API down (every 5 min)
  - echo "*/5 * * * * root /opt/awb/deploy/do/watchdog.sh" > /etc/cron.d/awb-watchdog
  # Pre-open healthcheck: 9:25 AM ET weekdays (13:25 UTC in summer, 14:25 UTC in winter)
  - echo "25 13 * * 1-5 root /opt/awb/deploy/do/healthcheck.sh >> /opt/awb/logs/healthcheck.log 2>&1" > /etc/cron.d/awb-healthcheck
