/**
 * Coro monthly usage parser.
 *
 * Ingests Coro's ~1st-of-month usage report (the delivered file, e.g.
 * `MSP Hub_August 2026 Usage.xlsx`) into deterministic `UsageLine[]`.
 *
 * Grain (README "Data model"): month + partner + child customer/workspace + SKU.
 * This is the driver file — Dane: "we get a usage report from Coro, we plug it
 * into this." Everything downstream (rating H/L, invoicing, reconciliation)
 * starts here, so this parser must never fabricate or silently drop data.
 *
 * Rules encoded here (DATA_CONTRACTS.md "Coro monthly usage" + README):
 *   - partner REQUIRED — the MSP Hub bills. A populated row with no partner is a
 *     structural problem -> err (never fabricate a partner).
 *   - customer/workspace NULLABLE — child account under the partner ("may be blank").
 *   - sku REQUIRED to price; absent -> class 'noise', vendorSku='' (reviewed, not priced).
 *   - legacy stays VISIBLE — Dane: "legacy, that's an important thing to know."
 *   - quantity is the DRIVER — null coerced to 0 here, kept; zero/neg handled in rating.
 *   - U and D are UNKNOWN — Dane: "I don't really know what U and D mean." Carried raw,
 *     never interpreted.
 *   - No throwing across the boundary — return Result<UsageLine[], IngestError>.
 *
 * Header-row auto-detection, blank-row skipping and cell coercion all live in
 * xlsx.ts (readSheet/str/num/bool); this parser builds ON TOP of it.
 */
import type { ColumnMap } from "../config/pipeline.config.js";
import { USAGE_COLUMN_MAP, resolveColumn } from "../config/pipeline.config.js";
import type { Period, Sku, SkuClass, UnknownField, UsageLine } from "../domain/types.js";
import { type Result, ok, err } from "../lib/result.js";
import {
  type IngestError,
  type RowObject,
  type WorkbookInput,
  bool,
  ingestError,
  loadWorkbook,
  num,
  pickSheet,
  readSheet,
  str,
} from "./xlsx.js";

/**
 * Parse Coro's monthly usage report.
 *
 * @param input a path | buffer | in-memory workbook.
 * @param cfg.columns optional column-alias override (defaults to USAGE_COLUMN_MAP).
 * @param cfg.period REQUIRED accounting period "YYYY-MM" — Dane's machine is month-keyed
 *        and August usage must not masquerade as another month ("Do not pretend later
 *        months are August"). We do NOT read a wall clock; the caller injects the period.
 * @param cfg.sheet optional usage-tab name hint (default: fuzzy "usage", else first sheet).
 */
