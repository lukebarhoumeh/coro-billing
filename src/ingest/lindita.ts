/**
 * Parser for Lindita's manual August billing workbook — the recreation TARGET.
 *
 * This file is *hers*, not the file Coro delivers (README: "this one is all
 * Lindita" vs "this is the one that gets delivered to us"). It is how Hub figures
 * the bill by hand today; the whole point of the pipeline is to reproduce it
 * automatically and then diff against it (README §"Recreate August vs Lindita").
 *
 * The two load-bearing columns, in Dane's own words (README lines 76-83):
 *   - column **H** = "our price" = Hub's cost / our rate  -> LinditaLine.ourPrice
 *   - column **L** = "what we're charging" (the partner)  -> LinditaLine.charge
 *   - margin is "automatically calculated" once H and L exist. We capture it when
 *     present so the reconciler can recompute and cross-check (ARCHITECTURE
 *     src/reconcile/august.ts), and leave it undefined when the sheet omits it.
 *
 * Rules honored here:
 *   - No throwing across the boundary: every failure is a Result err with an
 *     IngestError (see src/lib/result.ts rationale — "every failure must be
 *     visible and traceable, never a thrown surprise deep in a parser").
 *   - Money via the Money class only; parsing "$1,234.50" is delegated to the
 *     shared `num` accessor which strips $/,/% and handles parenthesized negatives.
 *   - partner + sku are required (they are the join keys for reconciliation);
 *     customer is nullable (partner-level rows), quantity defaults to 0.
 *   - raw + sourceRow are attached for traceability back to the source sheet.
 */
import type { WorkbookInput, SheetData, IngestError } from "./xlsx.js";
import { loadWorkbook, pickSheet, readSheet, str, num, ingestError } from "./xlsx.js";
import type { ColumnMap } from "../config/pipeline.config.js";
import { LINDITA_COLUMN_MAP, resolveColumn } from "../config/pipeline.config.js";
import type { LinditaLine, Period } from "../domain/types.js";
import { Money } from "../lib/money.js";
import type { Result } from "../lib/result.js";
import { ok, err } from "../lib/result.js";

const STAGE = "parseLinditaWorkbook";

/**
 * Parse Lindita's manual workbook into LinditaLine[].
 *
 * @param input  path | buffer | in-memory WorkBook (tests build workbooks in memory).
 * @param cfg.columns  header alias map; defaults to LINDITA_COLUMN_MAP so real
 *                     files stay "plug and play" (edit aliases in config, not code).
 * @param cfg.period   accounting period stamp; defaults to "" per the module contract.
 * @param cfg.sheet    optional sheet name to target (exact, then fuzzy, then first).
 */
export function parseLinditaWorkbook(
  input: WorkbookInput,
  cfg?: { columns?: ColumnMap; period?: Period; sheet?: string }
): Result<LinditaLine[], IngestError> {
  const columns = cfg?.columns ?? LINDITA_COLUMN_MAP;
  const period: Period = cfg?.period ?? "";

  // Load workbook (never throws — Result out).
  const wbRes = loadWorkbook(input);
  if (!wbRes.ok) return wbRes;
  const wb = wbRes.value;

  // Pick the target sheet (exact -> fuzzy -> first).
  const sheetRes = pickSheet(wb, cfg?.sheet);
  if (!sheetRes.ok) return sheetRes;

  // Read the sheet, auto-detecting the header row via the column map.
  const sheetRes2 = readSheet(wb, sheetRes.value, columns);
  if (!sheetRes2.ok) return sheetRes2;
  const sheet: SheetData = sheetRes2.value;

  // Resolve canonical fields -> concrete headers once, up front.
  const hPartner = resolveColumn(sheet.headers, columns.partner ?? []);
  const hCustomer = resolveColumn(sheet.headers, columns.customer ?? []);
  const hSku = resolveColumn(sheet.headers, columns.sku ?? []);
  const hQty = resolveColumn(sheet.headers, columns.quantity ?? []);
  const hOurPrice = resolveColumn(sheet.headers, columns.ourPrice ?? []); // column H
  const hCharge = resolveColumn(sheet.headers, columns.charge ?? []); // column L
  const hMargin = resolveColumn(sheet.headers, columns.margin ?? []); // optional

  const lines: LinditaLine[] = [];

  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i]!;
    const sourceRow = sheet.sourceRows[i]!;

    // partner is a required join key (README: bill is per partner/MSP).
    const partner = str(row, hPartner);
    if (partner === null) {
      return err(
        ingestError(
          STAGE,
          `missing required "partner" at source row ${sourceRow}`,
          { sourceRow, raw: row }
        )
      );
    }

    // sku is a required join key (reconciliation joins on partner+customer+sku).
    const sku = str(row, hSku);
    if (sku === null) {
      return err(
        ingestError(
          STAGE,
          `missing required "sku" at source row ${sourceRow}`,
          { sourceRow, raw: row }
        )
      );
    }

    // customer = child workspace; nullable for partner-level rows.
    const customer = str(row, hCustomer);

    // quantity is the bill driver; default to 0 when blank (kept, not dropped).
    const quantity = num(row, hQty) ?? 0;

    // H -> ourPrice (Hub cost). Blank => Money.zero(); the reconciler compares
    // cent-exact, and rate-card gaps surface in rating, not here.
    const ourPrice = Money.of(num(row, hOurPrice) ?? 0);
    // L -> charge (what we're charging the partner).
    const charge = Money.of(num(row, hCharge) ?? 0);

    // margin: capture only when the column exists AND has a value; otherwise leave
    // undefined so the reconciler recomputes it ("automatically calculated").
    let margin: Money | undefined;
    if (hMargin !== null) {
      const m = num(row, hMargin);
      if (m !== null) margin = Money.of(m);
    }

    const line: LinditaLine = {
      period,
      partner,
      customer,
      sku,
      quantity,
      ourPrice,
      charge,
      ...(margin !== undefined ? { margin } : {}),
      raw: { ...row },
      sourceRow,
    };
    lines.push(line);
  }

  return ok(lines);
}
