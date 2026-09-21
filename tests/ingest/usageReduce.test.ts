/**
 * Tests for the usage metric reduction (src/ingest/usageReduce.ts) and the partner
 * slug map (src/config/partners.ts).
 *
 * Encodes docs/AUGUST_CLOSE_PLAN.md facts 5–6: the real Coro usage file carries each
 * (workspace, SKU) twice (Metric = Users | Devices) with the billed quantity stated
 * in the row's own Audit string; partners are workspace slugs that must map to
 * invoice names through the CURATED map, never fuzzy-matched.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import type { WorkbookInput } from "../../src/ingest/xlsx.js";
import { parseUsage } from "../../src/ingest/usage.js";
import { reduceUsage, parseAuditEntry } from "../../src/ingest/usageReduce.js";
import { canonicalPartner, stripWorkspaceSuffix } from "../../src/config/partners.js";
import { isOk } from "../../src/lib/result.js";

/** Real-file column layout ("Usage" tab of MSP Hub_August 2026 Usage.xlsx). */
const REAL_HEADER = [
  "#",
  "Parent Workspace",
  "Workspace",
  "Type",
  "Sub Type",
  "Billing Mode",
  "Region",
  "Audit",
  "Product",
  "Product Code",
  "Metric",
  "Quantity",
];

function wb(rows: (string | number | boolean | null)[][], sheetName = "Usage"): WorkbookInput {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, ws, sheetName);
  return { workbook: book };
}

function parse(rows: (string | number | boolean | null)[][]) {
  const r = parseUsage(wb([REAL_HEADER, ...rows]), { period: "2026-08" });
  expect(isOk(r)).toBe(true);
  if (!isOk(r)) throw new Error("unreachable");
  return r.value;
}

describe("partners: stripWorkspaceSuffix / canonicalPartner", () => {
  it("strips the Coro workspace id suffix", () => {
    expect(stripWorkspaceSuffix("amplivitycom_NE7N_b")).toBe("amplivitycom");
    expect(stripWorkspaceSuffix("viener4gatescom_1VLM_b")).toBe("viener4gatescom");
    expect(stripWorkspaceSuffix("no-suffix-here")).toBe("no-suffix-here");
  });

  it("maps the curated August slugs, including the non-obvious ones", () => {
    expect(canonicalPartner("amplivitycom_NE7N_b")).toEqual({ name: "Amplivity", mapped: true });
    expect(canonicalPartner("techlpcom_CKC5_b")).toEqual({
      name: "Techlead Professional Services LLC",
      mapped: true,
    });
    expect(canonicalPartner("evolvewithuscom_XXMA_b")).toEqual({
      name: "Evolve Technologies",
      mapped: true,
    });
    expect(canonicalPartner("itnsgroupcom_QUXJ_b")).toEqual({
      name: "IT Network Solutions Group LLC",
      mapped: true,
    });
  });

  it("recognizes an already-canonical invoice name (case-insensitively)", () => {
    expect(canonicalPartner("Amplivity")).toEqual({ name: "Amplivity", mapped: true });
    expect(canonicalPartner("amplivity")).toEqual({ name: "Amplivity", mapped: true });
  });

  it("returns cleaned-but-unmapped for an unknown slug — never guesses", () => {
    const r = canonicalPartner("totally-new-msp_ZZ99_b");
    expect(r.mapped).toBe(false);
    expect(r.name).toBe("totally-new-msp");
  });
});

describe("parseAuditEntry", () => {
  const AUDIT =
    "LEGACY | u=13 d=14 | CORO_ESSENTIALS=14 [math.max(users, devices)] | NETWORK=11 [devices]";

  it("extracts qty + rule per product family", () => {
    expect(parseAuditEntry(AUDIT, "CORO_ESSENTIALS")).toEqual({ qty: 14, rule: "max" });
    expect(parseAuditEntry(AUDIT, "NETWORK")).toEqual({ qty: 11, rule: "devices" });
    expect(parseAuditEntry("LEGACY | u=2 d=4 | CORO_COMPLETE=2 [users]", "CORO_COMPLETE")).toEqual(
      { qty: 2, rule: "users" }
    );
  });

  it("does not confuse product families that share a prefix", () => {
    // CORO_COMPLETE must not match inside MANAGED_CORO_COMPLETE.
    const audit = "LEGACY | MANAGED_CORO_COMPLETE=20 [users] | CORO_COMPLETE=5 [devices]";
    expect(parseAuditEntry(audit, "CORO_COMPLETE")).toEqual({ qty: 5, rule: "devices" });
    expect(parseAuditEntry(audit, "MANAGED_CORO_COMPLETE")).toEqual({ qty: 20, rule: "users" });
  });

  it("returns null when the product is absent or the family is empty", () => {
    expect(parseAuditEntry(AUDIT, "EDR")).toBeNull();
    expect(parseAuditEntry(AUDIT, "")).toBeNull();
  });
});

