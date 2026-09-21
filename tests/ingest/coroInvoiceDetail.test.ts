/**
 * Tests for the REAL "Invoice Detail" layout of Coro invoice 2193
 * (docs/AUGUST_CLOSE_PLAN.md facts 1–4): metadata block above the table, spacer
 * columns, display-rounded Rate vs authoritative Subtotal, tri-state Client Price,
 * per-line service window (the July "billed again" Rocker lines), totals/notes rows
 * below the table.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseCoroInvoice, parseDateCell } from "../../src/ingest/coroInvoice.js";
import { isOk } from "../../src/lib/result.js";
import type { WorkbookInput } from "../../src/ingest/xlsx.js";

function wb(rows: (string | number | null)[][], sheetName = "Invoice Detail"): WorkbookInput {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, sheetName);
  return { workbook: book };
}

/** A faithful miniature of 2193's Invoice Detail tab. */
function realDetailWorkbook(): WorkbookInput {
  return wb([
    ["Coronet Cyber Security INC - Tax Invoice"],
    [],
    ["Invoice No:", "INVCUS2026-0002193"],
    ["Invoice Date:", "September 1, 2026"],
    ["Due Date:", "October 16, 2026 (Net 45)"],
    ["Bill To:", "MSP Hub - Disti/MSP, North Palm Beach, FL"],
    ["Service Period:", "Aug 1, 2026 - Aug 31, 2026 (two Rocker lines are Jul 1 - Jul 31, 2026)"],
    [],
    // The real header row (spacer columns included).
    ["#", "MSP Parent", "Start Date", "End Date", "Item ID", "Product Name", "Quantity", "Rate", "Discount", "Subtotal", null, "Client Price", "charge", "margin", null, "Note"],
    // Display-rounded Rate: 7 × 4.13 = 28.91, but Coro billed 28.88 (unrounded net rate).
    [1, "XTB Solutions", "Aug 1, 2026", "Aug 31, 2026", "BUENDflex", "ENDPOINT PROTECTION Flex", 7, 4.13, 0.45, 28.88, null, 4.13, 28.91, 0.03, null, null],
    // Clean AI line, L present.
    [2, "BeNe International", "Aug 1, 2026", "Aug 31, 2026", "COR-COMP-C", "CORO AI Complete", 86, 8.25, 0.45, 709.5, null, 12, 1032, 322.5, null, null],
    // BLANK Client Price -> L unresolved (null), never fabricated.
    [3, "GOA-TECH", "Aug 1, 2026", "Aug 31, 2026", "COR-ESS-C", "CORO AI Essentials", 3, 4.13, 0.45, 12.38, null, null, null, null, null, "New in Aug - not on Jul invoice"],
    // July service window on the August invoice (the Rocker case).
    [4, "Rocker", "Jul 1, 2026", "Jul 31, 2026", "BUCOMflex", "CORO COMPLETE Flex", 11, 2.75, 0.45, 30.24, null, 8.25, 90.75, 60.51, null, "Jul period billed again - already on INV-0001914"],
    // Totals block + notes below the table: no Item ID -> never parsed as lines.
    [null, null, null, null, null, "Total Before Tax", 107, null, null, 781, null, null, null, null, null, null],
    [null, null, null, null, null, "Invoice Total", null, null, null, 781, null, null, null, null, null, null],
    ["Note: the Rate column is Coro's displayed rate, rounded to 2 decimals."],
  ]);
}

describe("parseDateCell", () => {
  it("parses the invoice's text dates", () => {
    expect(parseDateCell("Aug 1, 2026")).toBe("2026-08-01");
    expect(parseDateCell("Jul 31, 2026")).toBe("2026-07-31");
    expect(parseDateCell("September 1, 2026")).toBe("2026-09-01");
  });
  it("parses Date objects and ISO strings; rejects garbage", () => {
    expect(parseDateCell(new Date(Date.UTC(2026, 7, 1)))).toBe("2026-08-01");
    expect(parseDateCell("2026-08-01")).toBe("2026-08-01");
    expect(parseDateCell("not a date")).toBeNull();
    expect(parseDateCell(null)).toBeNull();
  });
});

describe("parseCoroInvoice — real Invoice Detail layout", () => {
  it("finds the header row below the metadata block and parses exactly the 4 line items", () => {
    const res = parseCoroInvoice(realDetailWorkbook(), { invoiceNumber: "2193", period: "2026-08" });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toHaveLength(4);
    expect(res.value.map((l) => l.sku)).toEqual(["BUENDflex", "COR-COMP-C", "COR-ESS-C", "BUCOMflex"]);
    expect(res.value.map((l) => l.partner)).toEqual([
      "XTB Solutions",
      "BeNe International",
      "GOA-TECH",
      "Rocker",
    ]);
  });

  it("keeps Subtotal as the authoritative amount (NOT Rate × Qty)", () => {
    const res = parseCoroInvoice(realDetailWorkbook(), { invoiceNumber: "2193" });
    if (!isOk(res)) throw new Error("parse failed");
    const xtb = res.value[0]!;
    expect(xtb.amount.toFixed2()).toBe("28.88"); // billed, not 7 × 4.13 = 28.91
    expect(xtb.unitPrice.toFixed2()).toBe("4.13"); // display rate carried as-is
  });

  it("carries Client Price tri-state: value, blank→null; charge cross-check amount", () => {
    const res = parseCoroInvoice(realDetailWorkbook(), { invoiceNumber: "2193" });
    if (!isOk(res)) throw new Error("parse failed");
    const [xtb, bene, goa] = res.value;
    expect(xtb!.clientPrice?.toFixed2()).toBe("4.13");
    expect(xtb!.chargeAmount?.toFixed2()).toBe("28.91");
    expect(bene!.clientPrice?.toFixed2()).toBe("12.00");
    expect(goa!.clientPrice).toBeNull(); // blank cell = unresolved L
    expect(goa!.chargeAmount).toBeNull();
  });

  it("derives the per-line service period, catching July lines on the August invoice", () => {
    const res = parseCoroInvoice(realDetailWorkbook(), { invoiceNumber: "2193", period: "2026-08" });
    if (!isOk(res)) throw new Error("parse failed");
    expect(res.value.map((l) => l.servicePeriod)).toEqual([
      "2026-08",
      "2026-08",
      "2026-08",
      "2026-07",
    ]);
    const rocker = res.value[3]!;
    expect(rocker.startDate).toBe("2026-07-01");
    expect(rocker.endDate).toBe("2026-07-31");
    expect(rocker.note).toMatch(/Jul period billed again/);
  });

  it("leaves the new fields absent for the simple legacy layout (invoice 1914 / synthetic)", () => {
    const res = parseCoroInvoice(
      wb(
        [
          ["SKU", "Quantity", "Unit Price", "Amount"],
          ["CORO-EPP", 10, 6, 60],
        ],
        "Invoice"
      ),
      { invoiceNumber: "1914" }
    );
    if (!isOk(res)) throw new Error("parse failed");
    const line = res.value[0]!;
    expect(line.clientPrice).toBeUndefined(); // column absent — not null, not zero
    expect(line.servicePeriod).toBeUndefined();
    expect(line.note).toBeUndefined();
  });
});
