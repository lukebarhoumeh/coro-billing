/**
 * Tests for parseMsrp — Coro MSRP / list pricing ingestion.
 *
 * Contract (docs/ARCHITECTURE.md + docs/DATA_CONTRACTS.md):
 *   parseMsrp(input, cfg?) -> Result<MsrpEntry[], IngestError>
 *   MsrpEntry = { sku, listPrice: Money, raw }
 *
 * Spec anchors:
 *   - README "Copy of 2607-MSRP Pricing.xlsx | List / MSRP. Not Hub cost."
 *   - DATA_CONTRACTS "MSRP ... reference only, never Hub cost. `sku`, `listPrice`."
 *   - Non-negotiable rule #3: "MSRP is never Hub cost." (parser only carries list price.)
 *
 * Workbooks are built IN MEMORY per the harness rules (no committed binaries).
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseMsrp } from "../../src/ingest/msrp.js";
import { isOk, isErr } from "../../src/lib/result.js";
import { Money } from "../../src/lib/money.js";
import type { WorkbookInput } from "../../src/ingest/xlsx.js";

/** Build an in-memory WorkbookInput from an array-of-arrays. */
function wb(rows: (string | number | null)[][], sheetName = "MSRP"): WorkbookInput {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, sheetName);
  return { workbook: book };
}

describe("parseMsrp", () => {
  it("parses sku + listPrice (MSRP) rows", () => {
    const input = wb([
      ["SKU", "MSRP"],
      ["CORO-EPP", 12.5],
      ["CORO-EDR", 20],
    ]);
    const res = parseMsrp(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;

    expect(res.value).toHaveLength(2);
    const [a, b] = res.value;
    expect(a!.sku).toBe("CORO-EPP");
    expect(a!.listPrice.equalsCents(Money.of(12.5))).toBe(true);
    expect(b!.sku).toBe("CORO-EDR");
    expect(b!.listPrice.equalsCents(Money.of(20))).toBe(true);
  });

  it("carries the raw row for traceability", () => {
    const input = wb([
      ["SKU", "List Price"],
      ["CORO-EPP", 12.5],
    ]);
    const res = parseMsrp(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]!.raw).toBeTypeOf("object");
    // The raw record round-trips the source cell so a number stays traceable.
    expect(Object.values(res.value[0]!.raw)).toContain(12.5);
  });

  it("tolerates currency-formatted list prices ($1,234.50)", () => {
    const input = wb([
      ["SKU", "List Price"],
      ["CORO-BIG", "$1,234.50"],
    ]);
    const res = parseMsrp(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]!.listPrice.equalsCents(Money.of("1234.50"))).toBe(true);
  });

  it("skips rows missing a SKU rather than inventing one", () => {
    const input = wb([
      ["SKU", "MSRP"],
      [null, 12.5], // no SKU -> not a priceable MSRP row
      ["CORO-EDR", 20],
    ]);
    const res = parseMsrp(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toHaveLength(1);
    expect(res.value[0]!.sku).toBe("CORO-EDR");
  });

  it("errors (does not throw) when the SKU column is absent", () => {
    const input = wb([
      ["Widget", "MSRP"],
      ["x", 1],
    ]);
    const res = parseMsrp(input);
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.stage).toBe("parseMsrp");
  });

  it("respects a caller-supplied column map override", () => {
    const input = wb([
      ["Item Code", "Retail"],
      ["CORO-EPP", 9.99],
    ]);
    const res = parseMsrp(input, {
      columns: {
        sku: ["item code"],
        listPrice: ["retail"],
      },
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]!.sku).toBe("CORO-EPP");
    expect(res.value[0]!.listPrice.equalsCents(Money.of("9.99"))).toBe(true);
  });
});
