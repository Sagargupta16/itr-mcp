import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeTax } from "../src/engine/compute.js";
import { compute80GG, computeHra } from "../src/engine/hra.js";
import {
  floor100,
  interest234B,
  interest234C,
} from "../src/engine/interest.js";
import { reconcile } from "../src/engine/reconcile.js";
import { loadRulePack } from "../src/engine/rulepack.js";
import {
  AisDecryptError,
  decryptAis,
  parseAisDocument,
} from "../src/parsers/ais.js";

const pack = loadRulePack("2025-26");

describe("rule 119A rounding", () => {
  it("floors interest principal to the lower Rs 100", () => {
    // Verified ITD example: 3,125 -> 3,100
    expect(floor100(3125)).toBe(3100);
    expect(floor100(3100)).toBe(3100);
    expect(floor100(99)).toBe(0);
  });
});

describe("interest234B (golden cases)", () => {
  it("Suraj: 18,400 assessed, no advance, paid 31 Aug -> 920", () => {
    const r = interest234B(
      { assessedTax: 18400, advanceTaxPaid: 0, months: 5 },
      pack,
    );
    expect(r.applies).toBe(true);
    expect(r.interest).toBe(920);
  });

  it("no 234B when advance >= 90% of assessed", () => {
    // Company case: base 2,90,000; paid 2,67,000; 90% = 2,61,000
    const r = interest234B(
      { assessedTax: 290000, advanceTaxPaid: 267000, months: 4 },
      pack,
    );
    expect(r.applies).toBe(false);
    expect(r.interest).toBe(0);
  });
});

describe("interest234C (golden cases)", () => {
  it("Khushal: only Dec short, 119A floor exercised -> 93", () => {
    // liability 45,500; cumulative paid 8,000/19,000/31,000/45,500
    // Dec shortfall 34,125-31,000 = 3,125 -> floor 3,100 -> x1% x3 = 93
    const r = interest234C(
      {
        taxDueOnReturnedIncome: 45500,
        cumulativePaid: [8000, 19000, 31000, 45500],
      },
      pack,
    );
    // Jun: paid 8,000 >= 12% of 45,500 (5,460) -> safe harbor
    expect(r.installments[0]?.safeHarborApplied).toBe(true);
    // Sep: paid 19,000 >= 36% (16,380) -> safe harbor
    expect(r.installments[1]?.safeHarborApplied).toBe(true);
    expect(r.installments[2]?.interest).toBe(93);
    expect(r.installments[3]?.interest).toBe(0);
    expect(r.totalInterest).toBe(93);
  });

  it("company safe-harbor branch -> 605", () => {
    // base 2,90,000: Jun 40,000 >= 12% (34,800) nil; Sep 1,05,000 >= 36% (1,04,400) nil;
    // Dec shortfall 2,17,500-2,05,000 = 12,500 x 3% = 375; Mar 2,90,000-2,67,000 = 23,000 x 1% = 230
    const r = interest234C(
      {
        taxDueOnReturnedIncome: 290000,
        cumulativePaid: [40000, 105000, 205000, 267000],
      },
      pack,
    );
    expect(r.installments[0]?.interest).toBe(0);
    expect(r.installments[1]?.interest).toBe(0);
    expect(r.installments[2]?.interest).toBe(375);
    expect(r.installments[3]?.interest).toBe(230);
    expect(r.totalInterest).toBe(605);
  });

  it("ClearTax below-safe-harbor branch -> 2,600 (shortfall from 15%, not 12%)", () => {
    // liability 1,00,000; paid 5,000/25,000/35,000/50,000
    const r = interest234C(
      {
        taxDueOnReturnedIncome: 100000,
        cumulativePaid: [5000, 25000, 35000, 50000],
      },
      pack,
    );
    // Jun: 5% < 12% -> shortfall from 15,000: 10,000 x 3% = 300
    expect(r.installments[0]?.interest).toBe(300);
    // Sep: 25% < 36% -> shortfall 45,000-25,000 = 20,000 x 3% = 600
    expect(r.installments[1]?.interest).toBe(600);
    // Dec: 75,000-35,000 = 40,000 x 3% = 1,200
    expect(r.installments[2]?.interest).toBe(1200);
    // Mar: 1,00,000-50,000 = 50,000 x 1% = 500
    expect(r.installments[3]?.interest).toBe(500);
    expect(r.totalInterest).toBe(2600);
  });

  it("safe harbor boundary: exactly 12% is nil, 11.99% measures from 15%", () => {
    const base = 100000;
    const atHarbor = interest234C(
      {
        taxDueOnReturnedIncome: base,
        cumulativePaid: [12000, 45000, 75000, 100000],
      },
      pack,
    );
    expect(atHarbor.installments[0]?.interest).toBe(0);
    const below = interest234C(
      {
        taxDueOnReturnedIncome: base,
        cumulativePaid: [11990, 45000, 75000, 100000],
      },
      pack,
    );
    // shortfall = 15,000 - 11,990 = 3,010 -> floor 3,000 -> x3% = 90
    expect(below.installments[0]?.interest).toBe(90);
  });

  it("below 10K liability: not applicable", () => {
    const r = interest234C(
      { taxDueOnReturnedIncome: 9000, cumulativePaid: [0, 0, 0, 0] },
      pack,
    );
    expect(r.applies).toBe(false);
  });

  it("presumptive: single Mar installment, 1 month", () => {
    const r = interest234C(
      {
        taxDueOnReturnedIncome: 50000,
        cumulativePaid: [0, 0, 0, 30000],
        presumptive: true,
      },
      pack,
    );
    expect(r.installments.length).toBe(1);
    // shortfall 20,000 x 1% x 1 = 200
    expect(r.totalInterest).toBe(200);
  });
});

