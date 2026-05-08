# AWB DigitalOcean Runtime Bundle

This directory contains the files needed to run AWB on a DigitalOcean droplet.

## Files

- `docker-compose.yml` runs `awb-services` and `awb-ui` from DOCR.
- `awb-stack.service` keeps the compose stack alive through reboot and process failure.
- `runtime.env.example` lists the runtime secrets and overrides the droplet needs.

## Target Host

- Image: Ubuntu 24.04 LTS
- Registry: `registry.digitalocean.com/oceanic`
- Services image: `awb-services`
- UI image: `awb-ui`

## Runtime Steps

1. Provision a droplet.
2. Install Docker and Docker Compose.
3. Place this directory at `/opt/awb/deploy/do`.
4. Copy `runtime.env.example` to `/opt/awb/.env.runtime` and fill in secrets.
5. Enable `awb-stack.service`.
6. Verify `/api/system/status`, Alpaca positions, and broker stop orders.

## Notes

- AWB should run exactly one `awb-services` instance.
- The gateway lock file is still enforced inside the container.
- Broker stops survive host sleep or reboot; the heartbeat does not.
- Cron is optional and should only be used as a health-check guardrail.
