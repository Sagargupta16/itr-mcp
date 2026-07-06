import type { RulePack } from "./rulepack.js";

/** HRA exemption calculator (Rule 2A). Old regime only -- under 115BAC the
 * HRA is fully taxable.
 *
 * exempt = least of:
 *   (a) actual HRA received for the period
 *   (b) rent paid minus 10% of salary
 *   (c) 50% of salary (metro) / 40% (elsewhere)
 *
 * "Salary" on due basis = basic + DA (only if forming part of retirement
 * benefits) + commission at a fixed percentage of turnover (Gestetner SC).
 * Computed period-wise: pass one entry per homogeneous stretch. */

export interface HraPeriod {
  months: number;
  /** Basic salary for the whole period. */
  basic: number;
  /** DA forming part of retirement benefits, for the period. */
  daRetirement?: number;
  /** Commission at a fixed % of turnover, for the period. */
  turnoverCommission?: number;
  /** HRA actually received for the period. */
  hraReceived: number;
  /** Rent actually paid for the period. */
  rentPaid: number;
  /** Metro = Delhi/Mumbai/Kolkata/Chennai for FY 2025-26 (rule pack). */
  isMetro: boolean;
}

export interface HraPeriodResult extends HraPeriod {
  salary: number;
  limbA: number;
  limbB: number;
  limbC: number;
  exempt: number;
}

export interface HraResult {
  fy: string;
  regime: "old" | "new";
  periods: HraPeriodResult[];
  totalExempt: number;
  totalTaxable: number;
  warnings: string[];
  notes: string[];
}

export function computeHra(
  periods: HraPeriod[],
  pack: RulePack,
  regime: "old" | "new" = "old",
): HraResult {
  const hra = pack.hra;
  if (!hra) throw new Error("rule pack missing hra config");

  if (regime === "new") {
    const received = periods.reduce((s, p) => s + p.hraReceived, 0);
    return {
      fy: pack.fy,
      regime,
      periods: [],
      totalExempt: 0,
      totalTaxable: received,
      warnings: [],
      notes: [
        "HRA is fully taxable under the new regime (115BAC); 80GG is also barred.",
      ],
    };
  }

  const results: HraPeriodResult[] = periods.map((p) => {
    const salary =
      p.basic + (p.daRetirement ?? 0) + (p.turnoverCommission ?? 0);
    const limbA = p.hraReceived;
    const limbB = Math.max(0, p.rentPaid - salary * hra.rentExcessOfSalaryPct);
    const limbC = salary * (p.isMetro ? hra.metroPct : hra.nonMetroPct);
    const exempt = Math.round(Math.min(limbA, limbB, limbC));
    return {
      ...p,
      salary,
      limbA,
      limbB: Math.round(limbB),
      limbC: Math.round(limbC),
      exempt,
    };
  });

  const totalExempt = results.reduce((s, r) => s + r.exempt, 0);
  const totalReceived = periods.reduce((s, p) => s + p.hraReceived, 0);

  const warnings: string[] = [];
  const annualRent = periods.reduce((s, p) => s + p.rentPaid, 0);
  if (
    annualRent >
    (hra.warnings?.landlordPanRentPerYear ?? Number.POSITIVE_INFINITY)
  ) {
    warnings.push(
      `annual rent ${annualRent} exceeds Rs ${hra.warnings.landlordPanRentPerYear} -- landlord PAN required on Form 12BB (Rule 26C)`,
    );
  }

  return {
    fy: pack.fy,
    regime,
    periods: results,
    totalExempt,
    totalTaxable: Math.max(0, totalReceived - totalExempt),
    warnings,
    notes: [
      `metro list FY ${pack.fy}: ${hra.metroCities.join(", ")} only`,
      "salary = basic + DA (retirement-forming) + fixed-% turnover commission, on due basis",
    ],
  };
}

/** 80GG: rent deduction when NO HRA was received at any time in the year.
 * least of: Rs 60,000/yr, 25% of adjusted total income, rent - 10% of ATI. */
export function compute80GG(
  rentPaid: number,
  adjustedTotalIncome: number,
  pack: RulePack,
): {
  deduction: number;
  limbs: { cap: number; pctOfATI: number; rentExcess: number };
  notes: string[];
} {
  const cfg = pack.deduction80GG;
  if (!cfg) throw new Error("rule pack missing deduction80GG");
  const limbs = {
    cap: cfg.capPerYear,
    pctOfATI: Math.round(adjustedTotalIncome * cfg.pctOfATI),
    rentExcess: Math.max(
      0,
      Math.round(rentPaid - adjustedTotalIncome * cfg.rentExcessOfATIPct),
    ),
  };
  return {
    deduction: Math.min(limbs.cap, limbs.pctOfATI, limbs.rentExcess),
    limbs,
    notes: [
      "80GG requires: old regime, no HRA received at any time in the year, Form 10BA filed (acknowledgement number goes in Schedule 80GG)",
      "ATI = total income before 80GG, excluding LTCG, 111A STCG, and other Chapter VI-A deductions",
    ],
  };
}