describe("computeHra (golden cases)", () => {
  it("metro vs non-metro (Anwar): 1,62,000 / 1,29,600", () => {
    // salary 3,24,000/yr; HRA 1,80,000; rent 1,94,400
    const base = {
      months: 12,
      basic: 324000,
      hraReceived: 180000,
      rentPaid: 194400,
    };
    const metro = computeHra([{ ...base, isMetro: true }], pack);
    // limbs: A=1,80,000; B=1,94,400-32,400=1,62,000; C=1,62,000 -> 1,62,000
    expect(metro.totalExempt).toBe(162000);
    const nonMetro = computeHra([{ ...base, isMetro: false }], pack);
    // C = 40% = 1,29,600 -> least
    expect(nonMetro.totalExempt).toBe(129600);
  });

  it("salary includes retirement DA + turnover commission (Vinod): 91,200", () => {
    // basic 4,00,000 + DA 80,000 + commission 48,000 = 5,28,000
    // HRA 1,20,000; rent 1,44,000; non-metro
    // limbs: A=1,20,000; B=1,44,000-52,800=91,200; C=2,11,200 -> 91,200
    const r = computeHra(
      [
        {
          months: 12,
          basic: 400000,
          daRetirement: 80000,
          turnoverCommission: 48000,
          hraReceived: 120000,
          rentPaid: 144000,
          isMetro: false,
        },
      ],
      pack,
    );
    expect(r.totalExempt).toBe(91200);
  });

  it("new regime: exemption 0, HRA fully taxable", () => {
    const r = computeHra(
      [
        {
          months: 12,
          basic: 500000,
          hraReceived: 100000,
          rentPaid: 120000,
          isMetro: true,
        },
      ],
      pack,
      "new",
    );
    expect(r.totalExempt).toBe(0);
    expect(r.totalTaxable).toBe(100000);
  });

  it("landlord PAN warning above 1L annual rent", () => {
    const r = computeHra(
      [
        {
          months: 12,
          basic: 600000,
          hraReceived: 200000,
          rentPaid: 150000,
          isMetro: true,
        },
      ],
      pack,
    );
    expect(r.warnings.some((w) => w.includes("landlord PAN"))).toBe(true);
  });

  it("80GG limbs: cap / 25% / rent-excess", () => {
    // cap limb: high income, high rent -> 60,000
    expect(compute80GG(200000, 1000000, pack).deduction).toBe(60000);
    // 25% limb: ATI 2,00,000 -> 50,000 when rent allows
    expect(compute80GG(200000, 200000, pack).deduction).toBe(50000);
    // rent limb: rent 60,000, ATI 1,80,000 -> 60,000-18,000 = 42,000
    expect(compute80GG(60000, 180000, pack).deduction).toBe(42000);
  });
});

describe("old-regime 87A fix", () => {
  const base = {
    regime: "old" as const,
    salaryIncome: 0,
    otherIncome: 0,
    stcg111A: 0,
    ltcg112A: 0,
    deductions: 0,
    ageBand: "below60" as const,
  };

  it("threshold tests TOTAL income: 4.9L normal + 2L LTCG denies the rebate", () => {
    const r = computeTax(
      { ...base, otherIncome: 490000, ltcg112A: 200000 },
      pack,
    );
    // total income 6.9L > 5L -> no 87A even though normal income is under 5L
    expect(r.rebate87A).toBe(0);
  });

  it("87A can offset 111A STCG tax under the old regime", () => {
    // 2L normal (slab tax 0 after nil band... actually 0 since below 2.5L) + 3L STCG under 5L total? No: 2L + 2.5L = 4.5L total
    const r = computeTax(
      { ...base, otherIncome: 200000, stcg111A: 250000 },
      pack,
    );
    // total 4.5L <= 5L -> rebate applies; slab tax 0, STCG tax 50,000 -> rebate min(50,000, 12,500) = 12,500 off STCG
    expect(r.rebate87A).toBe(12500);
    expect(r.stcgTax).toBe(37500);
  });

  it("87A never offsets 112A LTCG tax", () => {
    const r = computeTax(
      { ...base, otherIncome: 200000, ltcg112A: 250000 },
      pack,
    );
    // total 4.5L <= 5L; slab tax 0; LTCG tax (2.5L-1.25L)*12.5% = 15,625 stays
    expect(r.ltcgTax).toBe(15625);
    expect(r.rebate87A).toBe(0);
  });
});

