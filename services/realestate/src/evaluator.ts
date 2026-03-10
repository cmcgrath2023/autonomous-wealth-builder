import { PropertyDeal } from '../../shared/types/index.js';
import { eventBus } from '../../shared/utils/event-bus.js';
import { v4 as uuid } from 'uuid';

export interface PropertyListing {
  address: string;
  city: string;
  state: string;
  askingPrice: number;
  estimatedRent: number;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  yearBuilt: number;
  propertyType: 'single_family' | 'duplex' | 'triplex' | 'fourplex' | 'condo';
  listingSource: string;
  daysOnMarket: number;
  sellerMotivation?: 'unknown' | 'low' | 'medium' | 'high';
  estimatedRepairs?: number;
  existingMortgage?: number;
  hoa?: number;
}

export interface DealScore {
  overall: number;           // 0-10
  capRate: number;           // Annual NOI / Price
  cashOnCash: number;        // Annual cash flow / cash invested
  dscr: number;              // NOI / debt service
  grm: number;               // Price / gross annual rent
  pricePerSqft: number;
  rentToPrice: number;       // Monthly rent / price ratio
  nothingDownViability: number; // 0-10 score for creative financing
  recommendedTechnique: string;
  signals: string[];
  warnings: string[];
}

// Allen Nothing Down criteria weights
const ALLEN_WEIGHTS = {
  capRate: 0.20,
  cashOnCash: 0.15,
  dscr: 0.15,
  nothingDown: 0.20,
  motivation: 0.15,
  cashFlow: 0.15,
};

// Olympia/Tumwater WA market benchmarks
const MARKET_BENCHMARKS = {
  targetArea: 'Olympia/Tumwater WA',
  medianHomePrice: 450000,
  medianRent: 1800,
  avgCapRate: 0.055,
  avgRentToPrice: 0.004,
  propertyTaxRate: 0.0105,  // Thurston County ~1.05%
  insuranceRate: 0.004,
  vacancyRate: 0.05,
  managementRate: 0.08,
  maintenanceRate: 0.01,
  avgMortgageRate: 0.0675,  // Current 30-year rate
};

export class RealEstateEvaluator {
  private pipeline: PropertyDeal[] = [];
  private benchmarks = MARKET_BENCHMARKS;

