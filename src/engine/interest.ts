import type { RulePack } from "./rulepack.js";

/** Sections 234B/234C interest. Rounding hierarchy (verified):
 * - Rule 119A(c): interest PRINCIPAL truncates DOWN to the lower Rs 100
 *   multiple (the "fraction ignored" clause makes "nearest" a floor).
 * - Rule 119A(b): part month = FULL month.
 * - Simple interest, never compounded. */

export function floor100(n: number): number {
  return Math.floor(n / 100) * 100;
}

export interface Interest234BInput {
  /** Assessed tax = tax on total income minus TDS/TCS and reliefs.
   * Advance tax is NOT deducted for the 90% test denominator. */
  assessedTax: number;
  advanceTaxPaid: number;
  /** Months from 1 April of the AY to payment/assessment, part = full.
   * Example: paid 31 Aug -> Apr..Aug = 5. */
  months: number;
}

export interface Interest234BResult {
  applies: boolean;
  base: number;
  months: number;
  interest: number;
  note: string;
}

export function interest234B(
  input: Interest234BInput,
  pack: RulePack,
): Interest234BResult {
  const threshold = pack.advanceTax.section234B_paidThresholdPct;
  const rate = pack.interest?.ratePerMonth ?? 0.01;
  const applies =
    input.assessedTax >= pack.advanceTax.threshold &&
    input.advanceTaxPaid < input.assessedTax * threshold;
  if (!applies) {
    return {
      applies: false,
      base: 0,
      months: 0,
      interest: 0,
      note: `advance tax paid covers >= ${threshold * 100}% of assessed tax (or liability below threshold) -- no 234B`,
    };
  }
  const base = floor100(Math.max(0, input.assessedTax - input.advanceTaxPaid));
  const interest = Math.round(base * rate * input.months);
  return {
    applies: true,
    base,
    months: input.months,
    interest,
    note: `1%/month on ${base} for ${input.months} month(s) from 1 April of the AY (part month = full month)`,
  };
}

export interface Interest234CInput {
  /** Tax due on RETURNED income minus TDS/TCS/reliefs. */
  taxDueOnReturnedIncome: number;
  /** Cumulative advance tax paid by each due date (Jun/Sep/Dec/Mar). */
  cumulativePaid: [number, number, number, number];
  /** Presumptive (44AD/44ADA): single installment, 100% by Mar 15. */
  presumptive?: boolean;
}

export interface Installment234C {
  due: string;
  requiredPct: number;
  required: number;
  paid: number;
  shortfall: number;
  safeHarborApplied: boolean;
  months: number;
  interest: number;
}

export interface Interest234CResult {
  applies: boolean;
  installments: Installment234C[];
  totalInterest: number;
  notes: string[];
}

export function interest234C(
  input: Interest234CInput,
  pack: RulePack,
): Interest234CResult {
  const cfg = pack.interest?.s234C;
  const rate = pack.interest?.ratePerMonth ?? 0.01;
  if (!cfg) throw new Error("rule pack missing interest.s234C");
  const base = input.taxDueOnReturnedIncome;

  if (base < cfg.minLiability) {
    return {
      applies: false,
      installments: [],
      totalInterest: 0,
      notes: [
        `net liability ${base} below Rs ${cfg.minLiability} -- 234C not applicable`,
      ],
    };
  }

  const notes: string[] = [];

  if (input.presumptive) {
    const paid = input.cumulativePaid[3];
    const shortfall = Math.max(0, base - paid);
    const interest = Math.round(
      floor100(shortfall) * rate * cfg.presumptive.months,
    );
    return {
      applies: shortfall > 0,
      installments: [
        {
          due: cfg.presumptive.due,
          requiredPct: cfg.presumptive.pct,
          required: base,
          paid,
          shortfall,
          safeHarborApplied: false,
          months: cfg.presumptive.months,
          interest,
        },
      ],
      totalInterest: interest,
      notes: ["presumptive (44AD/44ADA): single 100% installment by 15 Mar"],
    };
  }

  const installments: Installment234C[] = cfg.installments.map((inst, i) => {
    const required = Math.round(base * inst.cumulativePct);
    const paid = input.cumulativePaid[i] ?? 0;

    // Statutory safe harbors: >=12% by Jun 15 / >=36% by Sep 15 zero that
    // installment. When breached, shortfall measures from 15%/45%.
    let safeHarborApplied = false;
    if (inst.safeHarborPct !== null && paid >= base * inst.safeHarborPct) {
      safeHarborApplied = true;
    }

    const shortfall = safeHarborApplied ? 0 : Math.max(0, required - paid);
    const interest = Math.round(floor100(shortfall) * rate * inst.months);
    return {
      due: inst.due,
      requiredPct: inst.cumulativePct,
      required,
      paid,
      shortfall,
      safeHarborApplied,
      months: inst.months,
      interest,
    };
  });

  notes.push(
    "capital gains / winnings / first-time business income / dividend shortfalls are excused when paid in remaining installments (first proviso) -- not modeled; exclude such income from the base for earlier installments manually",
  );

  const totalInterest = installments.reduce((s, i) => s + i.interest, 0);
  return { applies: totalInterest > 0, installments, totalInterest, notes };
}
