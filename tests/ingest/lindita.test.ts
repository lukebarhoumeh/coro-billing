/**
 * Tests for Lindita's manual August workbook parser — the recreation TARGET.
 *
 * Spec anchors:
 *  - README lines 76-83 / DATA_CONTRACTS "Lindita's August workbook":
 *      column H -> ourPrice ("our price"), column L -> charge ("what we're charging"),
 *      margin "automatically calculated" once H and L exist.
 *  - ARCHITECTURE src/ingest/lindita.ts: "Map column H -> ourPrice, column L -> charge.
 *      If a `margin` column exists, capture it; the reconciler recomputes and cross-checks."
 *  - types.ts LinditaLine: period, partner, customer (nullable), sku, quantity,
 *      ourPrice (Money), charge (Money), margin? (Money), raw, sourceRow.
 *
 * Fixtures are built IN MEMORY with SheetJS (no committed binaries).
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseLinditaWorkbook } from "../../src/ingest/lindita.js";
import { isOk, isErr } from "../../src/lib/result.js";
import { Money } from "../../src/lib/money.js";
import type { WorkbookInput } from "../../src/ingest/xlsx.js";
import type { ColumnMap } from "../../src/config/pipeline.config.js";

/** Build an in-memory WorkbookInput from an array-of-arrays sheet. */
function wb(rows: (string | number | null)[][], sheet = "August"): WorkbookInput {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, sheet);
  return { workbook: book };
}

describe("parseLinditaWorkbook — header detection", () => {
  it("finds the header row even when a title row precedes it", () => {
    const input = wb([
      ["Lindita's Manual August Billing", null, null, null, null, null, null],
      ["Partner", "Customer", "SKU", "Quantity", "Our Price", "What we're charging", "Margin"],
      ["Amplivity", "Acme Corp", "SKU-1", 10, "$5.00", "$9.00", "$40.00"],
    ]);
    const res = parseLinditaWorkbook(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toHaveLength(1);
    expect(res.value[0]!.partner).toBe("Amplivity");
    expect(res.value[0]!.customer).toBe("Acme Corp");
    expect(res.value[0]!.sku).toBe("SKU-1");
    expect(res.value[0]!.quantity).toBe(10);
  });
});

describe("parseLinditaWorkbook — H->ourPrice and L->charge mapping", () => {
  it("maps 'our price' to ourPrice (H) and 'what we're charging' to charge (L)", () => {
    const input = wb([
      ["Partner", "Customer", "SKU", "Quantity", "Our Price", "What we're charging"],
      ["Meeting Tree", "Child WS", "SKU-A", 3, "6.00", "9.00"],
    ]);
    const res = parseLinditaWorkbook(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const line = res.value[0]!;
    // H = our price = Hub cost.
    expect(line.ourPrice.equalsCents(Money.of("6.00"))).toBe(true);
    // L = what we're charging the partner.
    expect(line.charge.equalsCents(Money.of("9.00"))).toBe(true);
  });
});

describe("parseLinditaWorkbook — margin capture", () => {
  it("captures margin as Money when a margin column is present", () => {
    const input = wb([
      ["Partner", "Customer", "SKU", "Quantity", "Our Price", "Charge", "Margin"],
      ["Amplivity", "Acme", "SKU-1", 10, "5.00", "9.00", "40.00"],
    ]);
    const res = parseLinditaWorkbook(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const line = res.value[0]!;
    expect(line.margin).toBeDefined();
    expect(line.margin!.equalsCents(Money.of("40.00"))).toBe(true);
  });

  it("leaves margin undefined when there is no margin column", () => {
    const input = wb([
      ["Partner", "Customer", "SKU", "Quantity", "Our Price", "Charge"],
      ["Amplivity", "Acme", "SKU-1", 10, "5.00", "9.00"],
    ]);
    const res = parseLinditaWorkbook(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]!.margin).toBeUndefined();
  });
});

describe("parseLinditaWorkbook — money parsing", () => {
  it("parses currency-formatted strings like '$1,234.50' exactly", () => {
    const input = wb([
      ["Partner", "Customer", "SKU", "Quantity", "Our Price", "Charge", "Margin"],
      ["Amplivity", "Big Co", "SKU-9", 1, "$1,234.50", "$2,000.00", "$765.50"],
    ]);
    const res = parseLinditaWorkbook(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const line = res.value[0]!;
    expect(line.ourPrice.equalsCents(Money.of("1234.50"))).toBe(true);
    expect(line.charge.equalsCents(Money.of("2000.00"))).toBe(true);
    expect(line.margin!.equalsCents(Money.of("765.50"))).toBe(true);
  });
});

describe("parseLinditaWorkbook — required fields, nullable customer, defaults", () => {
  it("treats customer as null when blank (partner-level row)", () => {
    const input = wb([
      ["Partner", "Customer", "SKU", "Quantity", "Our Price", "Charge"],
      ["Amplivity", null, "SKU-1", 2, "5.00", "9.00"],
    ]);
    const res = parseLinditaWorkbook(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]!.customer).toBeNull();
  });

  it("defaults quantity to 0 when blank", () => {
    const input = wb([
      ["Partner", "Customer", "SKU", "Quantity", "Our Price", "Charge"],
      ["Amplivity", "Acme", "SKU-1", null, "5.00", "9.00"],
    ]);
    const res = parseLinditaWorkbook(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]!.quantity).toBe(0);
  });

  it("errors (Result err, no throw) when partner is missing", () => {
    const input = wb([
      ["Partner", "Customer", "SKU", "Quantity", "Our Price", "Charge"],
      [null, "Acme", "SKU-1", 5, "5.00", "9.00"],
    ]);
    const res = parseLinditaWorkbook(input);
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.stage).toBe("parseLinditaWorkbook");
  });

  it("errors (Result err, no throw) when sku is missing", () => {
    const input = wb([
      ["Partner", "Customer", "SKU", "Quantity", "Our Price", "Charge"],
      ["Amplivity", "Acme", null, 5, "5.00", "9.00"],
    ]);
    const res = parseLinditaWorkbook(input);
    expect(isErr(res)).toBe(true);
  });
});

