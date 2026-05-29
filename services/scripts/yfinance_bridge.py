#!/usr/bin/env python3
"""Small JSON bridge around yfinance for gateway-v2 deep research."""

from __future__ import annotations

import json
import sys
from typing import Any

try:
    import yfinance as yf
except Exception as exc:  # pragma: no cover - runtime dependency guard
    print(json.dumps({"ok": False, "error": f"yfinance import failed: {exc}", "profiles": []}))
    sys.exit(0)


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return str(value)


def _count_recent_revisions(table: Any) -> tuple[int, int]:
    if table is None:
        return 0, 0
    try:
        rows = table.tail(40).to_dict("records")
    except Exception:
        return 0, 0
    upgrades = 0
    downgrades = 0
    for row in rows:
        action = str(row.get("Action") or row.get("action") or "").lower()
        if "up" in action:
            upgrades += 1
        elif "down" in action:
            downgrades += 1
    return upgrades, downgrades


def _profile(symbol: str) -> dict[str, Any]:
    ticker = yf.Ticker(symbol)
    info = ticker.get_info() or {}
    upgrades = downgrades = 0
    try:
        upgrades, downgrades = _count_recent_revisions(ticker.upgrades_downgrades)
    except Exception:
        pass

    return {
        "symbol": symbol,
        "name": _json_safe(info.get("shortName") or info.get("longName") or symbol),
        "sector": _json_safe(info.get("sector")),
        "industry": _json_safe(info.get("industry")),
        "website": _json_safe(info.get("website")),
        "quoteType": _json_safe(info.get("quoteType")),
        "summary": _json_safe(info.get("longBusinessSummary")),
        "marketCap": _json_safe(info.get("marketCap")),
        "avgDailyVolume": _json_safe(info.get("averageVolume") or info.get("averageVolume10days")),
        "currentPrice": _json_safe(info.get("currentPrice") or info.get("regularMarketPrice")),
        "targetMeanPrice": _json_safe(info.get("targetMeanPrice")),
        "targetMedianPrice": _json_safe(info.get("targetMedianPrice")),
        "targetHighPrice": _json_safe(info.get("targetHighPrice")),
        "targetLowPrice": _json_safe(info.get("targetLowPrice")),
        "analystCount": _json_safe(info.get("numberOfAnalystOpinions")),
        "recommendationKey": _json_safe(info.get("recommendationKey")),
        "recommendationMean": _json_safe(info.get("recommendationMean")),
        "revenueGrowth": _json_safe(info.get("revenueGrowth")),
        "profitMargins": _json_safe(info.get("profitMargins")),
        "operatingMargins": _json_safe(info.get("operatingMargins")),
        "returnOnEquity": _json_safe(info.get("returnOnEquity")),
        "debtToEquity": _json_safe(info.get("debtToEquity")),
        "freeCashflow": _json_safe(info.get("freeCashflow")),
        "recentUpgrades": upgrades,
        "recentDowngrades": downgrades,
    }


def main() -> None:
    symbols = [s.strip().upper() for s in sys.argv[1:] if s.strip()]
    if not symbols:
        payload = json.load(sys.stdin)
        symbols = [str(s).strip().upper() for s in payload.get("symbols", []) if str(s).strip()]

    profiles: list[dict[str, Any]] = []
    errors: dict[str, str] = {}
    for symbol in symbols:
        try:
            profiles.append(_profile(symbol))
        except Exception as exc:
            errors[symbol] = str(exc)

    print(json.dumps({"ok": True, "profiles": profiles, "errors": errors}, separators=(",", ":")))


if __name__ == "__main__":
    main()
