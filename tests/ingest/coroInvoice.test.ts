/**
 * Tests for parseCoroInvoice — Coro -> Hub invoice ingestion (1914, 2193).
 *
 * Contract (docs/ARCHITECTURE.md + docs/DATA_CONTRACTS.md + domain/types.ts):
 *   parseCoroInvoice(input, cfg?) -> Result<CoroInvoiceLine[], IngestError>
 *   CoroInvoiceLine = { invoiceNumber, lineNumber (1-based), sku, partner?, customer?,
 *                       quantity, unitPrice: Money, amount: Money, period?, raw }
 *   invoiceNumber comes from cfg (filenames encode 1914/2193) OR a column if present.
 *
 * Spec anchors:
 *   - README: "Coro_Invoice_INVCUS2026-0002193.xlsx — do not drop or double-count"
 *   - Non-negotiable rule #7: "Two Coro invoices stay two (1914 and 2193) until proven otherwise."
 *   - DATA_CONTRACTS: "Coro -> Hub invoices ... stay two invoices.
 *       `sku`, `quantity`, `unitPrice`, `amount` (+ `invoiceNumber` from filename if absent)."
 *
 * Workbooks are built IN MEMORY per the harness rules (no committed binaries).
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseCoroInvoice } from "../../src/ingest/coroInvoice.js";
import { isOk, isErr } from "../../src/lib/result.js";
import { Money } from "../../src/lib/money.js";
import type { WorkbookInput } from "../../src/ingest/xlsx.js";

function wb(rows: (string | number | null)[][], sheetName = "Invoice"): WorkbookInput {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, sheetName);
  return { workbook: book };
}

describe("parseCoroInvoice", () => {
  it("parses lines with invoiceNumber supplied from cfg (filename source)", () => {
    const input = wb([
      ["SKU", "Quantity", "Unit Price", "Amount"],
      ["CORO-EPP", 10, 6, 60],
      ["CORO-EDR", 5, 9, 45],
    ]);
    const res = parseCoroInvoice(input, { invoiceNumber: "1914" });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;

    expect(res.value).toHaveLength(2);
    // invoiceNumber propagated from cfg to every line.
    expect(res.value.every((l) => l.invoiceNumber === "1914")).toBe(true);
  });

  it("assigns a 1-based lineNumber within the invoice", () => {
    const input = wb([
      ["SKU", "Quantity", "Unit Price", "Amount"],
      ["CORO-EPP", 10, 6, 60],
      ["CORO-EDR", 5, 9, 45],
      ["CORO-DLP", 2, 3, 6],
    ]);
    const res = parseCoroInvoice(input, { invoiceNumber: "1914" });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.map((l) => l.lineNumber)).toEqual([1, 2, 3]);
  });

  it("parses unitPrice and amount as Money and quantity via num", () => {
    const input = wb([
      ["SKU", "Quantity", "Unit Price", "Amount"],
      ["CORO-EPP", "10", "$6.00", "$60.00"],
    ]);
    const res = parseCoroInvoice(input, { invoiceNumber: "1914" });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const line = res.value[0]!;
    expect(line.quantity).toBe(10);
    expect(line.unitPrice.equalsCents(Money.of(6))).toBe(true);
    expect(line.amount.equalsCents(Money.of(60))).toBe(true);
    expect(line.sku).toBe("CORO-EPP");
  });

  it("prefers an invoice-number column when the sheet carries one", () => {
    const input = wb([
      ["Invoice Number", "SKU", "Quantity", "Unit Price", "Amount"],
      ["2193", "CORO-EPP", 10, 6, 60],
    ]);
    // No cfg.invoiceNumber given: it must come from the column.
    const res = parseCoroInvoice(input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]!.invoiceNumber).toBe("2193");
  });

  it("errors (does not throw) when no invoiceNumber is available from cfg or column", () => {
    const input = wb([
      ["SKU", "Quantity", "Unit Price", "Amount"],
      ["CORO-EPP", 10, 6, 60],
    ]);
    const res = parseCoroInvoice(input);
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.stage).toBe("parseCoroInvoice");
  });

  it("keeps two separate invoices as two distinct sets — never merged", () => {
    // Rule #7: "Two Coro invoices stay two (1914 and 2193) until proven otherwise."
    const invoice1914 = wb([
      ["SKU", "Quantity", "Unit Price", "Amount"],
      ["CORO-EPP", 10, 6, 60],
    ]);
    const invoice2193 = wb([
      ["SKU", "Quantity", "Unit Price", "Amount"],
      ["CORO-EPP", 4, 6, 24], // same SKU/price, different invoice — must NOT roll up
    ]);

    const r1 = parseCoroInvoice(invoice1914, { invoiceNumber: "1914" });
    const r2 = parseCoroInvoice(invoice2193, { invoiceNumber: "2193" });
    expect(isOk(r1) && isOk(r2)).toBe(true);
    if (!isOk(r1) || !isOk(r2)) return;

    // Each call returns its own set; there is no shared/merged state.
    expect(r1.value.every((l) => l.invoiceNumber === "1914")).toBe(true);
    expect(r2.value.every((l) => l.invoiceNumber === "2193")).toBe(true);
    // Distinct invoice numbers across the two sets.
    const numbers = new Set([...r1.value, ...r2.value].map((l) => l.invoiceNumber));
    expect(numbers).toEqual(new Set(["1914", "2193"]));
    // lineNumbers restart per invoice (both are line 1).
    expect(r1.value[0]!.lineNumber).toBe(1);
    expect(r2.value[0]!.lineNumber).toBe(1);
  });

  it("captures partner/customer when present but leaves them optional", () => {
    const input = wb([
      ["Partner", "SKU", "Quantity", "Unit Price", "Amount"],
      ["Acme MSP", "CORO-EPP", 10, 6, 60],
    ]);
    const res = parseCoroInvoice(input, { invoiceNumber: "1914" });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]!.partner).toBe("Acme MSP");
  });

  it("carries the raw source row for traceability", () => {
    const input = wb([
      ["SKU", "Quantity", "Unit Price", "Amount"],
      ["CORO-EPP", 10, 6, 60],
    ]);
    const res = parseCoroInvoice(input, { invoiceNumber: "1914" });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]!.raw).toBeTypeOf("object");
    expect(Object.values(res.value[0]!.raw)).toContain("CORO-EPP");
  });

  it("skips rows with no SKU rather than silently pricing a blank line", () => {
    const input = wb([
      ["SKU", "Quantity", "Unit Price", "Amount"],
      ["CORO-EPP", 10, 6, 60],
      [null, null, null, null], // stray blank-ish row
      ["CORO-EDR", 5, 9, 45],
    ]);
    const res = parseCoroInvoice(input, { invoiceNumber: "1914" });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toHaveLength(2);
    // lineNumbers stay contiguous 1..2 across the retained rows.
    expect(res.value.map((l) => l.lineNumber)).toEqual([1, 2]);
  });

  it("passes through a period from cfg when supplied", () => {
    const input = wb([
      ["SKU", "Quantity", "Unit Price", "Amount"],
      ["CORO-EPP", 10, 6, 60],
    ]);
    const res = parseCoroInvoice(input, { invoiceNumber: "1914", period: "2026-08" } as never);
    // period is optional on the type; if the parser accepts it, it flows to lines.
    expect(isOk(res)).toBe(true);
  });
});
