/**
 * Tests for the browser file-ingestion layer (web/src/lib/loadFiles.ts).
 * The module is DOM-free by design, so it runs under plain Node vitest.
 */
import { describe, it, expect } from "vitest";
import {
  fingerprintBytes,
  periodFromFileName,
  invoiceNumberFromFileName,
  parseSlotBytes,
  reviewStorageKey,
} from "../../web/src/lib/loadFiles.js";
import { buildRateCardDemo } from "../../fixtures/synthetic/rateCardDemo.js";
import { CONFIRMED_RATES_REVISION } from "../../src/config/confirmedRates.js";
import { isOk } from "../../src/lib/result.js";

describe("fingerprintBytes", () => {
  it("produces the known SHA-256 of 'abc'", async () => {
    const fp = await fingerprintBytes(new TextEncoder().encode("abc"));
    expect(fp).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("periodFromFileName", () => {
  it("reads month-name files", () => {
    expect(periodFromFileName("MSP Hub_August 2026 Usage.xlsx")).toBe("2026-08");
    expect(periodFromFileName("msp hub_September 2026 usage.xlsx")).toBe("2026-09");
  });
  it("reads ISO fragments and returns null when nothing matches", () => {
    expect(periodFromFileName("close-2026-08-final.xlsx")).toBe("2026-08");
    expect(periodFromFileName("whatever.xlsx")).toBeNull();
  });
});

describe("invoiceNumberFromFileName", () => {
  it("extracts the Coro invoice number", () => {
    expect(invoiceNumberFromFileName("Coro_Invoice_INVCUS2026-0002193.xlsx")).toBe(
      "INVCUS2026-0002193"
    );
  });
});

describe("parseSlotBytes", () => {
  it("parses the demo pricing CSV into the pricing slot with a report", () => {
    const demo = buildRateCardDemo();
    const r = parseSlotBytes(
      "pricing",
      "Coro Special MSP Pricing(Special Pricing).csv",
      new TextEncoder().encode(demo.pricingCsv),
      "2026-08"
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.payload.slot).toBe("pricing");
    expect(r.value.report.partners).toBe(3);
    expect(r.value.report.rowsRead).toBeGreaterThan(5);
  });

  it("rejects a wrong-shaped file with a friendly slot-named error", () => {
    const r = parseSlotBytes(
      "pricing",
      "random.csv",
      new TextEncoder().encode("just,some\ngarbage,rows\n"),
      "2026-08"
    );
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    expect(r.error).toMatch(/Special MSP Pricing/);
    expect(r.error).toMatch(/random\.csv/);
  });

  it("survives binary garbage on the usage slot without throwing", () => {
    const r = parseSlotBytes("usage", "noise.xlsx", new Uint8Array([1, 2, 3, 4]), "2026-08");
    expect(isOk(r)).toBe(false);
  });

  it("rejects the monthly usage workbook dropped on the invoice slot (2026-10-28 mixup)", async () => {
    // The real mistake: the October usage workbook on the optional invoice
    // slot. The invoice parser happened to read its Monthly Snapshot tab as
    // 105 lines of $0.00/qty-0 — "worked" on screen, garbage underneath. A
    // Coro tax invoice always carries money, so an all-zero parse must be
    // rejected and point back at the usage slot.
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["#", "Workspace", "NS Subscription", "NS Customer", "Status", "Users", "Devices", "Updated At", "Product", "Product Code", "Product Quantity"],
        [1, "1wireco_I86Q_b", 36140, 45220, "SENT", 41, 0, "Oct 20, 03:03 AM", "CORO_AI_COMPLETE", "COR-COMP-C", 41],
        [2, "albanyitcom_1NMG_b", 26536, 45220, "SENT", 11, 0, "Oct 20, 03:03 AM", "CORO_AI_LITE", "COR-LTE-C", 11],
      ]),
      "Monthly Snapshot"
    );
    const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const r = parseSlotBytes("invoice", "MSP Hub_October 2026 Usage.xlsx", bytes, "2026-10");
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    expect(r.error).toMatch(/does not look like a Coro tax invoice/);
    expect(r.error).toMatch(/usage slot/);
  });
});

describe("reviewStorageKey", () => {
  it("keys on period + truncated fingerprints + confirmed-rates revision", () => {
    // The :rN suffix invalidates approvals when confirmedRates.ts changes the
    // drafted numbers under unchanged input files.
    expect(reviewStorageKey("2026-08", "a".repeat(64), "b".repeat(64))).toBe(
      `coro-close-review:2026-08:${"a".repeat(12)}:${"b".repeat(12)}:r${CONFIRMED_RATES_REVISION}`
    );
  });
});
