-- 009: Strategic equity graph seed.
-- Production must have enough graph edges to fan out obvious sympathy trades
-- even before vector embeddings are fully populated.

INSERT INTO companies (symbol, name, sector, industry, sub_industry, exchange, country, last_updated)
VALUES
  ('NVDA', 'NVIDIA Corporation', 'Technology', 'Semiconductors', 'AI semiconductors', 'NASDAQ', 'US', NOW()),
  ('AMD', 'Advanced Micro Devices, Inc.', 'Technology', 'Semiconductors', 'AI semiconductors', 'NASDAQ', 'US', NOW()),
  ('AVGO', 'Broadcom Inc.', 'Technology', 'Semiconductors', 'AI networking and custom silicon', 'NASDAQ', 'US', NOW()),
  ('MU', 'Micron Technology, Inc.', 'Technology', 'Semiconductors', 'Memory semiconductors', 'NASDAQ', 'US', NOW()),
  ('TSM', 'Taiwan Semiconductor Manufacturing Company Limited', 'Technology', 'Semiconductors', 'Foundry', 'NYSE', 'US', NOW()),
  ('ASML', 'ASML Holding N.V.', 'Technology', 'Semiconductor Equipment', 'Lithography', 'NASDAQ', 'US', NOW()),
  ('MRVL', 'Marvell Technology, Inc.', 'Technology', 'Semiconductors', 'AI networking silicon', 'NASDAQ', 'US', NOW()),
  ('QCOM', 'QUALCOMM Incorporated', 'Technology', 'Semiconductors', 'Communications semiconductors', 'NASDAQ', 'US', NOW()),
  ('AMAT', 'Applied Materials, Inc.', 'Technology', 'Semiconductor Equipment', 'Fab equipment', 'NASDAQ', 'US', NOW()),
  ('LRCX', 'Lam Research Corporation', 'Technology', 'Semiconductor Equipment', 'Fab equipment', 'NASDAQ', 'US', NOW()),
  ('KLAC', 'KLA Corporation', 'Technology', 'Semiconductor Equipment', 'Metrology', 'NASDAQ', 'US', NOW()),
  ('INTC', 'Intel Corporation', 'Technology', 'Semiconductors', 'Integrated device manufacturer', 'NASDAQ', 'US', NOW()),
  ('SMCI', 'Super Micro Computer, Inc.', 'Technology', 'AI Infrastructure', 'AI servers', 'NASDAQ', 'US', NOW()),
  ('NOW', 'ServiceNow, Inc.', 'Technology', 'Software', 'Enterprise SaaS', 'NYSE', 'US', NOW()),
  ('CRM', 'Salesforce, Inc.', 'Technology', 'Software', 'Enterprise SaaS', 'NYSE', 'US', NOW()),
  ('ORCL', 'Oracle Corporation', 'Technology', 'Software', 'Cloud and database', 'NYSE', 'US', NOW()),
  ('ADBE', 'Adobe Inc.', 'Technology', 'Software', 'Creative software', 'NASDAQ', 'US', NOW()),
  ('WMT', 'Walmart Inc.', 'Consumer Staples', 'Retail', 'Big box retail', 'NYSE', 'US', NOW()),
  ('COST', 'Costco Wholesale Corporation', 'Consumer Staples', 'Retail', 'Warehouse retail', 'NASDAQ', 'US', NOW()),
  ('TGT', 'Target Corporation', 'Consumer Staples', 'Retail', 'Big box retail', 'NYSE', 'US', NOW()),
  ('SBUX', 'Starbucks Corporation', 'Consumer Discretionary', 'Restaurants', 'Coffee retail', 'NASDAQ', 'US', NOW()),
  ('DIS', 'The Walt Disney Company', 'Communication Services', 'Entertainment', 'Media and parks', 'NYSE', 'US', NOW())
ON CONFLICT (symbol) DO UPDATE SET
  name = EXCLUDED.name,
  sector = EXCLUDED.sector,
  industry = EXCLUDED.industry,
  sub_industry = EXCLUDED.sub_industry,
  exchange = EXCLUDED.exchange,
  country = EXCLUDED.country,
  last_updated = NOW();

