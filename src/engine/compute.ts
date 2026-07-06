import type { Rebate87A, RulePack, Slab } from "./rulepack.js";

export type Regime = "new" | "old";
export type AgeBand = "below60" | "senior" | "superSenior";

export interface TaxInput {
  regime: Regime;
  /** Gross salary income before standard deduction. */
  salaryIncome: number;
  /** Other normal-rate income: interest, rent (net of 30%), etc. */
  otherIncome: number;
  /** STCG taxable under 111A (listed equity, STT paid). */
  stcg111A: number;
  /** LTCG taxable under 112A BEFORE the 1.25L exemption. */
  ltcg112A: number;
  /** Old regime only: total Chapter VI-A deductions actually claimable
   * (already capped by the caller or via the deduction checklist tool). */
  deductions: number;
  ageBand: AgeBand;
}

export interface TaxBreakdown {
  fy: string;
  regime: Regime;
  rulePackVersion: string;
  grossIncome: number;
  standardDeduction: number;
  deductionsClaimed: number;
  taxableNormalIncome: number;
  taxableStcg111A: number;
  taxableLtcg112A: number;
  slabTax: number;
  rebate87A: number;
  stcgTax: number;
  ltcgTax: number;
  taxBeforeSurcharge: number;
  surcharge: number;
  cess: number;
  totalTax: number;
  effectiveRatePct: number;
  disclaimers: string[];
}

const DISCLAIMERS = [
  "Not tax advice. Verify against the official income tax utility before filing.",
  "Assumes resident individual. NRI/RNOR rules differ.",
];

function round(n: number): number {
  return Math.round(n);
}

export function slabTax(income: number, slabs: Slab[]): number {
  let tax = 0;
  let prev = 0;
  for (const slab of slabs) {
    const upper = slab.upTo ?? Number.POSITIVE_INFINITY;
    if (income <= prev) break;
    const taxable = Math.min(income, upper) - prev;
    tax += taxable * slab.rate;
    prev = upper;
  }
  return tax;
}

function applyRebate87A(
  normalIncome: number,
  totalIncome: number,
  normalSlabTax: number,
  stcgTax: number,
  rebate: Rebate87A,
): number {
  // Old regime: the 5L threshold tests TOTAL income (incl. capital gains);
  // new regime: 12L threshold tests normal income only (special-rate income
  // excluded from both the test and the rebate).
  const testIncome =
    rebate.thresholdBasis === "totalIncome" ? totalIncome : normalIncome;

  // Old regime 87A can offset 111A STCG tax; s.112A(6) bars 112A everywhere.
  const rebatableTax = normalSlabTax + (rebate.allowAgainst111A ? stcgTax : 0);

  if (testIncome > rebate.incomeThreshold) {
    if (!rebate.marginalRelief) return 0;
    // Marginal relief: tax payable cannot exceed income above the threshold.
    const excess = testIncome - rebate.incomeThreshold;
    if (rebatableTax > excess) return rebatableTax - excess;
    return 0;
  }
  return Math.min(rebatableTax, rebate.maxRebate);
}

function computeSurcharge(
  totalIncome: number,
  taxOnNormal: number,
  taxOnGains: number,
  pack: RulePack,
  regime: Regime,
): number {
  let rate = 0;
  for (const s of pack.surcharge.slabs) {
    if (totalIncome > s.above) rate = s.rate;
  }
  if (rate === 0) return 0;
  if (regime === "new") {
    rate = Math.min(rate, pack.newRegime.surchargeCapRate);
  }
  // 111A/112A gains (and dividends) carry a 15% surcharge cap.
  const gainsRate = Math.min(rate, pack.surcharge.capitalGainsAndDividendCap);
  let surcharge = taxOnNormal * rate + taxOnGains * gainsRate;

  if (pack.surcharge.marginalRelief) {
    // Marginal relief: extra tax (incl. surcharge) cannot exceed extra income
    // over the surcharge threshold crossed.
    const threshold = [...pack.surcharge.slabs]
      .reverse()
      .find((s) => totalIncome > s.above)?.above;
    if (threshold !== undefined) {
      const taxAtThreshold = taxOnNormal + taxOnGains; // approximation base
      const maxExtra = totalIncome - threshold;
      const extra = surcharge;
      void taxAtThreshold;
      if (extra > maxExtra) surcharge = maxExtra;
    }
  }
  return surcharge;
}