export function parseUsage(
  input: WorkbookInput,
  cfg?: { columns?: ColumnMap; period?: Period; sheet?: string }
): Result<UsageLine[], IngestError> {
  // Period is required — deterministic month keying, never inferred from a clock.
  const period = cfg?.period;
  if (!period) {
    return err(
      ingestError(
        "parseUsage",
        "period is required (YYYY-MM); pass cfg.period so usage is keyed to the correct month"
      )
    );
  }

  const columns = cfg?.columns ?? USAGE_COLUMN_MAP;

  // 1) Load the workbook (path/buffer/in-memory) — errors surface as Result.
  const wbRes = loadWorkbook(input);
  if (!wbRes.ok) return wbRes;
  const workbook = wbRes.value;

  // 2) Locate the usage tab: fuzzy match cfg.sheet (default "usage"), else first sheet.
  const sheetRes = pickSheet(workbook, cfg?.sheet ?? "usage");
  if (!sheetRes.ok) return sheetRes;
  const sheetName = sheetRes.value;

  // 3) Read the sheet — readSheet auto-detects the header row (title rows above the
  //    header are handled by scoring) and skips fully-blank rows.
  const sheetRes2 = readSheet(workbook, sheetName, columns);
  if (!sheetRes2.ok) return sheetRes2;
  const sheet = sheetRes2.value;

  // 4) Resolve canonical fields -> concrete headers once (plug-and-play aliases).
  const hPartner = resolveColumn(sheet.headers, columns.partner ?? []);
  const hCustomer = resolveColumn(sheet.headers, columns.customer ?? []);
  const hSku = resolveColumn(sheet.headers, columns.sku ?? []);
  const hProduct = resolveColumn(sheet.headers, columns.product ?? []);
  const hSubtype = resolveColumn(sheet.headers, columns.subtype ?? []);
  const hQuantity = resolveColumn(sheet.headers, columns.quantity ?? []);
  const hLegacy = resolveColumn(sheet.headers, columns.legacyFlag ?? []);
  const hU = resolveColumn(sheet.headers, columns.u ?? []);
  const hD = resolveColumn(sheet.headers, columns.d ?? []);

  const lines: UsageLine[] = [];

  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i]!;
    const sourceRow = sheet.sourceRows[i]!;

    // Partner is REQUIRED. readSheet already dropped fully-blank rows, so a row that
    // reached here but lacks a partner is a structural problem — never fabricate one
    // (README: "Do not fabricate a partner").
    const partner = str(row, hPartner);
    if (partner === null) {
      return err(
        ingestError(
          "parseUsage",
          `usage row is missing a required partner (the MSP Hub bills); cannot fabricate one`,
          `sourceRow=${sourceRow}`
        )
      );
    }

    // customer/workspace = child account under the partner; nullable ("may be blank").
    const customer = str(row, hCustomer);

    // SKU: required to price. Absent -> vendorSku='' and (unless legacy-flagged) 'noise'.
    const vendorSku = str(row, hSku) ?? "";
    const isLegacy = bool(row, hLegacy); // legacy flag stays visible regardless of class
    const skuClass = classifySku(vendorSku, isLegacy);

    const product = str(row, hProduct) ?? undefined;
    const sku: Sku = {
      vendorSku,
      class: skuClass,
      isLegacy,
      ...(product !== undefined ? { product } : {}),
    };

    // Quantity is the DRIVER; null -> 0 (kept, never dropped — rating flags zero/neg).
    const quantity = num(row, hQuantity) ?? 0;

    const subtype = str(row, hSubtype) ?? undefined;

    // U and D: carried raw, meaning UNKNOWN, never interpreted.
    const u = unknownField(row, hU);
    const d = unknownField(row, hD);

    lines.push({
      period,
      partner,
      customer,
      sku,
      quantity,
      ...(subtype !== undefined ? { subtype } : {}),
      ...(product !== undefined ? { product } : {}),
      u,
      d,
      raw: { ...row }, // full row object for traceability back to the source file
      sourceRow,
    });
  }

  return ok(lines);
}

/**
 * Classify a usage row's SKU (README + types.ts SkuClass):
 *   - legacy  : the legacy flag is set (Dane: "legacy is an important thing to know").
 *               The flag wins on class so legacy stays visible even for odd rows.
 *   - current : a vendor SKU is present and the row is not legacy-flagged.
 *   - noise   : neither a clean current nor legacy SKU (no SKU, no legacy flag) —
 *               must be reviewed, not silently priced.
 */
function classifySku(vendorSku: string, isLegacy: boolean): SkuClass {
  if (isLegacy) return "legacy";
  return vendorSku ? "current" : "noise";
}

/**
 * Build an UnknownField for U/D — the raw cell value carried verbatim, `known:false`.
 * Preserves the original string|number so downstream code can never misread meaning.
 */
function unknownField(row: RowObject, header: string | null): UnknownField {
  if (!header) return { raw: null, known: false };
  const v = row[header];
  // Only string|number|null are valid raw values; coerce booleans to their raw form
  // is unnecessary here since usage U/D are string/number cells — normalize others to null.
  if (typeof v === "string" || typeof v === "number") return { raw: v, known: false };
  return { raw: null, known: false };
}