describe("reduceUsage — real metric model", () => {
  it("collapses a Users/Devices pair per the audit rule and uses Coro's stated qty", () => {
    const audit = "LEGACY | u=13 d=14 | CORO_ESSENTIALS=14 [math.max(users, devices)]";
    const lines = parse([
      [2, "amplivitycom_NE7N_b", "alnobaorg_O2MB_b", "CHILD", "SUBSCRIPTION", "LEGACY", "US", audit, "CORO_ESSENTIALS", "BUCOROflex", "Users", 13],
      [2, "amplivitycom_NE7N_b", "alnobaorg_O2MB_b", "CHILD", "SUBSCRIPTION", "LEGACY", "US", audit, "CORO_ESSENTIALS", "BUCOROflex", "Devices", 14],
    ]);
    const { billed, exceptions } = reduceUsage(lines);
    expect(billed).toHaveLength(1);
    const b = billed[0]!;
    expect(b.partner).toBe("Amplivity");
    expect(b.customer).toBe("alnobaorg_O2MB_b");
    expect(b.sku.vendorSku).toBe("BUCOROflex");
    expect(b.quantity).toBe(14); // max(13, 14) per the audit rule
    expect(b.metric).toBeUndefined(); // metric label dropped after reduction
    expect(b.sku.isLegacy).toBe(true); // Billing Mode LEGACY drives the legacy flag
    expect(exceptions).toHaveLength(0); // stated qty agrees with our reduction
  });

  it("keeps [users]-rule products at the users count even when devices is larger", () => {
    const audit = "LEGACY | u=2 d=4 | CORO_COMPLETE=2 [users]";
    const lines = parse([
      [1, "amplivitycom_NE7N_b", "amplivitycom_NE7N_b", "CHANNEL", "SUBSCRIPTION", "LEGACY", "US", audit, "CORO_COMPLETE", "BUCOMflex", "Users", 2],
      [1, "amplivitycom_NE7N_b", "amplivitycom_NE7N_b", "CHANNEL", "SUBSCRIPTION", "LEGACY", "US", audit, "CORO_COMPLETE", "BUCOMflex", "Devices", 4],
    ]);
    const { billed, exceptions } = reduceUsage(lines);
    expect(billed).toHaveLength(1);
    expect(billed[0]!.quantity).toBe(2);
    // CHANNEL row = the partner's own workspace → partner-level line.
    expect(billed[0]!.customer).toBeNull();
    expect(exceptions).toHaveLength(0);
  });

  it("flags AUDIT_QTY_MISMATCH when Coro's stated qty disagrees with the metrics, and uses the stated qty", () => {
    const audit = "NEW | u=10 d=3 | CORO_AI_COMPLETE=99 [users]";
    const lines = parse([
      [3, "beneintcom_IVAM_b", "beneintcom_IVAM_b", "CHANNEL", "SUBSCRIPTION", "NEW", "US", audit, "CORO_AI_COMPLETE", "COR-COMP-C", "Users", 10],
      [3, "beneintcom_IVAM_b", "beneintcom_IVAM_b", "CHANNEL", "SUBSCRIPTION", "NEW", "US", audit, "CORO_AI_COMPLETE", "COR-COMP-C", "Devices", 3],
    ]);
    const { billed, exceptions } = reduceUsage(lines);
    expect(billed[0]!.quantity).toBe(99); // Coro's stated figure wins (it's their bill)
    const mm = exceptions.filter((e) => e.kind === "AUDIT_QTY_MISMATCH");
    expect(mm).toHaveLength(1);
    expect(mm[0]!.severity).toBe("warn");
    expect(mm[0]!.message).toMatch(/99/);
    expect(mm[0]!.message).toMatch(/10/);
  });

  it("falls back to max(users, devices) with a warning when no audit entry parses", () => {
    const lines = parse([
      [4, "rockerio_PQZJ_b", "childco_AAAA_b", "CHILD", "SUBSCRIPTION", "NEW", "US", "garbage audit", "CORO_AI_LITE", "COR-LTE-C", "Users", 7],
      [4, "rockerio_PQZJ_b", "childco_AAAA_b", "CHILD", "SUBSCRIPTION", "NEW", "US", "garbage audit", "CORO_AI_LITE", "COR-LTE-C", "Devices", 9],
    ]);
    const { billed, exceptions } = reduceUsage(lines);
    expect(billed[0]!.quantity).toBe(9);
    expect(exceptions.some((e) => e.kind === "AUDIT_QTY_MISMATCH" && /fell back/.test(e.message))).toBe(
      true
    );
  });

  it("flags UNMAPPED_PARTNER once per unknown slug and keeps the cleaned slug", () => {
    const audit = "NEW | u=1 d=1 | CORO_AI_LITE=1 [users]";
    const lines = parse([
      [5, "mysteryco_XY12_b", "kid1_AAAA_b", "CHILD", "SUBSCRIPTION", "NEW", "US", audit, "CORO_AI_LITE", "COR-LTE-C", "Users", 1],
      [5, "mysteryco_XY12_b", "kid1_AAAA_b", "CHILD", "SUBSCRIPTION", "NEW", "US", audit, "CORO_AI_LITE", "COR-LTE-C", "Devices", 1],
      [6, "mysteryco_XY12_b", "kid2_BBBB_b", "CHILD", "SUBSCRIPTION", "NEW", "US", audit, "CORO_AI_LITE", "COR-LTE-C", "Users", 1],
      [6, "mysteryco_XY12_b", "kid2_BBBB_b", "CHILD", "SUBSCRIPTION", "NEW", "US", audit, "CORO_AI_LITE", "COR-LTE-C", "Devices", 1],
    ]);
    const { billed, exceptions } = reduceUsage(lines);
    expect(billed.every((b) => b.partner === "mysteryco")).toBe(true);
    expect(exceptions.filter((e) => e.kind === "UNMAPPED_PARTNER")).toHaveLength(1);
  });

  it("separates customers: same partner + SKU across two children stays two billed lines", () => {
    const a1 = "LEGACY | u=3 d=4 | CORO_ESSENTIALS=4 [math.max(users, devices)]";
    const a2 = "LEGACY | u=1 d=2 | CORO_ESSENTIALS=2 [math.max(users, devices)]";
    const lines = parse([
      [7, "amplivitycom_NE7N_b", "loudcanvascom_ZHMM_b", "CHILD", "SUBSCRIPTION", "LEGACY", "US", a1, "CORO_ESSENTIALS", "BUCOROflex", "Users", 3],
      [7, "amplivitycom_NE7N_b", "loudcanvascom_ZHMM_b", "CHILD", "SUBSCRIPTION", "LEGACY", "US", a1, "CORO_ESSENTIALS", "BUCOROflex", "Devices", 4],
      [8, "amplivitycom_NE7N_b", "brandastaxescom_C6BS_b", "CHILD", "SUBSCRIPTION", "LEGACY", "US", a2, "CORO_ESSENTIALS", "BUCOROflex", "Users", 1],
      [8, "amplivitycom_NE7N_b", "brandastaxescom_C6BS_b", "CHILD", "SUBSCRIPTION", "LEGACY", "US", a2, "CORO_ESSENTIALS", "BUCOROflex", "Devices", 2],
    ]);
    const { billed } = reduceUsage(lines);
    expect(billed).toHaveLength(2);
    expect(billed.map((b) => b.quantity)).toEqual([4, 2]);
  });
});

describe("reduceUsage — pass-through for non-metric files", () => {
  it("leaves synthetic-format lines intact (quantities already billed), mapping partners only", () => {
    const r = parseUsage(
      wb([
        ["Partner", "Workspace", "SKU", "Quantity"],
        ["Amplivity", "Acme Corp", "CORO-EPP", 5],
        ["Meeting Tree Computer", "Beta LLC", "CORO-EPP", 3],
      ]),
      { period: "2026-08" }
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const { billed, exceptions } = reduceUsage(r.value);
    expect(billed).toHaveLength(2);
    expect(billed.map((b) => b.quantity)).toEqual([5, 3]);
    expect(billed[0]!.partner).toBe("Amplivity");
    expect(exceptions.filter((e) => e.kind === "AUDIT_QTY_MISMATCH")).toHaveLength(0);
  });
});
