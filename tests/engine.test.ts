import { describe, expect, it } from "vitest";
import { scheduleAdvanceTax } from "../src/engine/advance-tax.js";
import { computeTax, slabTax } from "../src/engine/compute.js";
import { loadRulePack } from "../src/engine/rulepack.js";

const pack = loadRulePack("2025-26");

const base = {
  regime: "new" as const,
  salaryIncome: 0,
  otherIncome: 0,
  stcg111A: 0,
  ltcg112A: 0,
  deductions: 0,
  ageBand: "below60" as const,
};

describe("new regime slab tax (FY 2025-26)", () => {
  // Cumulative checkpoints published on incometax.gov.in
  it.each([
    [1200000, 60000],
    [1600000, 120000],
    [2000000, 200000],
    [2400000, 300000],
  ])("slab tax on %i is %i", (income, expected) => {
    expect(slabTax(income, pack.newRegime.slabs)).toBe(expected);
  });
});

describe("computeTax new regime", () => {
  it("12L salary pays zero (87A rebate, after 75K standard deduction)", () => {
    const r = computeTax({ ...base, salaryIncome: 1200000 }, pack);
    expect(r.taxableNormalIncome).toBe(1125000);
    expect(r.totalTax).toBe(0);
  });

  it("12.75L salary pays zero (standard deduction brings it to 12L)", () => {
    const r = computeTax({ ...base, salaryIncome: 1275000 }, pack);
    expect(r.taxableNormalIncome).toBe(1200000);
    expect(r.rebate87A).toBe(60000);
    expect(r.totalTax).toBe(0);
  });

  it("12,10,000 taxable income pays 10,000 + cess via marginal relief", () => {
    // Golden case from published worked examples: slab tax 61,500 but
    // marginal relief caps payable at income - 12L = 10,000 (plus 4% cess).
    const r = computeTax({ ...base, otherIncome: 1210000 }, pack);
    expect(r.taxableNormalIncome).toBe(1210000);
    expect(r.slabTax).toBe(61500);
    expect(r.taxBeforeSurcharge).toBe(10000);
    expect(r.totalTax).toBe(10400);
  });

  it("marginal relief exhausts around 12,70,588", () => {
    const atLimit = computeTax({ ...base, otherIncome: 1270588 }, pack);
    const past = computeTax({ ...base, otherIncome: 1280000 }, pack);
    // At the limit, relief still binds (payable = excess over 12L).
    expect(atLimit.taxBeforeSurcharge).toBeLessThanOrEqual(70588);
    // Past it, full slab tax applies with no relief.
    expect(past.rebate87A).toBe(0);
    expect(past.slabTax).toBe(past.taxBeforeSurcharge);
  });

  it("87A rebate never offsets capital gains tax", () => {
    // 8L normal income (within rebate) + LTCG: normal tax rebated, CG tax stays.
    const r = computeTax(
      { ...base, otherIncome: 800000, ltcg112A: 500000 },
      pack,
    );
    expect(r.rebate87A).toBeGreaterThan(0);
    // LTCG: (5,00,000 - 1,25,000) * 12.5% = 46,875
    expect(r.ltcgTax).toBe(46875);
    expect(r.taxBeforeSurcharge).toBe(46875);
  });

  it("applies 111A at 20% and 112A at 12.5% above the 1.25L exemption", () => {
    const r = computeTax(
      { ...base, otherIncome: 2000000, stcg111A: 100000, ltcg112A: 225000 },
      pack,
    );
    expect(r.stcgTax).toBe(20000);
    expect(r.taxableLtcg112A).toBe(100000);
    expect(r.ltcgTax).toBe(12500);
  });
});

describe("computeTax old regime", () => {
  it("uses old slabs, 50K standard deduction, and deductions", () => {
    const r = computeTax(
      { ...base, regime: "old", salaryIncome: 1000000, deductions: 150000 },
      pack,
    );
    // taxable = 10,00,000 - 50,000 - 1,50,000 = 8,00,000
    expect(r.taxableNormalIncome).toBe(800000);
    // old slabs: 2.5L nil + 2.5L@5% (12,500) + 3L@20% (60,000) = 72,500
    expect(r.slabTax).toBe(72500);
    expect(r.totalTax).toBe(Math.round(72500 * 1.04));
  });

  it("87A under old regime: 5L total income pays zero", () => {
    const r = computeTax({ ...base, regime: "old", otherIncome: 500000 }, pack);
    expect(r.rebate87A).toBe(12500);
    expect(r.totalTax).toBe(0);
  });

  it("old regime has no marginal relief on 87A", () => {
    const r = computeTax({ ...base, regime: "old", otherIncome: 510000 }, pack);
    expect(r.rebate87A).toBe(0);
    expect(r.slabTax).toBe(14500);
  });
});

describe("scheduleAdvanceTax", () => {
  it("splits 1L net liability into 15/45/75/100 installments", () => {
    const plan = scheduleAdvanceTax(
      { estimatedTax: 100000, tdsExpected: 0 },
      pack,
    );
    expect(plan.advanceTaxApplicable).toBe(true);
    expect(plan.installments.map((i) => i.cumulativeDue)).toEqual([
      15000, 45000, 75000, 100000,
    ]);
    expect(plan.installments.map((i) => i.installmentAmount)).toEqual([
      15000, 30000, 30000, 25000,
    ]);
    expect(plan.installments[0]?.dueDate).toBe("2025-06-15");
    expect(plan.installments[3]?.dueDate).toBe("2026-03-15");
  });

  it("not applicable below the 10K threshold", () => {
    const plan = scheduleAdvanceTax(
      { estimatedTax: 50000, tdsExpected: 45000 },
      pack,
    );
    expect(plan.advanceTaxApplicable).toBe(false);
    expect(plan.installments).toEqual([]);
  });

  it("tracks shortfalls against payments", () => {
    const plan = scheduleAdvanceTax(
      { estimatedTax: 100000, tdsExpected: 0, paidSoFar: [15000, 10000] },
      pack,
    );
    expect(plan.installments[0]?.shortfall).toBe(0);
    expect(plan.installments[1]?.shortfall).toBe(20000);
  });
});
