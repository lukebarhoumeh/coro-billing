/**
 * Tests for the Coro monthly usage parser (src/ingest/usage.ts).
 *
 * These are written TDD-first: they encode the DATA_CONTRACTS.md "Coro monthly
 * usage" table and README rules (U/D unknown, legacy visible, quantity is the
 * driver, never fabricate a partner). Workbooks are built IN MEMORY with SheetJS
 * so no binary fixtures are committed (per ARCHITECTURE.md "Synthetic fixtures").
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import type { WorkbookInput } from "../../src/ingest/xlsx.js";
import { parseUsage } from "../../src/ingest/usage.js";
import { isOk, isErr } from "../../src/lib/result.js";

/** Build an in-memory WorkbookInput from an array-of-arrays and a sheet name. */
function wb(rows: (string | number | boolean | null)[][], sheetName = "Usage"): WorkbookInput {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, sheetName);
  return { workbook: book };
}

describe("parseUsage", () => {
  it("returns err when period is missing", () => {
    const input = wb([
      ["Partner", "Workspace", "SKU", "Quantity"],
      ["Amplivity", "Acme Corp", "CORO-EPP", 5],
    ]);
    const r = parseUsage(input);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.stage).toBe("parseUsage");
      expect(r.error.message).toMatch(/period/i);
    }
  });

  it("auto-detects the header row when a title row sits ABOVE the header", () => {
    // Row 0 is a merged-title-style banner; the real header is row 1.
    const input = wb([
      ["MSP Hub August 2026 Usage — SYNTHETIC", null, null, null, null],
      ["Partner", "Workspace", "SKU", "Legacy", "Quantity"],
      ["Amplivity", "Acme Corp", "CORO-EPP", null, 5],
    ]);
    const r = parseUsage(input, { period: "2026-08" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toHaveLength(1);
      const line = r.value[0]!;
      expect(line.partner).toBe("Amplivity");
      expect(line.customer).toBe("Acme Corp");
      expect(line.sku.vendorSku).toBe("CORO-EPP");
      expect(line.quantity).toBe(5);
      expect(line.period).toBe("2026-08");
      // sourceRow is 1-based; the data row is the 3rd row in the sheet.
      expect(line.sourceRow).toBe(3);
    }
  });

  it("detects the legacy flag and classifies the SKU as legacy", () => {
    const input = wb([
      ["Partner", "Workspace", "SKU", "Legacy", "Quantity"],
      ["Meeting Tree", "Beta LLC", "CORO-LEGACY-1", "Yes", 3],
      ["Meeting Tree", "Gamma Inc", "CORO-EPP", null, 2],
    ]);
    const r = parseUsage(input, { period: "2026-08" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      const legacy = r.value[0]!;
      expect(legacy.sku.isLegacy).toBe(true);
      expect(legacy.sku.class).toBe("legacy");
      const current = r.value[1]!;
      expect(current.sku.isLegacy).toBe(false);
      expect(current.sku.class).toBe("current");
    }
  });

  it("treats a blank customer/workspace as null (partner-level row)", () => {
    const input = wb([
      ["Partner", "Workspace", "SKU", "Quantity"],
      ["Amplivity", null, "CORO-EPP", 5],
      ["Amplivity", "   ", "CORO-XDR", 1],
    ]);
    const r = parseUsage(input, { period: "2026-08" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value[0]!.customer).toBeNull();
      expect(r.value[1]!.customer).toBeNull();
    }
  });

  it("classifies a missing SKU as 'noise' with an empty vendorSku", () => {
    const input = wb([
      ["Partner", "Workspace", "SKU", "Quantity"],
      ["Amplivity", "Acme Corp", null, 4],
    ]);
    const r = parseUsage(input, { period: "2026-08" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      const line = r.value[0]!;
      expect(line.sku.vendorSku).toBe("");
      expect(line.sku.class).toBe("noise");
      expect(line.sku.isLegacy).toBe(false);
    }
  });

  it("classifies a row that IS legacy-flagged but has no SKU as legacy (flag wins on class only when a SKU exists)", () => {
    // A legacy flag with NO vendor sku is still noise for vendorSku purposes,
    // but isLegacy must stay visible per spec ("legacy is an important thing to know").
    const input = wb([
      ["Partner", "Workspace", "SKU", "Legacy", "Quantity"],
      ["Amplivity", "Acme Corp", null, "Yes", 4],
    ]);
    const r = parseUsage(input, { period: "2026-08" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      const line = r.value[0]!;
      expect(line.sku.isLegacy).toBe(true);
      // legacy flag is set, so class is 'legacy' even though vendorSku is empty.
      expect(line.sku.class).toBe("legacy");
      expect(line.sku.vendorSku).toBe("");
    }
  });

  it("carries U and D untouched as unknown fields (never interpreted)", () => {
    const input = wb([
      ["Partner", "Workspace", "SKU", "Quantity", "U", "D"],
      ["Amplivity", "Acme Corp", "CORO-EPP", 5, "abc", 42],
    ]);
    const r = parseUsage(input, { period: "2026-08" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      const line = r.value[0]!;
      expect(line.u).toEqual({ raw: "abc", known: false });
      expect(line.d).toEqual({ raw: 42, known: false });
    }
  });

  it("carries U and D as { raw: null, known: false } when absent", () => {
    const input = wb([
      ["Partner", "Workspace", "SKU", "Quantity"],
      ["Amplivity", "Acme Corp", "CORO-EPP", 5],
    ]);
    const r = parseUsage(input, { period: "2026-08" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      const line = r.value[0]!;
      expect(line.u).toEqual({ raw: null, known: false });
      expect(line.d).toEqual({ raw: null, known: false });
    }
  });

  it("parses quantities with thousands separators (commas)", () => {
    const input = wb([
      ["Partner", "Workspace", "SKU", "Quantity"],
      ["Amplivity", "Acme Corp", "CORO-EPP", "1,250"],
    ]);
    const r = parseUsage(input, { period: "2026-08" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value[0]!.quantity).toBe(1250);
    }
  });

  it("defaults quantity to 0 when the cell is blank (kept, never dropped; rating handles zero/neg)", () => {
    const input = wb([
      ["Partner", "Workspace", "SKU", "Quantity"],
      ["Amplivity", "Acme Corp", "CORO-EPP", null],
    ]);
    const r = parseUsage(input, { period: "2026-08" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toHaveLength(1);
      expect(r.value[0]!.quantity).toBe(0);
    }
  });

  it("returns err (with sourceRow) when a populated row has no partner — never fabricate one", () => {
    const input = wb([
      ["Partner", "Workspace", "SKU", "Quantity"],
      [null, "Orphan Corp", "CORO-EPP", 5],
    ]);
    const r = parseUsage(input, { period: "2026-08" });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.stage).toBe("parseUsage");
      expect(r.error.message).toMatch(/partner/i);
      // sourceRow of the offending row (row 2, 1-based) must be surfaced.
      expect(String(r.error.detail)).toContain("2");
    }
  });

  it("carries product, subtype, and the full raw row for traceability", () => {
    const input = wb([
      ["Partner", "Workspace", "SKU", "Product", "Subtype", "Quantity"],
      ["Amplivity", "Acme Corp", "CORO-EPP", "Endpoint Protection", "subscription", 5],
    ]);
    const r = parseUsage(input, { period: "2026-08" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      const line = r.value[0]!;
      expect(line.product).toBe("Endpoint Protection");
      expect(line.sku.product).toBe("Endpoint Protection");
      expect(line.subtype).toBe("subscription");
      // raw is the full row object keyed by concrete header.
      expect(line.raw["Partner"]).toBe("Amplivity");
      expect(line.raw["Quantity"]).toBe(5);
    }
  });

  it("finds the usage tab by name and falls back to the first sheet", () => {
    // Two sheets: the usage tab is second; cfg.sheet 'usage' should find it fuzzily.
    const ws1 = XLSX.utils.aoa_to_sheet([["notes"], ["ignore me"]]);
    const ws2 = XLSX.utils.aoa_to_sheet([
      ["Partner", "Workspace", "SKU", "Quantity"],
      ["Amplivity", "Acme Corp", "CORO-EPP", 5],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, ws1, "Cover");
    XLSX.utils.book_append_sheet(book, ws2, "Usage Detail");
    const r = parseUsage({ workbook: book }, { period: "2026-08" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toHaveLength(1);
      expect(r.value[0]!.partner).toBe("Amplivity");
    }
  });

  it("propagates the underlying IngestError when the sheet is unreadable", () => {
    // An empty workbook (no sheets) surfaces a structural error, not a throw.
    const book = XLSX.utils.book_new();
    const r = parseUsage({ workbook: book }, { period: "2026-08" });
    expect(isErr(r)).toBe(true);
  });
});
