-- 005: Forex knowledge graph — macro event → currency pair mappings
-- When a geopolitical/macro catalyst fires, the blast radius query
-- needs to know which forex pairs are affected.

-- Forex pairs as "companies" in the knowledge graph
-- This lets company_relationships and mv_relationship_hops work for forex
INSERT INTO companies (symbol, name, sector, industry, exchange, last_updated)
VALUES
  ('EUR/USD', 'Euro / US Dollar', 'Forex', 'Major', 'OANDA', NOW()),
  ('GBP/USD', 'British Pound / US Dollar', 'Forex', 'Major', 'OANDA', NOW()),
  ('USD/JPY', 'US Dollar / Japanese Yen', 'Forex', 'Major', 'OANDA', NOW()),
  ('AUD/JPY', 'Australian Dollar / Japanese Yen', 'Forex', 'Carry', 'OANDA', NOW()),
  ('NZD/JPY', 'New Zealand Dollar / Japanese Yen', 'Forex', 'Carry', 'OANDA', NOW()),
  ('EUR/GBP', 'Euro / British Pound', 'Forex', 'Cross', 'OANDA', NOW()),
  ('AUD/NZD', 'Australian Dollar / New Zealand Dollar', 'Forex', 'Cross', 'OANDA', NOW()),
  ('USD/CAD', 'US Dollar / Canadian Dollar', 'Forex', 'Commodity', 'OANDA', NOW()),
  ('USD/CHF', 'US Dollar / Swiss Franc', 'Forex', 'SafeHaven', 'OANDA', NOW())
ON CONFLICT (symbol) DO NOTHING;

-- Dedicated table for macro-event → forex pair drivers
-- More expressive than company_relationships for forex-specific logic
CREATE TABLE IF NOT EXISTS forex_pair_drivers (
  id SERIAL PRIMARY KEY,
  pair TEXT NOT NULL,               -- 'EUR/USD', 'USD/JPY', etc.
  driver_type TEXT NOT NULL,        -- 'geopolitical'|'rate_differential'|'commodity'|'risk_sentiment'|'trade_policy'
  driver_keyword TEXT NOT NULL,     -- keyword that triggers this mapping
  direction TEXT NOT NULL,          -- 'strengthens_base'|'weakens_base'|'strengthens_quote'|'weakens_quote'|'volatile'
  strength REAL NOT NULL DEFAULT 0.5,
  reasoning TEXT NOT NULL,
  UNIQUE(pair, driver_type, driver_keyword)
);

-- ── Oil / Energy shocks ────────────────────────────────────────────
-- Oil up → USD strengthens (US is net exporter now), JPY weakens (Japan imports all oil),
-- CAD strengthens (oil exporter), AUD weakens (risk-off + import costs)
INSERT INTO forex_pair_drivers (pair, driver_type, driver_keyword, direction, strength, reasoning) VALUES
  ('USD/JPY', 'commodity', 'oil', 'strengthens_base', 0.8, 'Oil spike → JPY weakens (Japan imports 100% oil) → USD/JPY rises'),
  ('USD/JPY', 'geopolitical', 'iran', 'volatile', 0.9, 'Iran tension → oil shock + safe haven flows (JPY) → high volatility'),
  ('USD/JPY', 'geopolitical', 'blockade', 'volatile', 0.9, 'Naval blockade → oil disruption → JPY safe haven vs USD strength'),
  ('USD/CAD', 'commodity', 'oil', 'weakens_base', 0.7, 'Oil spike → CAD strengthens (oil exporter) → USD/CAD drops'),
  ('AUD/JPY', 'commodity', 'oil', 'weakens_base', 0.7, 'Oil spike → risk-off → carry unwind → AUD/JPY drops'),
  ('EUR/USD', 'commodity', 'oil', 'weakens_base', 0.6, 'Oil spike → Europe more dependent on imports → EUR weakens'),
  ('GBP/USD', 'commodity', 'oil', 'weakens_base', 0.5, 'Oil spike → UK import costs rise → mild GBP pressure')
ON CONFLICT DO NOTHING;