describe("AIS decrypt (synthetic round-trip)", () => {
  function encryptAis(payload: object, password: string): string {
    const iv = randomBytes(16);
    const salt = randomBytes(16);
    const key = pbkdf2Sync(password, salt, 1000, 32, "sha256");
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const ct = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    return iv.toString("hex") + salt.toString("hex") + ct.toString("base64");
  }

  const doc = {
    partA: {
      columnLabel: ["Name", "PAN"],
      columnData: [["Test User", "ABCDE1234F"]],
    },
    partB: {
      sections: [
        {
          title: "TDS/TCS Information",
          elements: [
            {
              title: "Salary (Section 192)",
              l1Src: "EMPLOYER LTD",
              l1: {
                columnLabel: [
                  "TAN",
                  "Amount Paid/Credited",
                  "Tax Deducted",
                  "Date",
                ],
                columnData: [["ABCD12345E", "1500000", "150000", "2026-03-31"]],
              },
            },
          ],
        },
      ],
    },
  };

  it("decrypts with the peppered pan+dob password", () => {
    const pepperedPw = "abcde1234f" + "GQ39%*g" + "01011990";
    const blob = encryptAis(doc, pepperedPw);
    const out = decryptAis(blob, { pan: "ABCDE1234F", dob: "01-01-1990" });
    expect(out).toEqual(doc);
  });

  it("falls back to the un-peppered password", () => {
    const blob = encryptAis(doc, "abcde1234f01011990");
    const out = decryptAis(blob, { pan: "ABCDE1234F", dob: "01011990" });
    expect(out).toEqual(doc);
  });

  it("explicit password wins", () => {
    const blob = encryptAis(doc, "custom-secret");
    const out = decryptAis(blob, { password: "custom-secret" });
    expect(out).toEqual(doc);
  });

  it("fails actionably on a wrong password", () => {
    const blob = encryptAis(doc, "right-password");
    expect(() =>
      decryptAis(blob, { pan: "ABCDE1234F", dob: "02021992" }),
    ).toThrow(AisDecryptError);
  });

  it("parseAisDocument normalizes rows with label-matched fields", () => {
    const parsed = parseAisDocument(doc);
    expect(parsed.taxpayer.PAN).toBe("ABCDE1234F");
    expect(parsed.rows.length).toBe(1);
    const row = parsed.rows[0];
    expect(row?.sectionTitle).toBe("TDS/TCS Information");
    expect(row?.source).toBe("EMPLOYER LTD");
    expect(row?.amount).toBe(1500000);
    expect(row?.date).toBe("2026-03-31");
  });
});

describe("reconcile", () => {
  it("H1: TDS over-claim vs 26AS", () => {
    const r = reconcile(
      {
        form26asTds: [
          {
            tan: "ABCD12345E",
            section: "192",
            amountPaid: 1500000,
            tdsDeposited: 140000,
          },
        ],
        return: { tdsClaimed: 150000 },
      },
      pack,
    );
    const h1 = r.findings.find((f) => f.id === "H1");
    expect(h1?.severity).toBe("high");
    expect(h1?.figures?.delta).toBe(10000);
  });

  it("H3: missing employer Form 16", () => {
    const r = reconcile(
      {
        form26asTds: [
          {
            tan: "AAAA11111A",
            section: "192",
            amountPaid: 800000,
            tdsDeposited: 50000,
          },
          {
            tan: "BBBB22222B",
            section: "192",
            amountPaid: 600000,
            tdsDeposited: 30000,
          },
        ],
        form16: [{ tan: "AAAA11111A", tdsDeposited: 50000 }],
      },
      pack,
    );
    const h3 = r.findings.find((f) => f.id === "H3");
    expect(h3?.title).toContain("BBBB22222B");
  });

  it("H4: AIS interest above declared, Rs 10 slack respected", () => {
    const clean = reconcile(
      { ais: { interestTotal: 50008 }, return: { interestDeclared: 50000 } },
      pack,
    );
    expect(clean.findings.find((f) => f.id === "H4")).toBeUndefined();
    const dirty = reconcile(
      { ais: { interestTotal: 65000 }, return: { interestDeclared: 50000 } },
      pack,
    );
    expect(dirty.findings.find((f) => f.id === "H4")?.severity).toBe("high");
  });

  it("skipped checks are reported with reasons", () => {
    const r = reconcile({}, pack);
    expect(r.findings).toEqual([]);
    expect(r.checksSkipped.length).toBeGreaterThan(0);
    expect(r.checksSkipped.every((s) => s.reason.length > 0)).toBe(true);
  });
});
