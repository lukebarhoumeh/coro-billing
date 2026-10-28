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

describe("parseUsage — per-partner 'by product' export (July 2026 TechLead schema)", () => {
  // Real schema from "Techlead Professional Services, LLC__Usage_July_2026_by_product.xlsx":
  // one row per workspace×product with the BILLED quantity and a "Unit" rule column —
  // no Metric rows, no Audit strings, and the parent is called "MSP Parent".
  const BYPRODUCT_HEADER = [
    "#", "Workspace", "MSP Parent", "Type", "Sub Type", "Billing Mode",
    "Region", "Product", "Product Code", "Quantity", "Unit",
  ];

  it("reads MSP Parent as the partner and Workspace as the customer", () => {
    const r = parseUsage(
      wb([
        BYPRODUCT_HEADER,
        [6, "techlpcom_CKC5_b", "techlpcom_CKC5_b", "CHANNEL", "SUBSCRIPTION", "LEGACY", "US", "CORO_MANAGED_COMPLETE", "BUCOMMNGflex", 7, "users"],
        [7, "accountservices-usacom_HLRC_b", "techlpcom_CKC5_b", "CHILD", "SUBSCRIPTION", "LEGACY", "US", "CORO_MANAGED_COMPLETE", "BUCOMMNGflex", 11, "users"],
        [21, "saneurocom_QIUP_b", "techlpcom_CKC5_b", "CHILD", "SUBSCRIPTION", "LEGACY", "US", "CORO_ESSENTIALS", "BUCOROflex", 10, "math.max(users, devices)"],
      ]),
      { period: "2026-07" }
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value).toHaveLength(3);
    const [channel, child, ess] = r.value;
    expect(channel!.partner).toBe("techlpcom_CKC5_b");
    expect(channel!.customer).toBe("techlpcom_CKC5_b"); // own workspace; reduce folds to null
    expect(channel!.wsType).toBe("CHANNEL");
    expect(channel!.quantity).toBe(7);
    // Quantities are already billed; there is NO metric model in this format —
    // the "Unit" rule column must NOT be mistaken for a Users/Devices metric label.
    expect(channel!.metric).toBeUndefined();
    expect(child!.customer).toBe("accountservices-usacom_HLRC_b");
    expect(ess!.sku.vendorSku).toBe("BUCOROflex");
    expect(ess!.sku.isLegacy).toBe(true); // Billing Mode LEGACY
  });
});

describe("parseUsage — October 2026 delivered workbook (Monthly Snapshot / Aggregation / Usage tabs)", () => {
  // Real schema from "MSP Hub_October 2026 Usage.xlsx" (Lisa's 2026-10-28 email).
  // Coro renamed the Usage-tab headers: the partner is now "Parent" (was "Parent
  // Workspace"), the customer is "End-User (Child) Workspace" (was "Workspace"),
  // the billed quantity is "Product Quantity" (was "Quantity"), and the Metric
  // column is GONE — each (workspace, SKU) appears once, quantity already billed,
  // with the metric rule embedded in the Audit string ("...=41 [users]").
  const OCT_HEADER = [
    "#", "Parent", "End-User (Child) Workspace", "Type", "Sub Type",
    "Billing Mode", "Region", "Audit", "Product", "Product Code", "Product Quantity",
  ];

  /** The delivered file's three tabs — Usage is LAST; pickSheet must find it by name. */
  function octWb(usageRows: (string | number | boolean | null)[][]): WorkbookInput {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["#", "Workspace", "NS Subscription", "NS Customer", "Status", "Users", "Devices", "Updated At", "Product", "Product Code", "Product Quantity"],
        [1, "1wireco_I86Q_b", 36140, 45220, "SENT", 41, 0, "Oct 20, 03:03 AM", "CORO_AI_COMPLETE", "COR-COMP-C", 41],
      ]),
      "Monthly Snapshot"
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["Group Key", "Type", "Billing Mode", "Users", "Devices", "Product", "Product Code", "Product Quantity"],
        ["1wireco_I86Q_b", "CHANNEL", "NEW", 41, 0, "CORO_AI_COMPLETE", "COR-COMP-C", 41],
      ]),
      "Aggregation"
    );
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(usageRows), "Usage");
    return { workbook: book };
  }

  it("parses the renamed headers off the Usage tab (not the first sheet)", () => {
    const r = parseUsage(
      octWb([
        OCT_HEADER,
        [1, "1wireco_I86Q_b", "1wireco_I86Q_b", "CHANNEL", "SUBSCRIPTION", "NEW", "US", "NEW | u=41 d=0 | CORO_AI_COMPLETE=41 [users]", "CORO_AI_COMPLETE", "COR-COMP-C", 41],
        [2, "1wireco_I86Q_b", "3dteethcom_4MOU_b", "CHILD", "SUBSCRIPTION", "LEGACY", "US", "LEGACY | u=22 d=0 | EMAIL_PROTECTION=22 [users]", "EMAIL_PROTECTION", "BUEMAILflex", 22],
        [3, "amplivitycom_NE7N_b", "terryandersontaxescom_T8ZE_b", "CHILD", "SUBSCRIPTION", "NEW", "US", "NEW | u=0 d=3 | CORO_AI_ENDPOINT=3 [secondary: devices + mdmActiveDevicesUsage + mdmInactiveDevicesUsage - users * 3]", "CORO_AI_ENDPOINT", "COR-ENDP-C", 3],
      ]),
      { period: "2026-10" }
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value).toHaveLength(3);
    const [channel, legacyChild, endpoint] = r.value;

    expect(channel!.partner).toBe("1wireco_I86Q_b"); // "Parent" header
    expect(channel!.customer).toBe("1wireco_I86Q_b"); // own workspace; reduce folds to null
    expect(channel!.wsType).toBe("CHANNEL");
    expect(channel!.quantity).toBe(41); // "Product Quantity" header
    expect(channel!.sku.vendorSku).toBe("COR-COMP-C");
    expect(channel!.sku.class).toBe("current");
    // No Metric column — quantities are already billed; audit kept as provenance.
    expect(channel!.metric).toBeUndefined();
    expect(channel!.audit).toBe("NEW | u=41 d=0 | CORO_AI_COMPLETE=41 [users]");

    expect(legacyChild!.customer).toBe("3dteethcom_4MOU_b"); // "End-User (Child) Workspace"
    expect(legacyChild!.sku.isLegacy).toBe(true); // Billing Mode LEGACY
    expect(legacyChild!.sku.class).toBe("legacy");
    expect(legacyChild!.quantity).toBe(22);

    expect(endpoint!.quantity).toBe(3); // the secondary-rule audit row, qty verbatim
  });
});
