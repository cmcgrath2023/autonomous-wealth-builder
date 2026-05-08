# AWB DigitalOcean Container Registry Deployment

AWB deploys as small, separate containers:

- `awb-services`: gateway, deterministic trading engine, workers, API.
- `awb-ui`: Next.js dashboard/control plane.
- External services: Alpaca, Trident/RuVector, CRM, email/SMS providers.

## Required GitHub Secrets

- `DIGITALOCEAN_ACCESS_TOKEN`: token with DOCR read/write access.
- `DOCR_REGISTRY`: registry slug, not full hostname.

Example image path:

```text
registry.digitalocean.com/<DOCR_REGISTRY>/awb-services:latest
```

## Runtime Rules

- Run exactly one `awb-services` instance with trading enabled.
- The gateway enforces a local pid lock at `data/awb-gateway.lock`.
- Trident is consumed as an external service; AWB must continue deterministic trading if Trident is unavailable.
- Do not deploy OpenClaw or research managers as trading authorities.

## Database Direction

- Current: SQLite for gateway transaction state, PostgreSQL for research/enrichment.
- Target: migrate gateway transaction state to PostgreSQL after paper trading is stable.
- Trident/RuVector remains external memory and pattern storage, not the operational ledger.
