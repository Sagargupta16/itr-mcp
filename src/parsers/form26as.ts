/** Parser for the caret-delimited Form 26AS text export from TRACES.
 * Users should download the "Text" format -- it needs no password and is the
 * most machine-readable of the three export formats. */

export interface TdsEntry {
  deductorName: string;
  tan: string;
  section: string;
  amountPaid: number;
  taxDeducted: number;
  tdsDeposited: number;
}

export interface Form26AS {
  pan: string | null;
  assessmentYear: string | null;
  /** Part I: TDS on salary and other payments, grouped by deductor. */
  tdsEntries: TdsEntry[];
  totalTdsDeposited: number;
  totalAmountPaid: number;
  warnings: string[];
}

function num(field: string | undefined): number {
  if (!field) return 0;
  const cleaned = field.replace(/[,\s]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/;
const PAN_RE = /\b([A-Z]{5}\d{4}[A-Z])\b/;
const AY_RE = /Assessment Year[:^\s]*(\d{4}-\d{2})/i;
const SECTION_RE = /^\d{3}[A-Z]{0,3}$/;

/** Parse the caret-delimited 26AS text. Tolerant: unknown lines are skipped,
 * structural surprises land in warnings[] instead of throwing. */
export function parseForm26AS(text: string): Form26AS {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);

  const pan = PAN_RE.exec(text)?.[1] ?? null;
  const assessmentYear = AY_RE.exec(text)?.[1] ?? null;
  if (!pan) warnings.push("PAN not found in header");
  if (!assessmentYear) warnings.push("assessment year not found in header");

  const tdsEntries: TdsEntry[] = [];
  let currentDeductor: { name: string; tan: string } | null = null;

  for (const line of lines) {
    if (!line.includes("^")) continue;
    const fields = line.split("^").map((f) => f.trim());

    // Deductor header rows carry a TAN; transaction rows carry a section code.
    const tanIdx = fields.findIndex((f) => TAN_RE.test(f));
    const sectionIdx = fields.findIndex((f) => SECTION_RE.test(f));

    if (tanIdx !== -1) {
      const name = fields.find(
        (f, i) => i !== tanIdx && f.length > 3 && !/^\d/.test(f),
      );
      currentDeductor = {
        name: name ?? "(unknown)",
        tan: fields[tanIdx] ?? "",
      };
      // Deductor summary rows also carry totals; per-transaction rows below
      // are what we aggregate, so nothing else to read here.
      continue;
    }

    if (sectionIdx !== -1 && currentDeductor) {
      // Transaction row layout: ... section ... amounts are the trailing
      // numeric fields (amount paid, tax deducted, TDS deposited).
      const numerics = fields
        .filter((f) => /^[\d,]+\.?\d*$/.test(f))
        .map((f) => num(f));
      if (numerics.length >= 3) {
        tdsEntries.push({
          deductorName: currentDeductor.name,
          tan: currentDeductor.tan,
          section: fields[sectionIdx] ?? "",
          amountPaid: numerics[numerics.length - 3] ?? 0,
          taxDeducted: numerics[numerics.length - 2] ?? 0,
          tdsDeposited: numerics[numerics.length - 1] ?? 0,
        });
      }
    }
  }

  if (tdsEntries.length === 0) {
    warnings.push(
      "no TDS transaction rows recognized -- confirm this is the TRACES Text export (not PDF-to-text)",
    );
  }

  return {
    pan,
    assessmentYear,
    tdsEntries,
    totalTdsDeposited: Math.round(
      tdsEntries.reduce((s, e) => s + e.tdsDeposited, 0),
    ),
    totalAmountPaid: Math.round(
      tdsEntries.reduce((s, e) => s + e.amountPaid, 0),
    ),
    warnings,
  };
}