describe("parseLinditaWorkbook — period, raw, sourceRow", () => {
  it("stamps the period from cfg and defaults to '' when absent", () => {
    const input = wb([
      ["Partner", "Customer", "SKU", "Quantity", "Our Price", "Charge"],
      ["Amplivity", "Acme", "SKU-1", 5, "5.00", "9.00"],
    ]);
    const withPeriod = parseLinditaWorkbook(input, { period: "2026-08" });
    expect(isOk(withPeriod)).toBe(true);
    if (isOk(withPeriod)) expect(withPeriod.value[0]!.period).toBe("2026-08");

    const noPeriod = parseLinditaWorkbook(input);
    expect(isOk(noPeriod)).toBe(true);
    if (isOk(noPeriod)) expect(noPeriod.value[0]!.period).toBe("");
  });

  it("attaches raw row data and a 1-based sourceRow", () => {
    const input = wb([
      ["Partner", "Customer", "SKU", "Quantity", "Our Price", "Charge"],
      ["Amplivity", "Acme", "SKU-1", 5, "5.00", "9.00"],
    ]);
    const res = parseLinditaWorkbook(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const line = res.value[0]!;
    // Header is row 1, first data row is row 2 (1-based).
    expect(line.sourceRow).toBe(2);
    expect(line.raw).toBeTypeOf("object");
    expect(line.raw["Partner"]).toBe("Amplivity");
  });
});

describe("parseLinditaWorkbook — custom column map + sheet selection", () => {
  it("honors a caller-supplied ColumnMap and sheet name", () => {
    const customCols: ColumnMap = {
      partner: ["msp"],
      customer: ["account"],
      sku: ["item"],
      quantity: ["units"],
      ourPrice: ["h"],
      charge: ["l"],
      margin: ["profit"],
    };
    const ws = XLSX.utils.aoa_to_sheet([
      ["MSP", "Account", "Item", "Units", "H", "L", "Profit"],
      ["Globex MSP", "Node One", "SKU-Z", 4, "2.50", "4.00", "6.00"],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws, "Sheet1");
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([["ignore me"]]),
      "Notes"
    );
    const res = parseLinditaWorkbook(
      { workbook: book },
      { columns: customCols, sheet: "Sheet1" }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const line = res.value[0]!;
    expect(line.partner).toBe("Globex MSP");
    expect(line.customer).toBe("Node One");
    expect(line.sku).toBe("SKU-Z");
    expect(line.quantity).toBe(4);
    expect(line.ourPrice.equalsCents(Money.of("2.50"))).toBe(true);
    expect(line.charge.equalsCents(Money.of("4.00"))).toBe(true);
    expect(line.margin!.equalsCents(Money.of("6.00"))).toBe(true);
  });
});

describe("parseLinditaWorkbook — does not throw on unreadable input", () => {
  it("returns an err Result for an empty workbook (no sheets)", () => {
    const book = XLSX.utils.book_new();
    const res = parseLinditaWorkbook({ workbook: book });
    expect(isErr(res)).toBe(true);
  });
});
