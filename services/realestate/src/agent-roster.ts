// Real Estate Agent Definitions — "Platoon of Robert Allens"
// Each agent handles a specific phase of the Nothing Down acquisition pipeline

export interface REAgentDef {
  id: string;
  name: string;
  role: string;
  description: string;
  allenTechniques: string[];
  capabilities: string[];
  heartbeatActions: string[];
}

export const RE_AGENT_ROSTER: REAgentDef[] = [
  {
    id: 're-scout',
    name: 'Property Scout',
    role: 'Deal Sourcer',
    description: 'Continuously scans MLS, FSBO, auction, and foreclosure listings in Olympia/Tumwater WA. Filters by Nothing Down viability and cash flow metrics.',
    allenTechniques: ['Market scanning', 'Motivated seller detection', 'Below-market identification'],
    capabilities: ['Listing aggregation', 'Price filtering', 'DOM tracking', 'Motivated seller scoring', 'Distressed property alerts'],
    heartbeatActions: ['scan_listings', 'check_new_foreclosures', 'track_price_drops'],
  },
  {
    id: 're-analyst',
    name: 'Deal Analyst',
    role: 'Underwriter',
    description: 'Deep financial analysis on scouted properties. Calculates cap rate, cash-on-cash, DSCR, and Kelly-optimal position size. Applies Allen deal scoring criteria.',
    allenTechniques: ['Cap rate analysis', 'Cash flow projection', 'Creative financing modeling'],
    capabilities: ['NOI calculation', 'Debt service analysis', 'Comparable sales', 'Rent estimation', 'Allen score computation'],
    heartbeatActions: ['evaluate_pipeline', 'update_market_benchmarks'],
  },
  {
    id: 're-negotiator',
    name: 'Offer Strategist',
    role: 'Negotiator',
    description: 'Designs optimal offer structures using Nothing Down techniques. Selects between seller financing, lease options, subject-to, and wraps based on seller situation.',
    allenTechniques: ['Seller financing', 'Lease option', 'Subject-to', 'Wraparound mortgage', 'Hard money + refi', 'Partner split'],
    capabilities: ['Offer letter drafting', 'Term negotiation modeling', 'Counter-offer strategy', 'Seller motivation analysis', 'Creative term sheets'],
    heartbeatActions: ['draft_offers', 'model_counteroffers'],
  },
  {
    id: 're-outreach',
    name: 'Owner Outreach',
    role: 'Acquisitions Rep',
    description: 'Reaches out to property owners directly — FSBO, expired listings, pre-foreclosure, and absentee owners. Presents Nothing Down proposals to build the pipeline.',
    allenTechniques: ['Direct mail', 'Cold outreach', 'Win-win presentations', 'Seller benefit framing'],
    capabilities: ['Owner contact research', 'Outreach letter generation', 'Follow-up scheduling', 'Response tracking', 'Conversion metrics'],
    heartbeatActions: ['generate_outreach', 'check_responses', 'schedule_followups'],
  },
  {
    id: 're-compliance',
    name: 'RE Compliance',
    role: 'Due Diligence',
    description: 'Verifies property details, title status, liens, zoning, and regulatory compliance for Thurston County. Ensures all deals pass legal scrutiny before LOI.',
    allenTechniques: ['Title verification', 'Lien detection', 'Zoning compliance'],
    capabilities: ['Title search', 'Property tax verification', 'Zoning lookup', 'HOA review', 'Environmental check'],
    heartbeatActions: ['verify_active_deals', 'check_county_records'],
  },
  {
    id: 're-portfolio',
    name: 'RE Portfolio Manager',
    role: 'Portfolio Optimizer',
    description: 'Manages the overall real estate portfolio allocation. Uses MinCut Kelly criterion to determine optimal property mix and reinvestment timing from trading profits.',
    allenTechniques: ['Portfolio diversification', 'Reinvestment strategy', '5-phase progression'],
    capabilities: ['Kelly allocation', 'Sector balance', 'Cash flow aggregation', 'Reinvestment threshold monitoring', 'Portfolio rebalancing'],
    heartbeatActions: ['check_reinvestment_ready', 'optimize_allocation'],
  },
];