INSERT INTO forex_pair_drivers (pair, driver_type, driver_keyword, direction, strength, reasoning) VALUES
  ('EUR/USD', 'rate_differential', 'ecb', 'volatile', 0.8, 'ECB rate decision directly moves EUR/USD'),
  ('EUR/USD', 'rate_differential', 'fed', 'volatile', 0.9, 'Fed rate decision directly moves EUR/USD'),
  ('GBP/USD', 'rate_differential', 'boe', 'volatile', 0.8, 'Bank of England rate decision moves GBP/USD'),
  ('USD/JPY', 'rate_differential', 'boj', 'volatile', 0.9, 'BOJ policy change is seismic for USD/JPY'),
  ('USD/JPY', 'rate_differential', 'fed', 'volatile', 0.8, 'Fed hawkish → USD strengthens → USD/JPY rises'),
  ('AUD/JPY', 'rate_differential', 'rba', 'volatile', 0.7, 'RBA decision affects AUD carry trade'),
  ('NZD/JPY', 'rate_differential', 'rbnz', 'volatile', 0.7, 'RBNZ decision affects NZD carry trade')
ON CONFLICT DO NOTHING;

INSERT INTO forex_pair_drivers (pair, driver_type, driver_keyword, direction, strength, reasoning) VALUES
  ('USD/JPY', 'risk_sentiment', 'war', 'weakens_base', 0.7, 'War/conflict → risk-off → JPY safe haven bid → USD/JPY drops'),
  ('USD/CHF', 'risk_sentiment', 'war', 'weakens_base', 0.7, 'War/conflict → CHF safe haven bid → USD/CHF drops'),
  ('AUD/JPY', 'risk_sentiment', 'risk_off', 'weakens_base', 0.8, 'Risk-off → carry unwind → AUD/JPY drops hard'),
  ('NZD/JPY', 'risk_sentiment', 'risk_off', 'weakens_base', 0.8, 'Risk-off → carry unwind → NZD/JPY drops hard'),
  ('EUR/USD', 'risk_sentiment', 'tariff', 'volatile', 0.6, 'Trade tariffs → uncertain impact, high volatility'),
  ('USD/CAD', 'risk_sentiment', 'tariff', 'volatile', 0.7, 'US-Canada tariffs directly affect USD/CAD'),
  ('AUD/JPY', 'risk_sentiment', 'china', 'volatile', 0.7, 'China news → AUD sensitive (trade partner) → AUD/JPY volatile')
ON CONFLICT DO NOTHING;

INSERT INTO forex_pair_drivers (pair, driver_type, driver_keyword, direction, strength, reasoning) VALUES
  ('USD/JPY', 'trade_policy', 'sanctions', 'strengthens_base', 0.6, 'US sanctions → USD demand for settlement → USD strengthens'),
  ('EUR/USD', 'trade_policy', 'sanctions', 'volatile', 0.5, 'Sanctions → trade disruption → EUR uncertain'),
  ('GBP/USD', 'trade_policy', 'brexit', 'weakens_base', 0.7, 'Brexit trade friction → GBP weakness'),
  ('USD/CAD', 'trade_policy', 'nafta', 'volatile', 0.6, 'USMCA/NAFTA trade policy → USD/CAD sensitive')
ON CONFLICT DO NOTHING;

INSERT INTO forex_pair_drivers (pair, driver_type, driver_keyword, direction, strength, reasoning) VALUES
  ('AUD/NZD', 'commodity', 'iron_ore', 'strengthens_base', 0.6, 'Iron ore price up → AUD strengthens (major exporter)'),
  ('AUD/NZD', 'commodity', 'dairy', 'weakens_base', 0.5, 'Dairy prices up → NZD strengthens → AUD/NZD drops'),
  ('USD/CAD', 'commodity', 'natural_gas', 'weakens_base', 0.5, 'Natgas up → CAD strengthens'),
  ('AUD/JPY', 'commodity', 'gold', 'volatile', 0.5, 'Gold spike often accompanies risk-off → AUD/JPY volatile')
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_fxd_pair ON forex_pair_drivers(pair);
CREATE INDEX IF NOT EXISTS idx_fxd_keyword ON forex_pair_drivers(driver_keyword);
CREATE INDEX IF NOT EXISTS idx_fxd_type ON forex_pair_drivers(driver_type);
