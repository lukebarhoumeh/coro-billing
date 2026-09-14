/**
 * parseMsrp — Coro MSRP / list pricing ingestion.
 *
 * MSRP is REFERENCE ONLY. README source table: "Copy of 2607-MSRP Pricing.xlsx |
 * List / MSRP. Not Hub cost." and non-negotiable rule #3 (docs/ARCHITECTURE.md):
 * "MSRP is never Hub cost." This parser therefore only ever produces `listPrice`;
 * it deliberately has no concept of Hub cost (H) or MSP price (L). Nothing
 * downstream may treat MsrpEntry.listPrice as a rate — that comes from the
 * per-partner rate card, never from here.
 *
 * Grain (DATA_CONTRACTS.md "MSRP ... reference only"): `sku`, `listPrice`.
 *
 * Builds on the shared xlsx helper (header-row auto-detection + tolerant cell
 * accessors); never touches SheetJS directly. Returns Result — never throws
 * across the boundary.
 */
import type { ColumnMap } from "../config/pipeline.config.js";
import { MSRP_COLUMN_MAP, resolveColumn } from "../config/pipeline.config.js";
import type { MsrpEntry } from "../domain/types.js";
import { Money } from "../lib/money.js";
import type { Result } from "../lib/result.js";
import { err, ok } from "../lib/result.js";
import type { IngestError, WorkbookInput } from "./xlsx.js";
import { ingestError, loadWorkbook, num, pickSheet, readSheet, str } from "./xlsx.js";

const STAGE = "parseMsrp";

export function parseMsrp(
  input: WorkbookInput,
  cfg?: { columns?: ColumnMap }
): Result<MsrpEntry[], IngestError> {
  const columns = cfg?.columns ?? MSRP_COLUMN_MAP;

  const wbRes = loadWorkbook(input);
  if (!wbRes.ok) return wbRes;
  const wb = wbRes.value;

  // MSRP is a single reference list; take the first sheet (header row is
  // auto-detected against the column map by readSheet).
  const sheetRes = pickSheet(wb);
  if (!sheetRes.ok) return err(ingestError(STAGE, sheetRes.error.message, sheetRes.error));

  const sheetDataRes = readSheet(wb, sheetRes.value, columns);
  if (!sheetDataRes.ok) return err(ingestError(STAGE, sheetDataRes.error.message, sheetDataRes.error));
  const sheet = sheetDataRes.value;

  const skuHeader = resolveColumn(sheet.headers, columns.sku ?? []);
  const listPriceHeader = resolveColumn(sheet.headers, columns.listPrice ?? []);

  if (!skuHeader) {
    return err(
      ingestError(
        STAGE,
        `no SKU column found in "${sheet.name}"; headers: ${sheet.headers.join(", ")}. ` +
          `Add an alias in MSRP_COLUMN_MAP.sku (pipeline.config.ts).`
      )
    );
  }
  if (!listPriceHeader) {
    return err(
      ingestError(
        STAGE,
        `no list-price column found in "${sheet.name}"; headers: ${sheet.headers.join(", ")}. ` +
          `Add an alias in MSRP_COLUMN_MAP.listPrice (pipeline.config.ts).`
      )
    );
  }

  const entries: MsrpEntry[] = [];
  for (const row of sheet.rows) {
    const sku = str(row, skuHeader);
    // A row with no SKU is not a priceable MSRP line — skip, never invent a SKU.
    if (sku == null) continue;

    // `num` tolerates "$1,234.50" and comma-grouped values; Money keeps it exact.
    const listNum = num(row, listPriceHeader);
    const listPrice = listNum == null ? Money.zero() : Money.of(listNum);

    entries.push({
      sku,
      listPrice,
      raw: { ...row },
    });
  }

  return ok(entries);
}

// Re-export the type for convenient single-import at call sites.
export type { MsrpEntry };
