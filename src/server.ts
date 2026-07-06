import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scheduleAdvanceTax } from "./engine/advance-tax.js";
import { computeTax, type TaxInput } from "./engine/compute.js";
import { compute80GG, computeHra, type HraPeriod } from "./engine/hra.js";
import { interest234B, interest234C } from "./engine/interest.js";
import { type ReconcileInput, reconcile } from "./engine/reconcile.js";
import { availableYears, DEFAULT_FY, loadRulePack } from "./engine/rulepack.js";
import {
  AisDecryptError,
  decryptAis,
  parseAisDocument,
} from "./parsers/ais.js";
import { parseForm26AS } from "./parsers/form26as.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const taxInputShape = {
  regime: z
    .enum(["new", "old"])
    .describe(
      "Tax regime. 'new' (115BAC) is the default regime since FY 2023-24.",
    ),
  salaryIncome: z
    .number()
    .min(0)
    .default(0)
    .describe("Gross salary income in INR, before standard deduction"),
  otherIncome: z
    .number()
    .min(0)
    .default(0)
    .describe("Other normal-rate income in INR (interest, net rent, etc.)"),
  stcg111A: z
    .number()
    .min(0)
    .default(0)
    .describe(
      "Short-term capital gains under section 111A (listed equity, STT paid) in INR",
    ),
  ltcg112A: z
    .number()
    .min(0)
    .default(0)
    .describe(
      "Long-term capital gains under section 112A in INR, BEFORE the 1.25L exemption",
    ),
  deductions: z
    .number()
    .min(0)
    .default(0)
    .describe(
      "Old regime only: total Chapter VI-A deductions (80C, 80D, ...) in INR. Ignored under the new regime.",
    ),
  ageBand: z
    .enum(["below60", "senior", "superSenior"])
    .default("below60")
    .describe(
      "Age band: below60, senior (60-79), superSenior (80+). Affects old-regime exemption only.",
    ),
  fy: z
    .string()
    .default(DEFAULT_FY)
    .describe("Fiscal year, e.g. '2025-26' (AY 2026-27)"),
};

function toTaxInput(args: {
  regime: "new" | "old";
  salaryIncome: number;
  otherIncome: number;
  stcg111A: number;
  ltcg112A: number;
  deductions: number;
  ageBand: "below60" | "senior" | "superSenior";
}): TaxInput {
  return {
    regime: args.regime,
    salaryIncome: args.salaryIncome,
    otherIncome: args.otherIncome,
    stcg111A: args.stcg111A,
    ltcg112A: args.ltcg112A,
    deductions: args.deductions,
    ageBand: args.ageBand,
  };
}

function ok(structured: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structured, null, 2) },
    ],
    structuredContent: structured as Record<string, unknown>,
  };
}

