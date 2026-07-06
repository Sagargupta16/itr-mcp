import type { RulePack } from "./rulepack.js";

/** Cross-document reconciliation: Form 16 vs AIS vs 26AS -- the mismatches
 * that trigger 143(1)(a) intimations and 139(9) defect notices.
 *
 * Authority split (verified): 26AS is the ledger of record for TDS credit
 * (CPC restricts credit to 26AS); AIS is the ledger for income lines;
 * Form 16 anchors salary. */

export interface TdsSummaryEntry {
  tan: string;
  deductorName?: string | undefined;
  section?: string | undefined;
  amountPaid: number;
  tdsDeposited: number;
}

export interface ReconcileInput {
  /** Per-TAN TDS entries from 26AS (the ledger of record). */
  form26asTds?: TdsSummaryEntry[];
  /** Salary TDS per Form 16 Part A, one entry per employer TAN. */
  form16?: {
    tan: string;
    grossSalary?: number | undefined;
    tdsDeposited: number;
  }[];
  /** AIS aggregates the user (or parse_ais) computed. */
  ais?: {
    salaryByTan?: Record<string, number> | undefined;
    interestTotal?: number | undefined;
    dividendTotal?: number | undefined;
  };
  /** Figures from the draft return. */
  return?: {
    tdsClaimed?: number | undefined;
    salaryDeclared?: number | undefined;
    interestDeclared?: number | undefined;
    dividendDeclared?: number | undefined;
  };
}

export interface ReconcileFinding {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  figures?: { a: number; b: number; delta: number };
  remedy: string;
  noticePreempted?: string;
}

export interface ReconcileReport {
  fy: string;
  findings: ReconcileFinding[];
  checksRun: string[];
  checksSkipped: { id: string; reason: string }[];
  disclaimers: string[];
}

function tier(
  delta: number,
  pack: RulePack,
): "pass" | "info" | "warn" | "high" {
  const t = pack.reconcile?.toleranceRupees ?? {
    pass: 10,
    warn: 100,
    high: 10000,
  };
  const d = Math.abs(delta);
  if (d <= t.pass) return "pass";
  if (d < t.warn) return "info";
  if (d < t.high) return "warn";
  return "high";
}