  evaluate(listing: PropertyListing): { deal: PropertyDeal; score: DealScore } {
    const annualRent = listing.estimatedRent * 12;
    const repairs = listing.estimatedRepairs || 0;
    const effectivePrice = listing.askingPrice + repairs;

    // Operating expenses
    const propertyTax = listing.askingPrice * this.benchmarks.propertyTaxRate;
    const insurance = listing.askingPrice * this.benchmarks.insuranceRate;
    const vacancy = annualRent * this.benchmarks.vacancyRate;
    const management = annualRent * this.benchmarks.managementRate;
    const maintenance = listing.askingPrice * this.benchmarks.maintenanceRate;
    const hoa = (listing.hoa || 0) * 12;
    const totalExpenses = propertyTax + insurance + vacancy + management + maintenance + hoa;

    // NOI and cash flow
    const noi = annualRent - totalExpenses;

    // Debt service (assume 30-year conventional)
    const loanAmount = effectivePrice * 0.8;  // 20% down conventional
    const monthlyRate = this.benchmarks.avgMortgageRate / 12;
    const payments = 360;
    const monthlyPayment = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, payments)) / (Math.pow(1 + monthlyRate, payments) - 1);
    const annualDebtService = monthlyPayment * 12;

    const annualCashFlow = noi - annualDebtService;
    const cashInvested = effectivePrice * 0.2 + repairs; // Down payment + repairs

    // Core metrics
    const capRate = effectivePrice > 0 ? noi / effectivePrice : 0;
    const cashOnCash = cashInvested > 0 ? annualCashFlow / cashInvested : 0;
    const dscr = annualDebtService > 0 ? noi / annualDebtService : 0;
    const grm = annualRent > 0 ? listing.askingPrice / annualRent : 999;
    const pricePerSqft = listing.sqft > 0 ? listing.askingPrice / listing.sqft : 0;
    const rentToPrice = listing.askingPrice > 0 ? listing.estimatedRent / listing.askingPrice : 0;

    // Nothing Down viability scoring
    let ndScore = 0;
    const signals: string[] = [];
    const warnings: string[] = [];
    let recommendedTechnique = 'Conventional';

    // High days on market = motivated seller
    if (listing.daysOnMarket > 90) {
      ndScore += 3;
      signals.push('Long DOM — seller likely motivated');
      recommendedTechnique = 'Seller Financing';
    } else if (listing.daysOnMarket > 60) {
      ndScore += 2;
      signals.push('Extended DOM — negotiation leverage');
    }

    // Seller motivation
    if (listing.sellerMotivation === 'high') {
      ndScore += 3;
      signals.push('High seller motivation — creative terms likely');
      recommendedTechnique = 'Subject-To';
    } else if (listing.sellerMotivation === 'medium') {
      ndScore += 1.5;
      signals.push('Moderate seller motivation');
    }

    // Price below median suggests distress or opportunity
    if (listing.askingPrice < this.benchmarks.medianHomePrice * 0.8) {
      ndScore += 2;
      signals.push('Below-market price — potential Nothing Down candidate');
      if (!listing.sellerMotivation || listing.sellerMotivation === 'unknown') {
        recommendedTechnique = 'Lease Option';
      }
    }

    // Existing mortgage presence enables Subject-To
    if (listing.existingMortgage && listing.existingMortgage > listing.askingPrice * 0.5) {
      ndScore += 1.5;
      signals.push('Existing mortgage balance — Subject-To viable');
      recommendedTechnique = 'Subject-To';
    }

    // Rent-to-price ratio (1% rule)
    if (rentToPrice >= 0.01) {
      ndScore += 2;
      signals.push('Meets 1% rule — strong cash flow');
    } else if (rentToPrice >= 0.007) {
      ndScore += 1;
      signals.push('Approaching 1% rule');
    } else {
      warnings.push('Below 0.7% rent-to-price — weak cash flow');
    }

    // Multi-family premium
    if (['duplex', 'triplex', 'fourplex'].includes(listing.propertyType)) {
      ndScore += 1;
      signals.push(`${listing.propertyType} — multiple income streams`);
    }

    ndScore = Math.min(10, ndScore);

    // Overall score (Allen-weighted)
    let overall = 0;
    overall += ALLEN_WEIGHTS.capRate * Math.min(10, (capRate / 0.10) * 10);
    overall += ALLEN_WEIGHTS.cashOnCash * Math.min(10, (Math.max(0, cashOnCash) / 0.15) * 10);
    overall += ALLEN_WEIGHTS.dscr * Math.min(10, (dscr / 1.5) * 10);
    overall += ALLEN_WEIGHTS.nothingDown * ndScore;
    overall += ALLEN_WEIGHTS.motivation * (listing.sellerMotivation === 'high' ? 10 : listing.sellerMotivation === 'medium' ? 6 : 3);
    overall += ALLEN_WEIGHTS.cashFlow * Math.min(10, (Math.max(0, annualCashFlow) / 5000) * 10);

    // Warnings
    if (capRate < 0.04) warnings.push('Cap rate below 4% — poor return');
    if (dscr < 1.0) warnings.push('DSCR below 1.0 — negative cash flow');
    if (cashOnCash < 0) warnings.push('Negative cash-on-cash return');
    if (listing.yearBuilt < 1960) warnings.push('Pre-1960 — higher maintenance risk');

    const deal: PropertyDeal = {
      id: uuid(),
      address: listing.address,
      city: listing.city,
      state: listing.state,
      askingPrice: listing.askingPrice,
      estimatedValue: effectivePrice,
      capRate: Math.round(capRate * 10000) / 10000,
      cashFlow: Math.round(annualCashFlow),
      score: Math.round(overall * 10) / 10,
      status: overall >= 7 ? 'analyzing' : 'pipeline',
    };

    this.pipeline.push(deal);

    eventBus.emit('realestate:evaluated', {
      dealId: deal.id,
      address: deal.address,
      score: deal.score,
      capRate: deal.capRate,
      technique: recommendedTechnique,
    });

    return {
      deal,
      score: {
        overall: Math.round(overall * 10) / 10,
        capRate: Math.round(capRate * 10000) / 10000,
        cashOnCash: Math.round(cashOnCash * 10000) / 10000,
        dscr: Math.round(dscr * 100) / 100,
        grm: Math.round(grm * 10) / 10,
        pricePerSqft: Math.round(pricePerSqft),
        rentToPrice: Math.round(rentToPrice * 10000) / 10000,
        nothingDownViability: ndScore,
        recommendedTechnique,
        signals,
        warnings,
      },
    };
  }

  // Kelly-based position sizing for RE: how much of trading profits to allocate
  kellyAllocation(winRate: number, avgReturn: number, avgLoss: number, availableCapital: number): number {
    if (avgLoss === 0) return 0;
    const kelly = winRate - ((1 - winRate) / (avgReturn / avgLoss));
    const halfKelly = Math.max(0, Math.min(0.25, kelly * 0.5)); // Conservative half-Kelly, max 25%
    return Math.round(availableCapital * halfKelly);
  }

  getPipeline(): PropertyDeal[] {
    return [...this.pipeline];
  }

  getDeal(id: string): PropertyDeal | undefined {
    return this.pipeline.find(d => d.id === id);
  }

  updateDealStatus(id: string, status: PropertyDeal['status']) {
    const deal = this.pipeline.find(d => d.id === id);
    if (deal) deal.status = status;
    return deal;
  }

  getBenchmarks() {
    return { ...this.benchmarks };
  }
}