function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "itr-mcp",
    version: "0.2.0",
  });

  server.registerTool(
    "compute_tax",
    {
      title: "Compute Indian income tax",
      description:
        "Deterministic Indian income tax computation for a fiscal year. Handles new/old regime slabs, standard deduction, 87A rebate with marginal relief, 111A/112A capital gains rates, surcharge (with the 15% cap on gains), and 4% cess. All arithmetic is done in code from a versioned rule pack -- never estimated.",
      inputSchema: taxInputShape,
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        const pack = loadRulePack(args.fy);
        return ok(computeTax(toTaxInput(args), pack));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "compare_regimes",
    {
      title: "Compare old vs new tax regime",
      description:
        "Compute tax under BOTH regimes for the same income and return a side-by-side comparison with the recommended regime and the savings amount. Pass the old-regime deductions you could actually claim; the new regime ignores them.",
      inputSchema: (() => {
        const { regime: _regime, ...rest } = taxInputShape;
        return rest;
      })(),
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        const pack = loadRulePack(args.fy);
        const newTax = computeTax(toTaxInput({ ...args, regime: "new" }), pack);
        const oldTax = computeTax(toTaxInput({ ...args, regime: "old" }), pack);
        const winner = newTax.totalTax <= oldTax.totalTax ? "new" : "old";
        return ok({
          fy: pack.fy,
          newRegime: newTax,
          oldRegime: oldTax,
          recommended: winner,
          savings: Math.abs(newTax.totalTax - oldTax.totalTax),
          disclaimers: newTax.disclaimers,
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "schedule_advance_tax",
    {
      title: "Plan advance tax installments",
      description:
        "Build the advance tax installment plan (Jun 15 / Sep 15 / Dec 15 / Mar 15 at 15/45/75/100%) for an estimated tax liability net of TDS. Reports per-installment amounts and shortfalls against what has been paid so far.",
      inputSchema: {
        estimatedTax: z
          .number()
          .min(0)
          .describe(
            "Estimated total tax liability for the FY in INR (use compute_tax first)",
          ),
        tdsExpected: z
          .number()
          .min(0)
          .default(0)
          .describe("TDS/TCS expected to be deducted during the year in INR"),
        paidSoFar: z
          .array(z.number().min(0))
          .max(4)
          .optional()
          .describe("Advance tax already paid per installment, in order"),
        fy: z
          .string()
          .default(DEFAULT_FY)
          .describe("Fiscal year, e.g. '2025-26'"),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        const pack = loadRulePack(args.fy);
        return ok(
          scheduleAdvanceTax(
            {
              estimatedTax: args.estimatedTax,
              tdsExpected: args.tdsExpected,
              ...(args.paidSoFar ? { paidSoFar: args.paidSoFar } : {}),
            },
            pack,
          ),
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "list_deductions",
    {
      title: "List old-regime deductions",
      description:
        "Return the old-regime deduction checklist with statutory caps for a fiscal year (80C, 80CCD(1B), 80D tiers, 80TTA/TTB, 24(b), HRA metro list). Useful for estimating the `deductions` input to compute_tax/compare_regimes.",
      inputSchema: {
        fy: z
          .string()
          .default(DEFAULT_FY)
          .describe("Fiscal year, e.g. '2025-26'"),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        const pack = loadRulePack(args.fy);
        return ok({
          fy: pack.fy,
          caps: pack.oldRegime.deductionCaps,
          hraMetros: pack.oldRegime.hraMetros,
          notes: [
            "80C cap 1.5L covers PPF, ELSS, EPF, life insurance, principal repayment, tuition fees combined.",
            "80CCD(1B) is an ADDITIONAL 50K for NPS over the 80C cap.",
            "80D: self/family 25K (50K if senior) + parents 25K (50K if senior); preventive checkup 5K sublimit inside the caps.",
            "HRA exemption = least of (actual HRA, rent - 10% salary, 50% salary in metro / 40% non-metro).",
            "None of these apply under the new regime except employer NPS 80CCD(2).",
          ],
          disclaimers: [
            "Not tax advice. Caps are per the FY rule pack; eligibility conditions apply.",
          ],
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "parse_form26as",
    {
      title: "Parse Form 26AS (text export)",
      description:
        "Parse the caret-delimited Form 26AS TEXT export from TRACES into structured TDS entries (deductor, TAN, section, amounts) with totals. Download the 'Text' format from TRACES -- it needs no password. PDF exports are not supported; the text export is more reliable.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Absolute path to the 26AS .txt file downloaded from TRACES",
          ),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      let text: string;
      try {
        text = await readFile(args.path, "utf8");
      } catch {
        return fail(
          `could not read file: ${args.path}. Provide the absolute path to the TRACES Text export (.txt).`,
        );
      }
      const parsed = parseForm26AS(text);
      // PII hygiene: mask PAN in the text mirror; keep it structured.
      const masked = {
        ...parsed,
        pan: parsed.pan
          ? `${parsed.pan.slice(0, 3)}XXXXX${parsed.pan.slice(-1)}`
          : null,
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(masked, null, 2) },
        ],
        structuredContent: parsed as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "parse_ais",
    {
      title: "Parse AIS (Annual Information Statement)",
      description:
        "Decrypt and parse the AIS JSON export from the income tax portal, entirely on-device. Provide pan + dob (DDMMYYYY) to derive the password, or pass it explicitly. Returns taxpayer info and normalized information rows (TDS entries, SFT transactions) with amounts, dates, and codes extracted by column label. The decryption scheme is reverse-engineered from the AIS utility; if it fails, use the portal's CSV export as a fallback and file an issue.",
      inputSchema: {
        path: z
          .string()
          .describe("Absolute path to the downloaded AIS .json file"),
        pan: z
          .string()
          .regex(/^[A-Za-z]{5}\d{4}[A-Za-z]$/)
          .optional()
          .describe("PAN (used to derive the decryption password)"),
        dob: z
          .string()
          .optional()
          .describe(
            "Date of birth as DDMMYYYY (or DD-MM-YYYY); date of incorporation for non-individuals",
          ),
        password: z
          .string()
          .optional()
          .describe(
            "Explicit decryption password (overrides pan+dob derivation)",
          ),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      let text: string;
      try {
        text = await readFile(args.path, "utf8");
      } catch {
        return fail(
          `could not read file: ${args.path}. Provide the absolute path to the AIS JSON download.`,
        );
      }
      try {
        const doc = decryptAis(text, {
          ...(args.pan ? { pan: args.pan } : {}),
          ...(args.dob ? { dob: args.dob } : {}),
          ...(args.password ? { password: args.password } : {}),
        });
        const parsed = parseAisDocument(doc);
        // PII hygiene: mask PAN-like values in the text mirror.
        const masked = JSON.stringify(parsed, null, 2).replace(
          /\b([A-Z]{3})[A-Z]{2}\d{4}([A-Z])\b/g,
          "$1XXXXXX$2",
        );
        return {
          content: [{ type: "text" as const, text: masked }],
          structuredContent: parsed as unknown as Record<string, unknown>,
        };
      } catch (err) {
        if (err instanceof AisDecryptError) return fail(err.message);
        return fail(
          `AIS parse failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    },
  );

  server.registerTool(
    "compute_interest_234",
    {
      title: "Compute 234B/234C interest",
      description:
        "Deterministic sections 234B and 234C interest on advance-tax shortfalls. 234B: 1%/month on assessed-minus-advance when advance < 90% (from 1 April of the AY). 234C: per-installment shortfalls with the statutory 12%/36% safe harbors for June/September. Rule 119A rounding applied (principal floored to Rs 100, part month = full month).",
      inputSchema: {
        assessedTax: z
          .number()
          .min(0)
          .describe("Tax on total income minus TDS/TCS and reliefs, in INR"),
        advanceTaxPaid: z
          .number()
          .min(0)
          .default(0)
          .describe("Total advance tax paid during the FY"),
        monthsFor234B: z
          .number()
          .int()
          .min(0)
          .max(24)
          .default(4)
          .describe(
            "Months from 1 April of the AY to payment/assessment (part month = full month)",
          ),
        cumulativePaid: z
          .array(z.number().min(0))
          .length(4)
          .optional()
          .describe(
            "Cumulative advance tax paid by Jun 15 / Sep 15 / Dec 15 / Mar 15, for 234C",
          ),
        presumptive: z
          .boolean()
          .default(false)
          .describe("44AD/44ADA: single 100% installment by Mar 15"),
        fy: z.string().default(DEFAULT_FY),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        const pack = loadRulePack(args.fy);
        const b = interest234B(
          {
            assessedTax: args.assessedTax,
            advanceTaxPaid: args.advanceTaxPaid,
            months: args.monthsFor234B,
          },
          pack,
        );
        const c = args.cumulativePaid
          ? interest234C(
              {
                taxDueOnReturnedIncome: args.assessedTax,
                cumulativePaid: args.cumulativePaid as [
                  number,
                  number,
                  number,
                  number,
                ],
                ...(args.presumptive ? { presumptive: true } : {}),
              },
              pack,
            )
          : null;
        return ok({
          fy: pack.fy,
          section234B: b,
          section234C: c,
          totalInterest: b.interest + (c?.totalInterest ?? 0),
          disclaimers: [
            "Not tax advice. Capital-gains/dividend 234C exclusions (first proviso) are not auto-applied.",
            "Resident seniors (60+) with no business income owe no advance tax, hence no 234B/234C.",
          ],
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "compute_hra",
    {
      title: "Compute HRA exemption (+80GG)",
      description:
        "HRA exemption per Rule 2A: least of (actual HRA, rent minus 10% of salary, 50% metro / 40% non-metro of salary), computed period-wise. Salary = basic + retirement-forming DA + fixed-percentage turnover commission. Old regime only; metro list for FY 2025-26 is Delhi/Mumbai/Kolkata/Chennai. Also computes the 80GG alternative for rent payers with no HRA.",
      inputSchema: {
        periods: z
          .array(
            z.object({
              months: z.number().int().min(1).max(12),
              basic: z.number().min(0),
              daRetirement: z.number().min(0).optional(),
              turnoverCommission: z.number().min(0).optional(),
              hraReceived: z.number().min(0),
              rentPaid: z.number().min(0),
              isMetro: z.boolean(),
            }),
          )
          .min(1)
          .describe(
            "Homogeneous periods (amounts are per-period totals, not monthly)",
          ),
        regime: z.enum(["old", "new"]).default("old"),
        eightyGG: z
          .object({
            rentPaid: z.number().min(0),
            adjustedTotalIncome: z.number().min(0),
          })
          .optional()
          .describe(
            "Compute 80GG instead (requires: no HRA received at any time in the year)",
          ),
        fy: z.string().default(DEFAULT_FY),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        const pack = loadRulePack(args.fy);
        if (args.eightyGG) {
          return ok(
            compute80GG(
              args.eightyGG.rentPaid,
              args.eightyGG.adjustedTotalIncome,
              pack,
            ),
          );
        }
        return ok(computeHra(args.periods as HraPeriod[], pack, args.regime));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "reconcile_documents",
    {
      title: "Reconcile Form 16 vs AIS vs 26AS",
      description:
        "Cross-document mismatch report -- the checks that pre-empt 143(1)(a) intimations and 139(9) defect notices: TDS claimed vs 26AS deposited (the ledger of record), missing-employer detection, AIS interest/dividend vs declared, Form 16 vs 26AS per-TAN totals. Pass whichever documents you have; checks needing missing inputs are reported as skipped.",
      inputSchema: {
        form26asTds: z
          .array(
            z.object({
              tan: z.string(),
              deductorName: z.string().optional(),
              section: z.string().optional(),
              amountPaid: z.number(),
              tdsDeposited: z.number(),
            }),
          )
          .optional()
          .describe("TDS entries from parse_form26as"),
        form16: z
          .array(
            z.object({
              tan: z.string(),
              grossSalary: z.number().optional(),
              tdsDeposited: z.number(),
            }),
          )
          .optional()
          .describe("Per-employer Form 16 Part A figures"),
        ais: z
          .object({
            salaryByTan: z.record(z.string(), z.number()).optional(),
            interestTotal: z.number().optional(),
            dividendTotal: z.number().optional(),
          })
          .optional()
          .describe("AIS aggregates (from parse_ais rows)"),
        return: z
          .object({
            tdsClaimed: z.number().optional(),
            salaryDeclared: z.number().optional(),
            interestDeclared: z.number().optional(),
            dividendDeclared: z.number().optional(),
          })
          .optional()
          .describe("Figures from the draft return"),
        fy: z.string().default(DEFAULT_FY),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        const pack = loadRulePack(args.fy);
        const input: ReconcileInput = {
          ...(args.form26asTds ? { form26asTds: args.form26asTds } : {}),
          ...(args.form16 ? { form16: args.form16 } : {}),
          ...(args.ais ? { ais: args.ais } : {}),
          ...(args.return ? { return: args.return } : {}),
        };
        return ok(reconcile(input, pack));
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "list_tax_years",
    {
      title: "List supported fiscal years",
      description:
        "List the fiscal years this server has rule packs for, with filing deadlines for the current assessment year.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const pack = loadRulePack(DEFAULT_FY);
      return ok({
        supported: availableYears(),
        default: DEFAULT_FY,
        deadlines: pack.deadlines,
        rulePackVersion: pack.rulePackVersion,
        sources: pack.sources,
      });
    },
  );

  return server;
}
