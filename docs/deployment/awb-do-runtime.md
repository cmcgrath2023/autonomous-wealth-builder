# AWB DigitalOcean Runtime Plan

## Goal

Run AWB on a DigitalOcean droplet so trading, scanning, and learning continue before Pacific-time wake-up, without depending on a local Mac staying awake.

## Recommended Shape

- `awb-services` container on a droplet.
- `awb-ui` container on the same droplet or a separate one if needed later.
- DOCR provides the images.
- `systemd` starts the stack on boot and restarts it if the host reboots.
- A light watchdog checks health and restarts the stack if the process exits.
- Alpaca remains paper-only until AWB is explicitly promoted.
- Trident remains external and is treated as an API dependency, not an internal runtime.

## Why This Shape

Cron is fine for small periodic checks, but it is not the right place to host the trading runtime itself. The runtime should be a long-lived process supervised by the OS. Cron can remain as a backup checker, not as the primary scheduler for AWB.

This keeps the actual market loop alive across:

- machine reboot,
- shell disconnect,
- user logout,
- local laptop sleep,
- transient process exits.

## Boot Flow

1. DigitalOcean boots the droplet.
2. `systemd` starts the AWB container stack.
3. The `awb-services` gateway acquires its singleton lock.
4. The gateway starts trade, research, and monitoring workers.
5. Research crons and the heartbeat continue inside the container.
6. Broker stops survive even if the host later sleeps or restarts.

## Runtime Requirements

- One `awb-services` instance only.
- Paper Alpaca credentials loaded from env or secret store.
- `BRAIN_API_KEY` available to the runtime so notes can still flow to Trident.
- `AWB_GATEWAY_LOCK_PATH` mounted on persistent storage.
- Persistent volume for `data/` so SQLite state survives restarts.
- Health check or watchdog that confirms the gateway is alive.

## Startup Order

1. Load secrets.
2. Start database-backed services.
3. Start `awb-services`.
4. Start `awb-ui`.
5. Verify `/api/system/status` and Alpaca paper health.
6. Only then consider the runtime live.

## Monitoring

Use these as the first-pass checks:

- Gateway process running.
- `worker:trade-engine` marked running in local state.
- Alpaca paper positions readable.
- Broker stop orders present for live positions.
- Trident note path healthy.

If the host process dies, the droplet should restart the stack automatically.

## Practical Recommendation

Use `systemd` for the runtime and cron only for a low-cost guardrail.

Suggested division:

- `systemd`: starts and restarts the AWB stack.
- cron every 5 minutes: calls a watchdog that checks whether the gateway is up and, if not, restarts the stack.
- cron once before market open: optional preflight that validates Alpaca clock, current positions, and open stops.

## Morning Checklist

Before the market opens each day:

- Confirm the droplet is up.
- Confirm `awb-services` is running.
- Confirm the gateway singleton lock exists and belongs to the current process.
- Confirm Alpaca paper positions match local state.
- Confirm open protective stop orders exist.
- Confirm Trident writes are healthy.

## Next Implementation Step

The next concrete artifact should be a small DO runtime bundle:

- `docker-compose.yml` or equivalent launch file.
- `systemd` unit for the stack.
- A droplet watchdog script that restarts the stack if the gateway is missing.
- A pre-open healthcheck script that can be run manually or on a schedule.

That is enough to move AWB from “works on a Mac if awake” to “can operate before Pacific-time wake-up.”
