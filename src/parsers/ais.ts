import { createDecipheriv, pbkdf2Sync } from "node:crypto";

/** AIS (Annual Information Statement) JSON parser.
 *
 * The portal's "Download AIS-JSON" export is AES-256-CBC encrypted:
 *   bytes[0:32]  hex-encoded 16-byte IV
 *   bytes[32:64] hex-encoded 16-byte PBKDF2 salt
 *   rest         base64 (or hex) ciphertext
 *   key          PBKDF2-HMAC-SHA256(password, salt, 1000 iters, 32 bytes)
 *
 * The password embeds a fixed app pepper between PAN and DOB. The pepper is
 * reverse-engineered from the AIS utility (verified across 4 independent OSS
 * implementations), NOT ITD-documented -- it can rotate. Un-peppered variants
 * stay in the try-list as a fallback, and `password` overrides everything.
 */

const AIS_PEPPER = "GQ39%*g";

export class AisDecryptError extends Error {}

function passwordCandidates(pan: string, dob: string): string[] {
  const dob8 = dob.replace(/[-/]/g, "");
  return [
    pan.toLowerCase() + AIS_PEPPER + dob8,
    pan.toLowerCase() + dob8,
    pan.toUpperCase() + dob8,
    pan.toUpperCase() + AIS_PEPPER + dob8,
  ];
}

/** Decrypt an AIS JSON export. Throws AisDecryptError with an actionable
 * message when every candidate fails. */
export function decryptAis(
  fileText: string,
  opts: { pan?: string; dob?: string; password?: string },
): unknown {
  let k = fileText.trim();
  // Some exports wrap the payload as a JSON string literal.
  if (k.startsWith('"')) {
    try {
      k = JSON.parse(k) as string;
    } catch {
      // leave as-is
    }
  }

  if (k.length < 96) {
    throw new AisDecryptError(
      "file too short to be an encrypted AIS JSON export (expected hex IV + hex salt + ciphertext)",
    );
  }

  const iv = Buffer.from(k.slice(0, 32), "hex");
  const salt = Buffer.from(k.slice(32, 64), "hex");
  const tail = k.slice(64);

  // A pure-hex string also passes the base64 charset test -- try both decodings.
  const ctCandidates: Buffer[] = [];
  if (/^[A-Za-z0-9+/\r\n]+=*$/.test(tail)) {
    ctCandidates.push(Buffer.from(tail.replace(/[\r\n]/g, ""), "base64"));
  }
  if (/^[0-9a-fA-F\r\n]+$/.test(tail)) {
    ctCandidates.push(Buffer.from(tail.replace(/[\r\n]/g, ""), "hex"));
  }
  if (ctCandidates.length === 0) {
    throw new AisDecryptError(
      "ciphertext is neither base64 nor hex -- is this the AIS JSON download?",
    );
  }

  const passwords = opts.password
    ? [opts.password]
    : opts.pan && opts.dob
      ? passwordCandidates(opts.pan, opts.dob)
      : null;
  if (!passwords) {
    throw new AisDecryptError(
      "provide either `password`, or `pan` + `dob` (DDMMYYYY) to derive it",
    );
  }

  for (const pw of passwords) {
    const key = pbkdf2Sync(pw, salt, 1000, 32, "sha256");
    for (const ct of ctCandidates) {
      try {
        const d = createDecipheriv("aes-256-cbc", key, iv);
        const plaintext = Buffer.concat([d.update(ct), d.final()]);
        return JSON.parse(plaintext.toString("utf8"));
      } catch {
        // wrong candidate -- keep going
      }
    }
  }
  throw new AisDecryptError(
    "decryption failed with every password candidate. The AIS format may have changed -- pass `password` explicitly, or use the CSV export as a fallback and file an issue.",
  );
}

// ---------------------------------------------------------------------------
// Decrypted-document normalization
// ---------------------------------------------------------------------------

/** Labels appear both as plain strings and as {name} objects. */
type AisLabel = string | { name?: string };