export function reconcile(
  input: ReconcileInput,
  pack: RulePack,
): ReconcileReport {
  const findings: ReconcileFinding[] = [];
  const checksRun: string[] = [];
  const checksSkipped: { id: string; reason: string }[] = [];

  const tds26 = input.form26asTds ?? [];
  const total26asTds = tds26.reduce((s, e) => s + e.tdsDeposited, 0);

  // H1: return TDS claim vs 26AS deposited (exact -- CPC restricts to 26AS)
  if (input.return?.tdsClaimed !== undefined && tds26.length > 0) {
    checksRun.push("H1");
    if (input.return.tdsClaimed > total26asTds) {
      findings.push({
        id: "H1",
        severity: "high",
        title: "TDS claimed in return exceeds 26AS deposited total",
        figures: {
          a: input.return.tdsClaimed,
          b: total26asTds,
          delta: input.return.tdsClaimed - total26asTds,
        },
        remedy:
          "CPC restricts credit to 26AS; the excess claim yields a 143(1) demand. Ask the deductor to revise their TDS return (correction window: 6 years).",
        noticePreempted: "143(1) adjustment",
      });
    }
  } else {
    checksSkipped.push({
      id: "H1",
      reason: "needs return.tdsClaimed + form26asTds",
    });
  }

  // H3: employer TANs in 26AS s.192 vs Form 16s supplied
  const salary26Tans = new Set(
    tds26.filter((e) => e.section === "192").map((e) => e.tan),
  );
  if (salary26Tans.size > 0 && input.form16) {
    checksRun.push("H3");
    const f16Tans = new Set(input.form16.map((f) => f.tan));
    for (const tan of salary26Tans) {
      if (!f16Tans.has(tan)) {
        findings.push({
          id: "H3",
          severity: "high",
          title: `Salary TDS from TAN ${tan} in 26AS has no matching Form 16`,
          remedy:
            "Classic job-switch trigger: salary from a second employer missing from the return. Include ALL employers' salary; get the missing Form 16.",
          noticePreempted: "143(1)(a)(vi)",
        });
      }
    }
  } else {
    checksSkipped.push({
      id: "H3",
      reason: "needs 26AS section-192 rows + form16 list",
    });
  }

  // H4: AIS interest vs declared
  if (
    input.ais?.interestTotal !== undefined &&
    input.return?.interestDeclared !== undefined
  ) {
    checksRun.push("H4");
    const delta = input.ais.interestTotal - input.return.interestDeclared;
    const t = tier(delta, pack);
    if (delta > 0 && t !== "pass") {
      findings.push({
        id: "H4",
        severity: t === "high" ? "high" : "medium",
        title: "AIS interest exceeds interest declared in return",
        figures: {
          a: input.ais.interestTotal,
          b: input.return.interestDeclared,
          delta,
        },
        remedy:
          "Report GROSS accrued interest and claim 80TTA (10K) / 80TTB (50K senior) separately -- netting before reporting triggers 143(1)(a). Joint account? Use AIS feedback 'Information relates to another PAN/Year'.",
        noticePreempted: "143(1)(a)",
      });
    }
  } else {
    checksSkipped.push({
      id: "H4",
      reason: "needs ais.interestTotal + return.interestDeclared",
    });
  }

  // H5: AIS dividend vs declared
  if (
    input.ais?.dividendTotal !== undefined &&
    input.return?.dividendDeclared !== undefined
  ) {
    checksRun.push("H5");
    const delta = input.ais.dividendTotal - input.return.dividendDeclared;
    const t = tier(delta, pack);
    if (delta > 0 && t !== "pass") {
      findings.push({
        id: "H5",
        severity: t === "high" ? "high" : "medium",
        title: "AIS dividend exceeds dividend declared in return",
        figures: {
          a: input.ais.dividendTotal,
          b: input.return.dividendDeclared,
          delta,
        },
        remedy:
          "Report gross dividend (before TDS). Company + RTA duplicates: use AIS feedback 'Information is duplicate / included in other information'.",
        noticePreempted: "143(1)(a)",
      });
    }
  } else {
    checksSkipped.push({
      id: "H5",
      reason: "needs ais.dividendTotal + return.dividendDeclared",
    });
  }

  // M1: Form 16 Part A deposited vs 26AS per TAN (exact)
  if (input.form16 && tds26.length > 0) {
    checksRun.push("M1");
    for (const f16 of input.form16) {
      const from26 = tds26
        .filter((e) => e.tan === f16.tan)
        .reduce((s, e) => s + e.tdsDeposited, 0);
      if (from26 > 0 && f16.tdsDeposited !== from26) {
        findings.push({
          id: "M1",
          severity: "medium",
          title: `Form 16 TDS deposited (TAN ${f16.tan}) differs from 26AS`,
          figures: {
            a: f16.tdsDeposited,
            b: from26,
            delta: f16.tdsDeposited - from26,
          },
          remedy:
            "Deductor filing inconsistency between 24Q and OLTAS -- ask the employer to verify their TDS return.",
        });
      }
    }
  } else {
    checksSkipped.push({ id: "M1", reason: "needs form16 + form26asTds" });
  }

  // M3: Form 16 gross salary vs AIS salary per TAN (gross-to-gross only, Rs 10 slack)
  if (input.form16 && input.ais?.salaryByTan) {
    checksRun.push("M3");
    for (const f16 of input.form16) {
      if (f16.grossSalary === undefined) continue;
      const aisSalary = input.ais.salaryByTan[f16.tan];
      if (aisSalary === undefined) continue;
      const delta = f16.grossSalary - aisSalary;
      if (tier(delta, pack) !== "pass") {
        findings.push({
          id: "M3",
          severity: "medium",
          title: `Form 16 gross salary differs from AIS salary (TAN ${f16.tan})`,
          figures: { a: f16.grossSalary, b: aisSalary, delta },
          remedy:
            "Employer 24Q Annexure-II inconsistency. Compare gross-to-gross only -- never Form 16 taxable salary vs AIS.",
        });
      }
    }
  } else {
    checksSkipped.push({
      id: "M3",
      reason: "needs form16.grossSalary + ais.salaryByTan",
    });
  }

  return {
    fy: pack.fy,
    findings,
    checksRun,
    checksSkipped,
    disclaimers: [
      "Tolerances beyond the Rs 10 statutory rounding slack are tool heuristics, not CPC rules.",
      "A return figure lower than form figures may be legitimately explained by HRA exemption, standard deduction, or Chapter VI-A deductions -- review findings before acting.",
      "Not tax advice. Verify against the official portal before filing.",
    ],
  };
}