/** Deterministic FY tax computation. Pure function over the rule pack --
 * the LLM never does arithmetic. */
export function computeTax(input: TaxInput, pack: RulePack): TaxBreakdown {
  const regimeRules = input.regime === "new" ? pack.newRegime : pack.oldRegime;

  const standardDeduction =
    input.salaryIncome > 0
      ? Math.min(regimeRules.standardDeduction, input.salaryIncome)
      : 0;

  const deductionsClaimed = input.regime === "old" ? input.deductions : 0;

  let exemption = 0;
  if (input.regime === "old") {
    if (input.ageBand === "senior") {
      exemption =
        pack.oldRegime.seniorExemption - (pack.oldRegime.slabs[0]?.upTo ?? 0);
    } else if (input.ageBand === "superSenior") {
      exemption =
        pack.oldRegime.superSeniorExemption -
        (pack.oldRegime.slabs[0]?.upTo ?? 0);
    }
  }

  const taxableNormalIncome = Math.max(
    0,
    input.salaryIncome -
      standardDeduction +
      input.otherIncome -
      deductionsClaimed -
      exemption,
  );

  const normalSlabTax = slabTax(taxableNormalIncome, regimeRules.slabs);

  const stcgTax = input.stcg111A * pack.capitalGains.stcg111A;
  const taxableLtcg = Math.max(
    0,
    input.ltcg112A - pack.capitalGains.ltcg112AExemption,
  );
  const ltcgTax = taxableLtcg * pack.capitalGains.ltcg112A;

  const totalIncome = taxableNormalIncome + input.stcg111A + input.ltcg112A;

  // 87A: new regime tests normal income only and never touches CG tax;
  // old regime tests total income and can offset 111A (rule-pack flags).
  const rebate = applyRebate87A(
    taxableNormalIncome,
    totalIncome,
    normalSlabTax,
    stcgTax,
    regimeRules.rebate87A,
  );
  // Rebate consumes slab tax first, then (old regime only) 111A tax.
  const rebateOnNormal = Math.min(rebate, normalSlabTax);
  const rebateOnStcg = regimeRules.rebate87A.allowAgainst111A
    ? Math.min(rebate - rebateOnNormal, stcgTax)
    : 0;
  const taxOnNormal = Math.max(0, normalSlabTax - rebateOnNormal);
  const stcgTaxAfterRebate = Math.max(0, stcgTax - rebateOnStcg);

  const taxBeforeSurcharge = taxOnNormal + stcgTaxAfterRebate + ltcgTax;

  const surcharge = computeSurcharge(
    totalIncome,
    taxOnNormal,
    stcgTaxAfterRebate + ltcgTax,
    pack,
    input.regime,
  );

  const cess = (taxBeforeSurcharge + surcharge) * pack.cess;
  const totalTax = round(taxBeforeSurcharge + surcharge + cess);
  const grossIncome =
    input.salaryIncome + input.otherIncome + input.stcg111A + input.ltcg112A;

  return {
    fy: pack.fy,
    regime: input.regime,
    rulePackVersion: pack.rulePackVersion,
    grossIncome,
    standardDeduction,
    deductionsClaimed,
    taxableNormalIncome,
    taxableStcg111A: input.stcg111A,
    taxableLtcg112A: taxableLtcg,
    slabTax: round(normalSlabTax),
    rebate87A: round(rebate),
    stcgTax: round(stcgTaxAfterRebate),
    ltcgTax: round(ltcgTax),
    taxBeforeSurcharge: round(taxBeforeSurcharge),
    surcharge: round(surcharge),
    cess: round(cess),
    totalTax,
    effectiveRatePct:
      grossIncome > 0 ? Math.round((totalTax / grossIncome) * 10000) / 100 : 0,
    disclaimers: DISCLAIMERS,
  };
}