WITH edges(symbol_a, symbol_b, relationship, strength, evidence, source) AS (
  VALUES
    ('MU', 'AVGO', 'sector_peer', 0.78, 'Memory and AI silicon move together during semiconductor momentum regimes', 'strategic_graph_seed'),
    ('MU', 'NVDA', 'sector_peer', 0.74, 'AI accelerator demand drives memory/HBM sympathy moves', 'strategic_graph_seed'),
    ('MU', 'AMD', 'sector_peer', 0.70, 'Semiconductor risk-on sympathy basket', 'strategic_graph_seed'),
    ('MU', 'TSM', 'sector_peer', 0.65, 'Advanced semiconductor manufacturing demand linkage', 'strategic_graph_seed'),
    ('MU', 'ASML', 'sector_peer', 0.60, 'Fab cycle and semiconductor capex linkage', 'strategic_graph_seed'),
    ('MU', 'MRVL', 'sector_peer', 0.66, 'AI infrastructure silicon sympathy basket', 'strategic_graph_seed'),
    ('AVGO', 'NVDA', 'sector_peer', 0.82, 'AI infrastructure leaders with datacenter chip exposure', 'strategic_graph_seed'),
    ('AVGO', 'MRVL', 'competitor', 0.78, 'Custom silicon and networking chip competition', 'strategic_graph_seed'),
    ('NVDA', 'SMCI', 'partner', 0.80, 'Supermicro builds NVIDIA GPU servers', 'strategic_graph_seed'),
    ('TSM', 'NVDA', 'supplier', 0.90, 'TSMC fabs NVIDIA GPUs', 'strategic_graph_seed'),
    ('TSM', 'AMD', 'supplier', 0.86, 'TSMC fabs AMD CPUs/GPUs', 'strategic_graph_seed'),
    ('TSM', 'AVGO', 'supplier', 0.80, 'TSMC fabs Broadcom silicon', 'strategic_graph_seed'),
    ('ASML', 'TSM', 'supplier', 0.90, 'ASML EUV lithography is critical to TSMC advanced nodes', 'strategic_graph_seed'),
    ('AMAT', 'TSM', 'supplier', 0.76, 'Applied Materials fab equipment for TSMC', 'strategic_graph_seed'),
    ('LRCX', 'TSM', 'supplier', 0.76, 'Lam Research fab equipment for TSMC', 'strategic_graph_seed'),
    ('KLAC', 'TSM', 'supplier', 0.72, 'KLA metrology equipment for TSMC', 'strategic_graph_seed'),
    ('NOW', 'CRM', 'sector_peer', 0.68, 'Enterprise SaaS peer group', 'strategic_graph_seed'),
    ('NOW', 'ORCL', 'sector_peer', 0.58, 'Enterprise software and workflow/cloud peer group', 'strategic_graph_seed'),
    ('NOW', 'ADBE', 'sector_peer', 0.55, 'Large-cap enterprise software peer group', 'strategic_graph_seed'),
    ('WMT', 'COST', 'competitor', 0.82, 'Big-box and warehouse retail traffic/consumer read-through', 'strategic_graph_seed'),
    ('WMT', 'TGT', 'competitor', 0.84, 'Big-box retail competitor', 'strategic_graph_seed'),
    ('COST', 'TGT', 'sector_peer', 0.70, 'Consumer staples/discretionary retail read-through', 'strategic_graph_seed'),
    ('SBUX', 'DIS', 'sector_peer', 0.45, 'Consumer discretionary traffic and spending sensitivity', 'strategic_graph_seed')
)
INSERT INTO company_relationships (symbol_a, symbol_b, relationship, strength, evidence, source, discovered_at, last_validated)
SELECT symbol_a, symbol_b, relationship, strength, evidence, source, NOW(), NOW()
FROM edges
ON CONFLICT (symbol_a, symbol_b, relationship) DO UPDATE SET
  strength = EXCLUDED.strength,
  evidence = EXCLUDED.evidence,
  source = EXCLUDED.source,
  last_validated = NOW();

REFRESH MATERIALIZED VIEW mv_relationship_hops;