interface AisColumnTable {
  columnLabel?: AisLabel[];
  columnData?: unknown[][];
}

interface AisElement extends AisColumnTable {
  title?: string;
  l1Src?: string;
  l2Src?: string;
  l1?: AisColumnTable;
  l2?: AisColumnTable;
}

interface AisSection {
  title?: string;
  elements?: AisElement[];
}

export interface AisRow {
  sectionTitle: string;
  elementTitle: string;
  source: string;
  /** Which table level the row came from (l1/l2/element). */
  level: "l1" | "l2" | "element";
  fields: Record<string, string>;
  amount?: number;
  date?: string;
  code?: string;
}

export interface AisParsed {
  taxpayer: Record<string, string>;
  rows: AisRow[];
  warnings: string[];
}

function labelText(l: AisLabel): string {
  return typeof l === "string" ? l : (l.name ?? "");
}

function tableRows(
  table: AisColumnTable | undefined,
): Record<string, string>[] {
  if (!table?.columnLabel || !table.columnData) return [];
  const labels = table.columnLabel.map(labelText);
  return table.columnData.map((row) => {
    const out: Record<string, string> = {};
    labels.forEach((label, i) => {
      const v = row[i];
      if (label && v !== null && v !== undefined && v !== "")
        out[label] = String(v);
    });
    return out;
  });
}

const AMOUNT_RE = /amount|value/i;
const DATE_RE = /date/i;
const CODE_RE = /information code|sft code|^section$/i;

function enrich(
  row: Record<string, string>,
): Pick<AisRow, "amount" | "date" | "code"> {
  const out: { amount?: number; date?: string; code?: string } = {};
  for (const [label, value] of Object.entries(row)) {
    if (out.amount === undefined && AMOUNT_RE.test(label)) {
      const n = Number.parseFloat(value.replace(/[,\s]/g, ""));
      if (Number.isFinite(n)) out.amount = n;
    }
    if (out.date === undefined && DATE_RE.test(label)) out.date = value;
    if (out.code === undefined && CODE_RE.test(label)) out.code = value;
  }
  return out;
}

/** Normalize a decrypted AIS document into flat rows. Field identity comes
 * from columnLabel strings, matched by regex -- never by position. */
export function parseAisDocument(doc: unknown): AisParsed {
  const warnings: string[] = [];
  const d = doc as {
    partA?: AisColumnTable;
    partB?: { sections?: AisSection[] };
  };

  const taxpayer: Record<string, string> = {};
  const partARows = tableRows(d.partA);
  if (partARows.length === 1 && partARows[0]) {
    Object.assign(taxpayer, partARows[0]);
  } else if (partARows.length > 1) {
    // Some exports transpose partA as Field/Value pairs.
    for (const row of partARows) {
      const values = Object.values(row);
      if (values.length === 2 && values[0] && values[1])
        taxpayer[values[0]] = values[1];
      else Object.assign(taxpayer, row);
    }
  } else {
    warnings.push("partA (taxpayer info) not found or empty");
  }

  const rows: AisRow[] = [];
  const sections = d.partB?.sections ?? [];
  if (sections.length === 0)
    warnings.push("partB.sections is empty -- no information rows");

  for (const section of sections) {
    for (const element of section.elements ?? []) {
      const levels: [
        "l1" | "l2" | "element",
        AisColumnTable | undefined,
        string,
      ][] = [
        ["l1", element.l1, element.l1Src ?? ""],
        ["l2", element.l2, element.l2Src ?? ""],
        ["element", element.l1 || element.l2 ? undefined : element, ""],
      ];
      for (const [level, table, src] of levels) {
        for (const fields of tableRows(table)) {
          rows.push({
            sectionTitle: section.title ?? "",
            elementTitle: element.title ?? "",
            source: src,
            level,
            fields,
            ...enrich(fields),
          });
        }
      }
    }
  }

  return { taxpayer, rows, warnings };
}
