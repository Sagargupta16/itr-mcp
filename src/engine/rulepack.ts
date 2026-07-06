import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Slab {
  upTo: number | null;
  rate: number;
}

export interface Rebate87A {
  incomeThreshold: number;
  maxRebate: number;
  marginalRelief: boolean;
  excludesSpecialRateIncome: boolean;
}

export interface RulePack {
  fy: string;
  ay: string;
  rulePackVersion: string;
  sources: string[];
  newRegime: {
    slabs: Slab[];
    standardDeduction: number;
    rebate87A: Rebate87A;
    surchargeCapRate: number;
  };
  oldRegime: {
    slabs: Slab[];
    seniorExemption: number;
    superSeniorExemption: number;
    standardDeduction: number;
    rebate87A: Rebate87A;
    deductionCaps: Record<string, number>;
    hraMetros: string[];
  };
  capitalGains: {
    stcg111A: number;
    ltcg112A: number;
    ltcg112AExemption: number;
    grandfatheringDate: string;
    rateChangeBoundary: string;
    debtSlabAcquisitionBoundary: string;
  };
  surcharge: {
    slabs: { above: number; rate: number }[];
    capitalGainsAndDividendCap: number;
    marginalRelief: boolean;
  };
  cess: number;
  advanceTax: {
    threshold: number;
    installments: { dueDate: string; cumulativePct: number }[];
    interest234C_ratePerMonth: number;
    interest234B_ratePerMonth: number;
    section234B_paidThresholdPct: number;
  };
  deadlines: Record<string, string>;
  lateFee234F: { default: number; incomeUpTo5L: number };
}

// Bundled (dist/index.js) sits one level below the repo root; source
// (src/engine/rulepack.ts) sits two levels below. Probe both.
function resolveDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, "..", "data"),
    join(here, "..", "..", "data"),
  ]) {
    if (existsSync(join(candidate, "fy2025-26.json"))) return candidate;
  }
  throw new Error("data/ directory with rule packs not found");
}

const DATA_DIR = resolveDataDir();

const cache = new Map<string, RulePack>();

/** Load a fiscal-year rule pack (e.g. "2025-26"). Packs live in data/ and are
 * the single source of truth for every number the engine uses. */
export function loadRulePack(fy: string): RulePack {
  const cached = cache.get(fy);
  if (cached) return cached;
  const path = join(DATA_DIR, `fy${fy}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `no rule pack for FY ${fy}. Available: ${availableYears().join(", ")}`,
    );
  }
  const pack = JSON.parse(raw) as RulePack;
  cache.set(fy, pack);
  return pack;
}

export function availableYears(): string[] {
  return ["2025-26"];
}

export const DEFAULT_FY = "2025-26";
