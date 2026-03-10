import { RVFEngine } from './index.js';

export function seedAllenKnowledgeBase(rvf: RVFEngine) {
  // Check if already seeded
  const existing = rvf.search('robert-allen', 'knowledge');
  if (existing.length > 0) {
    console.log(`[Knowledge] Allen knowledge base already seeded (${existing.length} entries)`);
    return existing;
  }

  console.log('[Knowledge] Seeding Robert Allen knowledge base into RVF containers...');
  const containers = [];

  // ===== MASTER FRAMEWORK =====
  containers.push(rvf.create('knowledge', 'robert-allen-master-framework', {
    source: 'Robert G. Allen',
    books: ['Multiple Streams of Income', 'Nothing Down', 'Nothing Down for the 2000s'],
    category: 'framework',
    tags: ['wealth-building', 'multiple-streams', 'diversification', 'passive-income'],
    content: {
      corePhilosophy: 'Sustainable wealth requires generating income from multiple sources across different categories rather than relying on any single approach. A portfolio of separate income streams is required so that if income from one source runs out, there is time to adjust.',
      threeMoneyMountains: {
        description: 'Allen organizes wealth-building into three great Money Mountains from which income streams flow. The goal is to have at least one stream from each mountain flowing into your reservoir of accumulating wealth.',
        mountains: [
          {
            name: 'Real Estate Mountain',
            description: 'Property-based investments including rental income, flipping, foreclosures, tax liens, and creative financing.',
            mtwmModule: 'realestate',
            streams: ['rental-income', 'flipping', 'foreclosures', 'tax-liens', 'lease-options'],
          },
          {
            name: 'Investment Mountain',
            description: 'Securities and financial instruments including stocks, mutual funds, options, and crypto assets.',
            mtwmModule: 'trading',
            streams: ['stock-trading', 'options', 'mutual-funds', 'crypto', 'dividends'],
          },
          {
            name: 'Marketing Mountain',
            description: 'Business and entrepreneurial ventures including info products, licensing, network marketing, internet income.',
            mtwmModule: 'business',
            streams: ['infopreneuring', 'licensing', 'network-marketing', 'internet-income', 'ai-as-a-service'],
          },
        ],
      },
      moneyTreeFormula: {
        description: 'Creating lifelong streams of cash flow by distinguishing between linear income (paid once for work) and residual income (paid ongoing from a single effort).',
        principle: 'Always prioritize building residual income streams over linear income. Each investment should generate recurring cash flow.',
        mtwmApplication: 'MTWM prioritizes investments that produce recurring returns: dividend stocks, rental properties, SaaS/AI services.',
      },
      eightyTwentyPrinciple: 'Focus on the 20% of information and strategies that yield 80% of the results to avoid being overwhelmed by excessive data.',
      financialFortress: 'Create a financial fortress around your family to shield accumulated wealth and multiple income streams from threats. Includes emergency reserves, insurance, legal structures, and diversification.',
      twentyOneTimeStrategies: 'Allen includes 21 time-management strategies recognizing that time is the ultimate scarce resource. MTWM automates the time-intensive research and monitoring, freeing the operator for decision-making.',
    },
  }));

  // ===== TEN INCOME STREAMS =====
  containers.push(rvf.create('knowledge', 'robert-allen-ten-streams', {
    source: 'Robert G. Allen - Multiple Streams of Income',
    category: 'income-streams',
    tags: ['ten-streams', 'income-generation', 'wealth-building'],
    content: {
      streams: [
        {
          number: 1,
          name: 'Stock Market Success',
          mountain: 'Investment',
          description: 'Low-risk strategies to grow wealth through stock market investing. Focus on value investing principles and systematic approaches.',
          mtwmModule: 'trading',
          automatable: true,
          mtwmStrategy: 'Neural Trader scans for technical signals (RSI, MACD, Bollinger Bands) to identify entry/exit points.',
        },
        {
          number: 2,
          name: 'Accelerated Stock Strategies',
          mountain: 'Investment',
          description: 'Advanced stock techniques including options and leveraged positions for accelerated returns.',
          mtwmModule: 'trading',
          automatable: true,
          mtwmStrategy: 'MinCut optimizer uses Kelly criterion for position sizing. Quarter-Kelly for conservative growth.',
        },
        {
          number: 3,
          name: 'Double Your Money in the Market',
          mountain: 'Investment',
          description: 'Identifying high-growth opportunities that can double invested capital. Momentum and growth stock strategies.',
          mtwmModule: 'trading',
          automatable: true,
          mtwmStrategy: 'Neural Trader confidence scoring identifies high-conviction signals for larger position sizes.',
        },
        {
          number: 4,
          name: 'Winning Big in Real Estate',
          mountain: 'Real Estate',
          description: 'Finding bargain properties, funding them creatively, and farming profits through long-term holding or flipping. Three critical actions: Find, Fund, Farm.',
          mtwmModule: 'realestate',
          automatable: false,
          mtwmStrategy: 'Authority Matrix requires approval on all property LOIs. RVF containers track each property deal with versioned financials.',
        },
        {
          number: 5,
          name: 'Fortune in Foreclosures & Flippers',
          mountain: 'Real Estate',
          description: 'Profiting from distressed properties through foreclosure acquisitions and value-add flipping strategies.',
          mtwmModule: 'realestate',
          automatable: false,
          mtwmStrategy: 'System monitors foreclosure listings and evaluates deals against Nothing Down criteria. Owner approval required.',
        },
        {
          number: 6,
          name: 'OPT - Other Peoples Taxes',
          mountain: 'Real Estate',
          description: 'Tax lien and tax deed investing. Earn 8-36% returns by paying delinquent property taxes and receiving interest or the property itself.',
          mtwmModule: 'alternatives',
          automatable: false,
          mtwmStrategy: 'Track tax lien auctions. Evaluate redemption rates and property values. Small autonomous threshold for entry.',
        },
        {
          number: 7,
          name: 'Network Marketing',
          mountain: 'Marketing',
          description: 'Building residual income through network marketing organizations. Leveraging systems and teams.',
          mtwmModule: 'business',
          automatable: false,
          mtwmStrategy: 'Not a primary MTWM focus. Track if operator engages in network marketing.',
        },
        {
          number: 8,
          name: 'Infopreneuring',
          mountain: 'Marketing',
          description: 'Creating and selling information products. Turning knowledge into classified ads, books, courses, and digital products.',
          mtwmModule: 'business',
          automatable: true,
          mtwmStrategy: 'AI-as-a-Service module. MTWM can help create and market information products using AI capabilities.',
        },
        {
          number: 9,
          name: 'Licensing',
          mountain: 'Marketing',
          description: 'Licensing intellectual property for recurring royalties. Creating IP once and earning from it repeatedly.',
          mtwmModule: 'business',
          automatable: true,
          mtwmStrategy: 'Track IP assets (Cetacean Labs, etc.) and licensing revenue. RVF containers for each IP asset.',
        },
        {
          number: 10,
          name: 'Internet Income',
          mountain: 'Marketing',
          description: 'Building online businesses and digital income streams. E-commerce, SaaS, affiliate marketing, digital products.',
          mtwmModule: 'business',
          automatable: true,
          mtwmStrategy: 'AI-as-a-Service revenue tracking. Monitor Cetacean Labs and other digital income streams.',
        },
      ],
    },
  }));

  // ===== NOTHING DOWN - CREATIVE FINANCING =====
  containers.push(rvf.create('knowledge', 'robert-allen-nothing-down-techniques', {
    source: 'Robert G. Allen - Nothing Down / Nothing Down for the 2000s',
    category: 'real-estate-techniques',
    tags: ['nothing-down', 'creative-financing', 'real-estate', 'no-money-down', 'seller-financing'],
    content: {
      corePrinciple: 'The key to real estate investment is to be creative and resourceful rather than relying on traditional financing methods. Use leveraging — borrowed capital to increase potential return.',
      findFundFarm: {
        find: 'Locate bargain properties from motivated sellers (dont-wanters). Look for distressed situations, estate sales, relocations, divorces, tax delinquencies.',
        fund: 'Use creative financing to acquire with little or no money down. Multiple techniques available depending on seller motivation and property characteristics.',
        farm: 'Generate profits either through long-term holding (cash flow) or flipping for quick equity gains. Build equity through appreciation, mortgage paydown, and value-add improvements.',
      },
      techniques: [
        {
          name: 'The Ultimate Paper Out',
          description: 'Put on a new first mortgage and have the seller carry back all remaining equity as a second mortgage at below-market rates. Zero buyer cash needed.',
          whenToUse: 'When seller is motivated and willing to carry paper. Works well with dont-wanters.',
          example: 'Acquire a $48,000 triplex — banker arranges first mortgage, seller carries back equity. Or a $66,500 SFH with seller carrying back $36,500 for 5 years, no payments, no interest.',
          riskLevel: 'moderate',
          mtwmEvaluation: ['seller_motivation', 'property_cashflow', 'loan_to_value'],
        },
        {
          name: 'The Second Mortgage Crank',
          description: 'Find properties free and clear or with low LTV. Obtain a new hard-money first or second to generate cash for the seller. Seller carries back remainder. No buyer cash from pocket.',
          whenToUse: 'Properties with low loan-to-value ratios. Works with both motivated and fussy sellers.',
          process: '1) Find low-LTV property. 2) Obtain new hard-money loan. 3) Use proceeds to satisfy seller cash needs. 4) Seller carries back remaining equity.',
          riskLevel: 'moderate',
          mtwmEvaluation: ['loan_to_value', 'hard_money_rates', 'cashflow_after_debt'],
        },
        {
          name: 'Blanket Mortgage',
          description: 'Use existing equity in other properties as collateral. Consolidate multiple properties under a single financing arrangement.',
          whenToUse: 'When you have equity in existing properties. Building trust with the seller is key.',
          riskLevel: 'moderate',
          mtwmEvaluation: ['existing_equity', 'portfolio_leverage', 'cross_collateral_risk'],
        },
        {
          name: 'Wrap-Around Contract (AITD)',
          description: 'All-Inclusive Trust Deed. Buyer makes payments to seller on a new note that wraps around existing financing. Seller continues paying underlying mortgage.',
          whenToUse: 'When existing financing has favorable terms. Seller wants ongoing income stream.',
          riskLevel: 'moderate',
          mtwmEvaluation: ['existing_mortgage_terms', 'due_on_sale_risk', 'seller_reliability'],
        },
        {
          name: 'Raise the Price, Lower the Terms',
          description: 'Offer the seller MORE than asking price in exchange for flexible payment terms — lower interest, longer amortization, delayed payments, or seller financing.',
          whenToUse: 'When seller is focused on price rather than terms. You win on cash flow even if you pay more on paper.',
          principle: 'Price is what you pay, terms are what matter for cash flow. A higher price with better terms can be more profitable than a lower price with worse terms.',
          riskLevel: 'low',
          mtwmEvaluation: ['cashflow_analysis', 'term_flexibility', 'npv_comparison'],
        },
        {
          name: 'Equity Sharing',
          description: 'Share a portion of the propertys future appreciation with the seller (or partner) in exchange for a lower initial purchase price or down payment.',
          whenToUse: 'When you lack capital but the property has strong appreciation potential. Partner brings money, you bring deal-finding and management.',
          riskLevel: 'low',
          mtwmEvaluation: ['appreciation_potential', 'partner_terms', 'equity_split_fairness'],
        },
        {
          name: 'Lease Option (Rent-to-Own)',
          description: 'Lease a property with an option to purchase at a predetermined price within a specified timeframe. Control property with minimal capital and risk.',
          whenToUse: 'When you need time to arrange financing or want to test a market. Low capital required upfront.',
          process: '1) Negotiate lease with purchase option. 2) Lock in purchase price. 3) Build equity through option credits. 4) Exercise option when ready.',
          riskLevel: 'low',
          mtwmEvaluation: ['option_price_vs_market', 'monthly_credits', 'market_trend'],
        },
        {
          name: 'Subject-To Existing Financing',
          description: 'Take over existing mortgage payments without formally assuming the loan. Deed transfers to buyer while loan stays in sellers name.',
          whenToUse: 'When existing mortgage has favorable terms (low rate). Seller needs relief from payments.',
          risks: ['Due-on-sale clause risk', 'Seller credit exposure'],
          riskLevel: 'high',
          mtwmEvaluation: ['existing_rate', 'due_on_sale_risk', 'seller_distress_level'],
        },
        {
          name: 'Pyramiding',
          description: 'Accelerate wealth by acquiring multiple properties, building equity in each, and using accumulated equity to acquire additional properties.',
          whenToUse: 'Once you have 1-2 properties with equity. Reinvest gains systematically.',
          principle: 'Each property compounds into the next. Small portfolio grows exponentially through strategic equity deployment.',
          riskLevel: 'moderate',
          mtwmEvaluation: ['portfolio_equity', 'leverage_ratio', 'cashflow_coverage'],
        },
        {
          name: 'Foreclosure Acquisition',
          description: 'Purchase distressed properties in pre-foreclosure, at auction, or REO from banks at below-market prices.',
          whenToUse: 'Market downturns or localized distress. Requires quick decision-making and available capital (or hard money).',
          process: '1) Monitor foreclosure listings. 2) Evaluate property and liens. 3) Contact distressed owner or bid at auction. 4) Rehabilitate or hold.',
          riskLevel: 'high',
          mtwmEvaluation: ['market_value', 'repair_costs', 'lien_analysis', 'arv_estimate'],
        },
        {
          name: 'Tax Lien / Tax Deed Investing',
          description: 'Pay delinquent property taxes to receive either high-interest returns (lien states) or the property itself (deed states). Returns of 8-36%.',
          whenToUse: 'As a conservative alternative investment with fixed returns. Small amounts can be deployed systematically.',
          riskLevel: 'low',
          mtwmEvaluation: ['redemption_rate', 'property_value', 'tax_amount', 'state_rules'],
        },
        {
          name: 'Property Conversion',
          description: 'Increase property value by converting use — single family to multi-unit, residential to commercial, apartments to condos.',
          whenToUse: 'When zoning allows and market demand supports higher-value use.',
          riskLevel: 'moderate',
          mtwmEvaluation: ['zoning_analysis', 'conversion_costs', 'market_demand', 'value_uplift'],
        },
      ],
      negotiationPrinciples: [
        'Find motivated sellers (dont-wanters) — people who NEED to sell, not just WANT to sell.',
        'Never offer your best terms first. Start with the most creative structure.',
        'The person with the most information wins the negotiation.',
        'Time pressure works in favor of the patient buyer.',
        'Always have multiple exit strategies for any deal.',
        'Cash flow is king — appreciation is a bonus, not a strategy.',
      ],
    },
  }));

  // ===== REINVESTMENT STRATEGY =====
  containers.push(rvf.create('knowledge', 'robert-allen-reinvestment-strategy', {
    source: 'Robert G. Allen - Multiple Streams of Income + Nothing Down',
    category: 'strategy',
    tags: ['reinvestment', 'compounding', 'wealth-building', 'pyramiding', 'cash-flow'],
    content: {
      description: 'MTWM implementation of Allen reinvestment principles: trading profits fund first rental property, rental income compounds back into trading and next property.',
      phases: [
        {
          phase: 1,
          name: 'Paper Trading Validation',
          allenPrinciple: 'Learn before you earn. Validate strategy with no capital risk.',
          mtwmActions: [
            'Run Neural Trader signals on paper for 3 weeks',
            'Track simulated P&L with witness chain',
            'Validate signal quality and risk controls',
            'Study target real estate markets',
          ],
          durationWeeks: 3,
          capitalRequired: 0,
        },
        {
          phase: 2,
          name: 'Seed Capital Generation',
          allenPrinciple: 'Investment Mountain — use stock market to generate initial capital. Start small, compound returns.',
          mtwmActions: [
            'Begin real trading at 1/10th thresholds',
            'Reinvest all trading profits',
            'Target consistent returns over home runs',
            'Build emergency reserve (6 months expenses)',
          ],
          targetCapital: 'First rental down payment or Nothing Down deal funding',
          streams: ['stock-trading', 'crypto-trading'],
        },
        {
          phase: 3,
          name: 'First Property Acquisition',
          allenPrinciple: 'Real Estate Mountain — acquire first rental using Nothing Down creative financing. Find, Fund, Farm.',
          mtwmActions: [
            'Scan for motivated sellers and foreclosures',
            'Evaluate deals using Nothing Down techniques',
            'Use creative financing to minimize capital deployment',
            'Track property in RVF container with full financials',
          ],
          targetOutcome: 'Positive cash flow rental property',
          preferredTechniques: [
            'Lease Option for low-risk entry',
            'Seller Financing for motivated sellers',
            'Raise the Price Lower the Terms for cashflow optimization',
          ],
        },
        {
          phase: 4,
          name: 'Dual Stream Compounding',
          allenPrinciple: 'Multiple streams flowing simultaneously. Trading + Rental income both reinvesting.',
          mtwmActions: [
            'Trading profits + rental cash flow compound together',
            'Scale trading thresholds as profitability proves out',
            'Evaluate second property acquisition',
            'Begin exploring Marketing Mountain streams (AI-as-a-Service)',
          ],
          streams: ['stock-trading', 'crypto-trading', 'rental-income'],
        },
        {
          phase: 5,
          name: 'Pyramiding',
          allenPrinciple: 'Use accumulated equity from first properties + trading gains to acquire additional properties. Each asset compounds into the next.',
          mtwmActions: [
            'Deploy equity from property 1 into property 2',
            'Maintain trading as consistent income stream',
            'Add alternative investments (tax liens at 8-36%)',
            'Build toward three simultaneous money mountain streams',
          ],
          streams: ['stock-trading', 'crypto-trading', 'rental-income-1', 'rental-income-2', 'tax-liens', 'ai-services'],
        },
      ],
      reinvestmentRules: [
        'Never spend trading profits — reinvest 100% until Phase 4',
        'Maintain 6-month emergency reserve at all times (Allen Financial Fortress)',
        'Each new income stream should be self-sustaining before adding the next',
        'Use Kelly criterion (quarter-Kelly) for position sizing — never bet the farm',
        'Real estate cash flow covers property expenses + contributes to trading capital',
        'Track every dollar flow through witness chain for full accountability',
      ],
    },
  }));

  // ===== DEAL EVALUATION CRITERIA =====
  containers.push(rvf.create('knowledge', 'robert-allen-deal-evaluation', {
    source: 'Robert G. Allen - Nothing Down',
    category: 'evaluation-criteria',
    tags: ['deal-analysis', 'real-estate', 'evaluation', 'due-diligence'],
    content: {
      description: 'Criteria MTWM uses to evaluate real estate deals based on Allen principles.',
      mustHave: [
        'Positive cash flow from day one (or clear path to it within 90 days)',
        'Below-market acquisition price OR exceptional terms that offset price',
        'Motivated seller with clear reason to deal',
        'Exit strategy identified before entry',
        'Fits within current phase risk limits',
      ],
      redFlags: [
        'Negative cash flow with no clear path to positive',
        'Seller not motivated — just fishing for above-market price',
        'No exit strategy beyond appreciation hope',
        'Would exceed portfolio concentration limits',
        'Requires capital beyond current reserves minus emergency fund',
      ],
      scoringMetrics: {
        cashOnCashReturn: { minimum: 0.08, target: 0.12, description: 'Annual cash flow / total cash invested' },
        capRate: { minimum: 0.06, target: 0.08, description: 'NOI / purchase price' },
        debtServiceCoverage: { minimum: 1.25, description: 'NOI / annual debt service' },
        grossRentMultiplier: { maximum: 15, description: 'Purchase price / annual gross rent' },
        breakEvenOccupancy: { maximum: 0.75, description: 'Expenses / gross potential rent' },
      },
      nothingDownBonus: {
        description: 'Additional score boost for deals achievable with creative financing',
        techniques: [
          'Seller financing available: +20 points',
          'Subject-to possible: +15 points',
          'Lease option entry: +25 points (lowest risk)',
          'Below 80% LTV (crank potential): +10 points',
        ],
      },
    },
  }));

  console.log(`[Knowledge] Seeded ${containers.length} Allen knowledge base RVF containers`);
  return containers;
}
