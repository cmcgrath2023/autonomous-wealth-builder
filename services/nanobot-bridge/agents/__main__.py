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
    """Daily morning briefing — synthesizes research into actionable plan for today.

    Runs at 7am ET. Produces:
    1. Yesterday's results summary
    2. Overnight news catalysts
    3. Pre-market movers scan
    4. Actionable buy list written to state store for trade engine at 9:35
    """
    import urllib.request
    briefing_parts = [f"MORNING BRIEFING — {datetime.now().strftime('%A %B %d, %Y')}"]
    plan_tickers = []
    plan_reasons = {}

    # 1. Yesterday's portfolio status
    portfolio = market_monitor()
    briefing_parts.append(portfolio.get('summary', 'No portfolio data'))

    # 2. Scan news RSS for catalysts (pre-market)
    catalysts = []
    rss_feeds = [
        'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US',
        'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',
    ]
    for feed_url in rss_feeds:
        try:
            req = urllib.request.Request(feed_url, headers={'User-Agent': 'MTWM/1.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                content = resp.read().decode('utf-8', errors='ignore')
                import re
                titles = re.findall(r'<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>', content)
                for title in titles[:20]:
                    title_lower = title.lower()
                    # Detect actionable catalysts
                    if any(kw in title_lower for kw in ['surge', 'soar', 'jump', 'rally', 'record', 'upgrade', 'beat', 'launch', 'fda', 'approval', 'deal', 'merger', 'acquisition']):
                        catalysts.append(title.strip())
                        # Extract tickers mentioned
                        ticker_matches = re.findall(r'\b([A-Z]{2,5})\b', title)
                        for t in ticker_matches:
                            if t not in ['THE', 'AND', 'FOR', 'INC', 'NEW', 'CEO', 'IPO', 'ETF', 'SEC', 'FED', 'GDP', 'FDA', 'NYSE', 'CNBC']:
                                if t not in plan_tickers:
                                    plan_tickers.append(t)
                                    plan_reasons[t] = f"NEWS: {title.strip()[:80]}"
        except:
            pass

    if catalysts:
        briefing_parts.append(f"CATALYSTS ({len(catalysts)}): {' | '.join(catalysts[:5])}")

    # 3. Query Brain for patterns and historical winners
    brain_url = os.environ.get('BRAIN_SERVER_URL', 'https://brain.oceanicai.io')
    brain_key = os.environ.get('BRAIN_API_KEY', '')
    brain_headers = {'Content-Type': 'application/json'}
    if brain_key:
        brain_headers['Authorization'] = f'Bearer {brain_key}'

    try:
        req = urllib.request.Request(
            f"{brain_url}/v1/memories/search?q=profitable+trade+winner&limit=10",
            headers=brain_headers
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            brain_data = json.loads(resp.read())
            winners = [m for m in (brain_data.get('memories') or brain_data.get('results') or []) if m.get('metadata', {}).get('success')]
            if winners:
                briefing_parts.append(f"BRAIN: {len(winners)} historical winners found")
                for w in winners[:5]:
                    ticker = w.get('metadata', {}).get('ticker')
                    if ticker and ticker not in plan_tickers:
                        plan_tickers.append(ticker)
                        plan_reasons[ticker] = f"BRAIN: historically profitable"
    except:
        briefing_parts.append("BRAIN: unavailable for pattern query")

    # 4. Pre-market movers (Yahoo Finance)
    try:
        req = urllib.request.Request(
            'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=10',
            headers={'User-Agent': 'MTWM/1.0'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            yahoo_data = json.loads(resp.read())
            quotes = yahoo_data.get('finance', {}).get('result', [{}])[0].get('quotes', [])
            for q in quotes[:6]:
                sym = q.get('symbol')
                pct = q.get('regularMarketChangePercent', 0)
                price = q.get('regularMarketPrice', 0)
                if sym and pct > 2 and price > 10 and price < 500 and sym not in plan_tickers:
                    plan_tickers.append(sym)
                    plan_reasons[sym] = f"YAHOO MOVER +{pct:.1f}%"
            if quotes:
                briefing_parts.append(f"PRE-MARKET MOVERS: {', '.join(q.get('symbol','?')+' +'+str(round(q.get('regularMarketChangePercent',0),1))+'%' for q in quotes[:5])}")
    except Exception as e:
        briefing_parts.append(f"Yahoo pre-market: unavailable ({e})")

    # 5. Write actionable plan to state store via gateway API
    morning_plan = {
        "date": datetime.now().strftime('%Y-%m-%d'),
        "tickers": plan_tickers[:6],
        "reasons": plan_reasons,
        "catalysts": catalysts[:5],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        plan_json = json.dumps(morning_plan).encode()
        req = urllib.request.Request(
            'http://localhost:3001/api/strategy/morning-plan',
            data=plan_json,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        urllib.request.urlopen(req, timeout=5)
        briefing_parts.append(f"PLAN: {len(plan_tickers)} tickers queued for 9:35 buy")
    except:
        briefing_parts.append(f"PLAN: {len(plan_tickers)} tickers identified (API write failed, will use movers scanner)")

    # 6. Record to Brain
    try:
        brain_payload = json.dumps({
            "content": " | ".join(briefing_parts),
            "source": "mtwm:morning-briefing",
            "metadata": {"domain": "trading", "type": "morning_plan", "plan": morning_plan}
        }).encode()
        req = urllib.request.Request(f"{brain_url}/v1/memories", data=brain_payload, headers=brain_headers, method='POST')
        urllib.request.urlopen(req, timeout=5)
    except:
        pass

    return {
        "summary": " | ".join(briefing_parts),
        "data": morning_plan,
        "suggestedActions": [{"action": f"BUY {t}", "asset": t, "urgency": "high", "autonomyRequired": "act"} for t in plan_tickers[:6]],
        "requiresEscalation": len(plan_tickers) == 0,
        "escalationReason": "No actionable tickers found for today" if len(plan_tickers) == 0 else None,
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
