/**
 * REAL-DATA integration test — the August 2026 close against the actual packet.
 *
 * Runs only when `data/2026-08/` holds the real files (they are git-ignored —
 * proprietary Coro financial data — so CI and fresh clones skip this suite).
 *
 * Every pinned number below was OBSERVED from the real files on 2026-09-15 and
 * cross-checked against the invoice's own totals block:
 *   - Total Before Tax  $13,151.64  (the acceptance gate)
 *   - charge total      $16,071.41, of which $460.35 is the two out-of-period
 *     July Rocker lines → in-period billable L = $15,611.06
 * If a future edit changes any of these, the close is WRONG — not the test.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUsage } from "../src/ingest/usage.js";
import { reduceUsage } from "../src/ingest/usageReduce.js";
import { parseCoroInvoice } from "../src/ingest/coroInvoice.js";
import { closeFromInvoice } from "../src/close/invoiceClose.js";
import { buildInvoices } from "../src/invoicing/buildInvoices.js";
import { sum } from "../src/lib/money.js";
import { isOk } from "../src/lib/result.js";

const DATA = join(__dirname, "..", "data", "2026-08");
const USAGE = join(DATA, "MSP Hub_August 2026 Usage.xlsx");
const INV_2193 = join(DATA, "Coro_Invoice_INVCUS2026-0002193.xlsx");
const INV_1914 = join(DATA, "Coro_Invoice_INVCUS2026-0001914.xlsx");

const hasRealData = existsSync(USAGE) && existsSync(INV_2193);

function load(path: string) {
  return { buffer: readFileSync(path) };
}

describe.skipIf(!hasRealData)("August 2026 close — real packet", () => {
  function runClose() {
    const usageRes = parseUsage(load(USAGE), { period: "2026-08" });
    expect(isOk(usageRes)).toBe(true);
    if (!isOk(usageRes)) throw new Error("usage parse failed");
    const reduced = reduceUsage(usageRes.value);

    const invRes = parseCoroInvoice(load(INV_2193), { invoiceNumber: "2193", period: "2026-08" });
    expect(isOk(invRes)).toBe(true);
    if (!isOk(invRes)) throw new Error("invoice parse failed");

    const close = closeFromInvoice(invRes.value, reduced.billed, {
      period: "2026-08",
      invoiceNumber: "2193",
    });
    return { reduced, invoiceLines: invRes.value, ...close };
  }

  it("parses the real usage file: 308 metric rows, every partner slug mapped", () => {
    const usageRes = parseUsage(load(USAGE), { period: "2026-08" });
    if (!isOk(usageRes)) throw new Error("usage parse failed");
    expect(usageRes.value).toHaveLength(308);

    const { billed, exceptions } = reduceUsage(usageRes.value);
    // The curated map covers all 16 August slugs — an unmapped partner here means
    // a new MSP appeared and src/config/partners.ts needs a row.
    expect(exceptions.filter((e) => e.kind === "UNMAPPED_PARTNER")).toHaveLength(0);
    expect(billed.length).toBeGreaterThanOrEqual(140); // 308 metric rows ≈ 154 billed lines
    // Audit cross-check disagreements observed in the real file (warn-level findings).
    expect(exceptions.filter((e) => e.kind === "AUDIT_QTY_MISMATCH")).toHaveLength(8);
  });

  it("parses invoice 2193: 51 line items below the metadata block", () => {
    const invRes = parseCoroInvoice(load(INV_2193), { invoiceNumber: "2193", period: "2026-08" });
    if (!isOk(invRes)) throw new Error("invoice parse failed");
    expect(invRes.value).toHaveLength(51);
    // Every line carries a Client Price (the sheet's own "on hold" total is $0).
    expect(invRes.value.every((l) => l.clientPrice != null)).toBe(true);
  });

  it("THE ACCEPTANCE GATE: allocated H + out-of-period H = $13,151.64 cent-exact", () => {
    const { report } = runClose();
    expect(report.grandTieOk).toBe(true);
    expect(report.invoiceTotalH.toFixed2()).toBe("13151.64");
    expect(report.allocatedH.toFixed2()).toBe("12998.33");
    expect(report.outOfPeriodH.toFixed2()).toBe("153.31");
    expect(report.heldH.toFixed2()).toBe("0.00"); // every 2193 line has L
    expect(report.billableL.toFixed2()).toBe("15611.06"); // 16,071.41 − 460.35 July charges
  });

  it("ties usage to the invoice on all 48 lines that have usage detail", () => {
    const { report } = runClose();
    expect(report.lines).toHaveLength(49);
    expect(report.lines.filter((l) => l.usageQty !== null)).toHaveLength(48);
    expect(report.lines.filter((l) => l.qtyTies)).toHaveLength(48);
    // The single no-usage-detail line is AVOX (invoice-only partner).
    const avox = report.lines.find((l) => l.usageQty === null);
    expect(avox?.partner).toBe("AVOX LLC");
    expect(report.lines.filter((l) => l.held)).toHaveLength(0);
  });

  it("excludes exactly the two July Rocker lines and reports them", () => {
    const { report } = runClose();
    expect(report.outOfPeriod).toHaveLength(2);
    expect(report.outOfPeriod.every((o) => o.partner === "Rocker" && o.servicePeriod === "2026-07")).toBe(true);
    expect(sum(report.outOfPeriod.map((o) => o.amount)).toFixed2()).toBe("153.31");
    expect(report.outOfPeriod.every((o) => /Jul period billed again/.test(o.note ?? ""))).toBe(true);
  });

  it("surfaces consumed-but-unbilled usage (the Vaiman finding) without billing it", () => {
    const { report, rated } = runClose();
    expect(report.usageOnly).toEqual([
      { partner: "Hurricane IT", sku: "COR-COMP-NFR", usageQty: 0 },
      { partner: "Techlead Professional Services LLC", sku: "ADDMDRflex", usageQty: 0 },
      { partner: "Vaiman", sku: "BUCOROflex", usageQty: 50 },
    ]);
    // None of them billed.
    expect(rated.some((r) => r.partner === "Vaiman" || r.partner === "Hurricane IT")).toBe(false);
  });

  it("flags the five negative-margin lines (selling below Coro cost)", () => {
    const { report } = runClose();
    const negative = report.lines.filter((l) => l.margin !== null && l.margin.isNegative());
    expect(negative.map((l) => `${l.partner}/${l.sku}`).sort()).toEqual([
      "Cyber Construction/BUCOCLASSflex",
      "GOA-TECH/BUCOCLASSflex",
      "Net-Tech Consulting/BUCOCLASSflex",
      "Net-Tech Consulting/BUEMAILflex",
      "Teledata Cloud Services/BUENDflex",
    ]);
    expect(negative.every((l) => l.flags.some((f) => /NEGATIVE margin/.test(f)))).toBe(true);
  });

  it("builds 15 outbound MSP invoices whose charges sum to the billable L", () => {
    const { rated } = runClose();
    const billable = rated.filter((r) => !r.exceptions.some((e) => e.severity === "block"));
    const invoices = buildInvoices([...billable], "2026-08");
    expect(invoices).toHaveLength(15);
    expect(sum(invoices.map((i) => i.subtotalCharge)).toFixed2()).toBe("15611.06");
    expect(sum(invoices.map((i) => i.subtotalCost)).toFixed2()).toBe("12998.33");
    // Every partner×SKU H total ties the invoice Subtotal by construction; the
    // invoice-level cost sums prove no cent was gained or lost in allocation.
  });

  it("parses invoice 1914 (July layout, no Client Price column) without new fields", () => {
    if (!existsSync(INV_1914)) return; // 1914 optional for this suite
    const r = parseCoroInvoice(load(INV_1914), { invoiceNumber: "1914", period: "2026-07" });
    if (!isOk(r)) throw new Error("1914 parse failed");
    expect(r.value.length).toBeGreaterThan(0);
    expect(r.value.every((l) => l.invoiceNumber === "1914")).toBe(true);
  });
});
