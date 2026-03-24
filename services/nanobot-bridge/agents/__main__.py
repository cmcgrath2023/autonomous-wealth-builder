#!/usr/bin/env python3
"""
Nanobot Agent Runner — lightweight sub-agent executor for MTWM/OpenClaw.

Spawned by NanobotBridge as: python3 -m agents --config <path> --task <class> --task-id <id> --once

Outputs JSON to stdout for the bridge to consume.
Each task class has a focused, bounded execution scope.
"""

import argparse
import json
import sys
import os
import time
from datetime import datetime, timezone

def market_monitor():
    """Check market conditions via Alpaca API — runs every 5 min."""
    api_key = os.environ.get('APCA_API_KEY_ID') or os.environ.get('ALPACA_API_KEY', '')
    api_secret = os.environ.get('APCA_API_SECRET_KEY') or os.environ.get('ALPACA_API_SECRET', '')
    base_url = os.environ.get('ALPACA_BASE_URL', 'https://paper-api.alpaca.markets')

    if not api_key or not api_secret:
        return {
            "summary": "No Alpaca credentials — cannot monitor",
            "requiresEscalation": False
        }

    import urllib.request
    headers = {'APCA-API-KEY-ID': api_key, 'APCA-API-SECRET-KEY': api_secret}

    # Check account
    req = urllib.request.Request(f"{base_url}/v2/account", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            acct = json.loads(resp.read())
    except Exception as e:
        return {"summary": f"Account check failed: {e}", "requiresEscalation": True, "escalationReason": str(e)}

    # Check positions
    req2 = urllib.request.Request(f"{base_url}/v2/positions", headers=headers)
    try:
        with urllib.request.urlopen(req2, timeout=10) as resp:
            positions = json.loads(resp.read())
    except Exception:
        positions = []

    equity = float(acct.get('equity', 0))
    last_equity = float(acct.get('last_equity', 0))
    daily_pnl = equity - last_equity
    pos_count = len(positions)

    # Check for danger signals
    escalate = False
    reason = None
    suggested = []

    losers = [p for p in positions if float(p.get('unrealized_pl', 0)) < -50]
    if losers:
        escalate = True
        reason = f"{len(losers)} positions losing >$50"
        for l in losers:
            suggested.append({
                "action": f"CUT {l['symbol']} (${float(l['unrealized_pl']):.2f})",
                "asset": l['symbol'],
                "urgency": "high",
                "autonomyRequired": "suggest"
            })

    if daily_pnl < -500:
        escalate = True
        reason = f"Daily P&L critical: ${daily_pnl:.2f}"

    return {
        "summary": f"Equity ${equity:.0f} | P&L ${daily_pnl:+.2f} | {pos_count} positions",
        "data": {
            "equity": equity,
            "dailyPnl": daily_pnl,
            "positions": pos_count,
            "cash": float(acct.get('cash', 0)),
            "timestamp": datetime.now(timezone.utc).isoformat()
        },
        "suggestedActions": suggested,
        "requiresEscalation": escalate,
        "escalationReason": reason
    }


def forex_alert():
    """Check forex positions via OANDA/forex service — runs every 15 min."""
    try:
        import urllib.request
        req = urllib.request.Request("http://localhost:3003/api/forex/health", method='GET')
        with urllib.request.urlopen(req, timeout=5) as resp:
            health = json.loads(resp.read())

        req2 = urllib.request.Request("http://localhost:3003/api/forex/positions", method='GET')
        with urllib.request.urlopen(req2, timeout=5) as resp:
            data = json.loads(resp.read())
            positions = data.get('positions', [])

        total_pl = sum(float(p.get('pl', 0)) for p in positions)
        return {
            "summary": f"Forex: {len(positions)} positions | P&L ${total_pl:+.2f}",
            "data": {"positions": len(positions), "totalPl": total_pl},
            "requiresEscalation": total_pl < -100,
            "escalationReason": f"Forex losing ${total_pl:.2f}" if total_pl < -100 else None
        }
    except Exception as e:
        return {
            "summary": f"Forex service unreachable: {e}",
            "requiresEscalation": True,
            "escalationReason": f"Forex service down: {e}"
        }


def digital_twin_check():
    """Hourly system health validation — checks all services are responsive."""
    services = {
        "gateway": "http://localhost:3001/api/status",
        "forex": "http://localhost:3003/api/forex/health",
        "ui": "http://localhost:3000",
    }
    results = {}
    down = []

    import urllib.request
    for name, url in services.items():
        try:
            req = urllib.request.Request(url, method='GET')
            with urllib.request.urlopen(req, timeout=10) as resp:
                results[name] = {"status": "up", "code": resp.status}
        except Exception as e:
            results[name] = {"status": "down", "error": str(e)}
            down.append(name)

    return {
        "summary": f"Health: {len(services) - len(down)}/{len(services)} services up" + (f" | DOWN: {', '.join(down)}" if down else ""),
        "data": results,
        "requiresEscalation": len(down) > 0,
        "escalationReason": f"Services down: {', '.join(down)}" if down else None
    }


def briefing_generator():
    """Daily morning briefing — summarizes portfolio, overnight moves, and plan."""
    # This runs at 7am — gather overnight data
    output = market_monitor()
    health = digital_twin_check()
    forex = forex_alert()

    summary_parts = [
        f"MORNING BRIEFING — {datetime.now().strftime('%A %B %d, %Y')}",
        output.get('summary', 'No market data'),
        health.get('summary', 'No health data'),
        forex.get('summary', 'No forex data'),
    ]

    return {
        "summary": " | ".join(summary_parts),
        "data": {
            "market": output.get('data'),
            "health": health.get('data'),
            "forex": forex.get('data'),
        },
        "requiresEscalation": output.get('requiresEscalation', False),
        "escalationReason": output.get('escalationReason'),
    }


TASK_MAP = {
    'market_monitor': market_monitor,
    'forex_alert': forex_alert,
    'digital_twin_check': digital_twin_check,
    'briefing_generator': briefing_generator,
    'compliance_audit': lambda: {"summary": "Audit not implemented", "requiresEscalation": False},
    'template_agent': lambda: {"summary": "Template not implemented", "requiresEscalation": False},
    'reit_scan': lambda: {"summary": "REIT scan not implemented", "requiresEscalation": False},
}


def main():
    parser = argparse.ArgumentParser(description='Nanobot Agent Runner')
    parser.add_argument('--config', required=True, help='Path to task config JSON')
    parser.add_argument('--task', required=True, help='Task class to execute')
    parser.add_argument('--task-id', required=True, help='Unique task ID')
    parser.add_argument('--once', action='store_true', help='Run once and exit')
    args = parser.parse_args()

    task_fn = TASK_MAP.get(args.task)
    if not task_fn:
        print(json.dumps({"summary": f"Unknown task: {args.task}", "requiresEscalation": True, "escalationReason": f"Unknown task class: {args.task}"}))
        sys.exit(1)

    try:
        result = task_fn()
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"summary": f"Task failed: {e}", "requiresEscalation": True, "escalationReason": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
