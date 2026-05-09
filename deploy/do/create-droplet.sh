#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TPL="$ROOT_DIR/deploy/do/cloud-init.yaml.tpl"
TMP_USER_DATA="$(mktemp /tmp/awb-cloud-init.XXXXXX.yaml)"

cleanup() {
  rm -f "$TMP_USER_DATA"
}
trap cleanup EXIT

GATEWAY_ENV="$ROOT_DIR/services/gateway/.env.local"
if [[ ! -f "$GATEWAY_ENV" ]]; then
  echo "Missing $GATEWAY_ENV" >&2
  exit 1
fi

ALPACA_API_KEY="$(grep -m1 '^ALPACA_API_KEY=' "$GATEWAY_ENV" | cut -d= -f2-)"
ALPACA_API_SECRET="$(grep -m1 '^ALPACA_API_SECRET=' "$GATEWAY_ENV" | cut -d= -f2-)"
BRAIN_API_KEY="$(grep -m1 '^BRAIN_API_KEY=' "$GATEWAY_ENV" | cut -d= -f2-)"
DISCORD_WEBHOOK_URL="$(grep -m1 '^DISCORD_WEBHOOK_URL=' "$ROOT_DIR/services/.env.webhook" 2>/dev/null | cut -d= -f2- || true)"
DISCORD_BOT_TOKEN="$(grep -m1 '^DISCORD_BOT_TOKEN=' "$GATEWAY_ENV" | cut -d= -f2- || true)"
DATABASE_URL="${DATABASE_URL:-postgresql://awb:changeme@postgres:5432/awb_research}"

if [[ -z "${ALPACA_API_KEY:-}" || -z "${ALPACA_API_SECRET:-}" || -z "${BRAIN_API_KEY:-}" ]]; then
  echo "Missing required runtime secrets in gateway/.env.local" >&2
  exit 1
fi

escape_repl() {
  printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
}

escaped_tpl="$(sed \
  -e "s|__ALPACA_API_KEY__|$(escape_repl "$ALPACA_API_KEY")|g" \
  -e "s|__ALPACA_API_SECRET__|$(escape_repl "$ALPACA_API_SECRET")|g" \
  -e "s|__BRAIN_API_KEY__|$(escape_repl "$BRAIN_API_KEY")|g" \
  -e "s|__DISCORD_WEBHOOK_URL__|$(escape_repl "${DISCORD_WEBHOOK_URL:-}")|g" \
  -e "s|__DISCORD_BOT_TOKEN__|$(escape_repl "${DISCORD_BOT_TOKEN:-}")|g" \
  -e "s|__DATABASE_URL__|$(escape_repl "$DATABASE_URL")|g" \
  "$TPL")"

printf '%s\n' "$escaped_tpl" > "$TMP_USER_DATA"

DROPLET_NAME="${1:-awb-runtime}"

doctl compute droplet create "$DROPLET_NAME" \
  --region nyc3 \
  --size s-1vcpu-1gb \
  --image ubuntu-24-04-x64 \
  --ssh-keys 54977285,53032936 \
  --tag-name awb \
  --enable-monitoring \
  --user-data-file "$TMP_USER_DATA" \
  --wait
