-- 006: Crypto re-enablement — observe mode, relationships, universe

-- Crypto pairs in the knowledge graph
INSERT INTO companies (symbol, name, sector, industry, exchange, last_updated)
VALUES
  ('BTC/USD', 'Bitcoin', 'Crypto', 'Major', 'ALPACA', NOW()),
  ('ETH/USD', 'Ethereum', 'Crypto', 'Major', 'ALPACA', NOW()),
  ('SOL/USD', 'Solana', 'Crypto', 'AltL1', 'ALPACA', NOW()),
  ('AVAX/USD', 'Avalanche', 'Crypto', 'AltL1', 'ALPACA', NOW()),
  ('LINK/USD', 'Chainlink', 'Crypto', 'Infrastructure', 'ALPACA', NOW()),
  ('DOT/USD', 'Polkadot', 'Crypto', 'AltL1', 'ALPACA', NOW()),
  ('DOGE/USD', 'Dogecoin', 'Crypto', 'Meme', 'ALPACA', NOW())
ON CONFLICT (symbol) DO NOTHING;

-- Crypto ↔ equity relationships (blast radius graph)
-- BTC ecosystem
INSERT INTO company_relationships (symbol_a, symbol_b, relationship, strength, evidence, source, discovered_at)
VALUES
  ('BTC/USD', 'MSTR', 'customer', 0.85, 'MicroStrategy BTC treasury holdings', 'crypto_spec', NOW()),
  ('BTC/USD', 'COIN', 'customer', 0.80, 'Coinbase exchange revenue tied to BTC volume', 'crypto_spec', NOW()),
  ('BTC/USD', 'MARA', 'supplier', 0.90, 'Marathon Digital BTC mining', 'crypto_spec', NOW()),
  ('BTC/USD', 'RIOT', 'supplier', 0.85, 'Riot Platforms BTC mining', 'crypto_spec', NOW()),
  ('BTC/USD', 'HUT', 'supplier', 0.75, 'Hut 8 BTC mining', 'crypto_spec', NOW()),
  ('BTC/USD', 'CLSK', 'supplier', 0.70, 'CleanSpark BTC mining', 'crypto_spec', NOW()),
  ('BTC/USD', 'CIFR', 'supplier', 0.65, 'Cipher Mining BTC mining', 'crypto_spec', NOW()),
  ('BTC/USD', 'WULF', 'supplier', 0.65, 'TeraWulf BTC mining', 'crypto_spec', NOW()),
  -- ETH ecosystem
  ('ETH/USD', 'COIN', 'customer', 0.75, 'Coinbase ETH staking + trading', 'crypto_spec', NOW()),
  -- Cross-crypto
  ('BTC/USD', 'ETH/USD', 'sector_peer', 0.70, 'High correlation, ETH follows BTC', 'crypto_spec', NOW()),
  ('BTC/USD', 'SOL/USD', 'sector_peer', 0.60, 'Alt follows BTC with higher beta', 'crypto_spec', NOW()),
  ('ETH/USD', 'SOL/USD', 'competitor', 0.65, 'L1 smart contract competition', 'crypto_spec', NOW()),
  ('BTC/USD', 'DOGE/USD', 'sector_peer', 0.40, 'Meme coin follows BTC loosely', 'crypto_spec', NOW()),
  ('ETH/USD', 'AVAX/USD', 'competitor', 0.55, 'L1 smart contract competition', 'crypto_spec', NOW()),
  ('ETH/USD', 'DOT/USD', 'competitor', 0.50, 'Interoperability competition', 'crypto_spec', NOW()),
  ('ETH/USD', 'LINK/USD', 'partner', 0.60, 'Chainlink oracles power ETH DeFi', 'crypto_spec', NOW())
ON CONFLICT (symbol_a, symbol_b, relationship) DO NOTHING;

-- Crypto ↔ macro correlations
INSERT INTO company_relationships (symbol_a, symbol_b, relationship, strength, evidence, source, discovered_at)
VALUES
  ('BTC/USD', 'GLD', 'sector_peer', 0.40, 'Digital gold narrative, partial correlation', 'crypto_spec', NOW()),
  ('BTC/USD', 'QQQ', 'sector_peer', 0.50, 'Risk-on asset correlation with tech', 'crypto_spec', NOW())
ON CONFLICT (symbol_a, symbol_b, relationship) DO NOTHING;

-- Crypto-specific forex pair drivers (crypto as macro signal)
INSERT INTO forex_pair_drivers (pair, driver_type, driver_keyword, direction, strength, reasoning)
VALUES
  ('USD/JPY', 'risk_sentiment', 'bitcoin', 'volatile', 0.4, 'BTC major move often signals broader risk sentiment shift'),
  ('AUD/JPY', 'risk_sentiment', 'crypto', 'volatile', 0.3, 'Crypto sell-off can trigger broader risk-off including carry unwind')
ON CONFLICT DO NOTHING;
