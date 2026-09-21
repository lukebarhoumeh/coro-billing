/**
 * Tests for the invoice-driven close (src/close/invoiceClose.ts) and the
 * largest-remainder allocator (src/lib/allocate.ts).
 *
 * Encodes docs/AUGUST_CLOSE_PLAN.md decisions D1–D5 and the acceptance gates:
 * Subtotal is the authoritative H (never Rate × Qty), per-customer cents always
 * sum to the invoice line, blank L holds the line, out-of-period lines are
 * excluded but tie into the grand total, usage disagreements are findings.
 */
import { describe, it, expect } from "vitest";
import { Money, sum } from "../../src/lib/money.js";
import { allocateInteger, allocateCents } from "../../src/lib/allocate.js";
import { closeFromInvoice, classifyInvoiceSku } from "../../src/close/invoiceClose.js";
import type { CoroInvoiceLine, UsageLine } from "../../src/domain/types.js";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function inv(partial: {
  partner: string;
  sku: string;
  qty: number;
  rate: number;
  subtotal: number;
  clientPrice?: number | null;
  charge?: number | null;
  servicePeriod?: string;
  startDate?: string;
  endDate?: string;
  note?: string;
  lineNumber?: number;
  invoiceNumber?: string;
  productName?: string;
}): CoroInvoiceLine {
  return {
    invoiceNumber: partial.invoiceNumber ?? "2193",
    lineNumber: partial.lineNumber ?? 1,
    sku: partial.sku,
    partner: partial.partner,
    quantity: partial.qty,
    unitPrice: Money.of(partial.rate),
    amount: Money.of(partial.subtotal),
    ...(partial.clientPrice !== undefined
      ? { clientPrice: partial.clientPrice === null ? null : Money.of(partial.clientPrice) }
      : {}),
    ...(partial.charge !== undefined
      ? { chargeAmount: partial.charge === null ? null : Money.of(partial.charge) }
      : {}),
    ...(partial.servicePeriod !== undefined ? { servicePeriod: partial.servicePeriod } : {}),
    ...(partial.startDate !== undefined ? { startDate: partial.startDate } : {}),
    ...(partial.endDate !== undefined ? { endDate: partial.endDate } : {}),
    ...(partial.note !== undefined ? { note: partial.note } : {}),
    ...(partial.productName !== undefined ? { productName: partial.productName } : {}),
    raw: {},
  };
}

function usage(partner: string, customer: string | null, sku: string, qty: number, opts?: { legacy?: boolean; sourceRow?: number }): UsageLine {
  const legacy = opts?.legacy ?? /flex$/i.test(sku);
  return {
    period: "2026-08",
    partner,
    customer,
    sku: { vendorSku: sku, class: legacy ? "legacy" : "current", isLegacy: legacy },
    quantity: qty,
    u: { raw: null, known: false },
    d: { raw: null, known: false },
    raw: {},
    sourceRow: opts?.sourceRow ?? 2,
  };
}

const OPTS = { period: "2026-08", invoiceNumber: "2193" } as const;

// ---------------------------------------------------------------------------
// allocateInteger / allocateCents
// ---------------------------------------------------------------------------

describe("allocateInteger", () => {
  it("splits proportionally and always sums to the total", () => {
    expect(allocateInteger(10, [1, 1])).toEqual([5, 5]);
    expect(allocateInteger(10, [2, 1])).toEqual([7, 3]);
    // Classic largest-remainder case: 100 into thirds.
    const thirds = allocateInteger(100, [1, 1, 1]);
    expect(thirds.reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.max(...thirds) - Math.min(...thirds)).toBeLessThanOrEqual(1);
  });

  it("is deterministic on ties (larger weight first, then lower index)", () => {
    expect(allocateInteger(1, [1, 1])).toEqual([1, 0]);
    expect(allocateInteger(3, [1, 1])).toEqual([2, 1]);
  });

  it("handles degenerate inputs", () => {
    expect(allocateInteger(5, [])).toEqual([]);
    expect(allocateInteger(5, [0, 0])).toEqual([5, 0]); // all-zero weights → bucket 0
    expect(allocateInteger(0, [3, 7])).toEqual([0, 0]);
    expect(allocateInteger(-6, [1, 2])).toEqual([-2, -4]); // credit lines keep the sum
  });

  it("rejects programming errors", () => {
    expect(() => allocateInteger(1.5, [1])).toThrow(/integer/);
    expect(() => allocateInteger(1, [-1])).toThrow(/non-negative/);
  });

  it("never loses a unit across many random-ish shapes", () => {
    // Deterministic pseudo-grid (no RNG): totals × weight shapes.
    for (let total = 0; total <= 57; total += 3) {
      for (const weights of [[1], [1, 2, 3], [5, 0, 5], [13, 14], [7, 7, 7, 7], [1, 999]]) {
        const parts = allocateInteger(total, weights);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(parts.every((p) => p >= 0)).toBe(true);
      }
    }
  });
});

describe("allocateCents", () => {
  it("splits Money cent-exact (the 28.88 landmine shape)", () => {
    const parts = allocateCents(Money.of(28.88), [3, 4]);
    expect(sum(parts).toFixed2()).toBe("28.88");
    expect(parts.map((p) => p.toFixed2())).toEqual(["12.38", "16.50"]);
  });
});

// ---------------------------------------------------------------------------
// closeFromInvoice
// ---------------------------------------------------------------------------

describe("closeFromInvoice — allocation", () => {
  it("breaks an invoice line down by customer, cent-exact to the Subtotal", () => {
    // The real XTB shape: Subtotal 28.88 ≠ Rate×Qty 28.91 (display-rounded rate).
    const invoice = [
      inv({ partner: "XTB Solutions", sku: "BUENDflex", qty: 7, rate: 4.13, subtotal: 28.88, clientPrice: 4.13, charge: 28.91, servicePeriod: "2026-08" }),
    ];
    const u = [
      usage("XTB Solutions", "child-a", "BUENDflex", 3),
      usage("XTB Solutions", "child-b", "BUENDflex", 4),
    ];
    const { rated, report } = closeFromInvoice(invoice, u, OPTS);

    expect(rated).toHaveLength(2);
    // H: allocated cents sum EXACTLY to the billed Subtotal, not to Rate×Qty.
    expect(sum(rated.map((r) => r.amountCost)).toFixed2()).toBe("28.88");
    // qty allocation follows usage weights exactly when they tie.
    expect(rated.map((r) => r.quantity)).toEqual([3, 4]);
    // L: exact unit × allocated qty.
    expect(rated.map((r) => r.amountCharge.toFixed2())).toEqual(["12.39", "16.52"]);
    expect(report.grandTieOk).toBe(true);
    expect(report.lines[0]!.qtyTies).toBe(true);
  });

  it("uses the invoice quantity when usage disagrees, and flags the gap", () => {
    // The real Ideal Tech COR-LTE-C shape: usage says less, invoice bills 371.
    const invoice = [
      inv({ partner: "Ideal Tech Help", sku: "COR-LTE-C", qty: 371, rate: 2.75, subtotal: 1020.25, clientPrice: 3, charge: 1113, servicePeriod: "2026-08" }),
    ];
    const u = [
      usage("Ideal Tech Help", "kid-1", "COR-LTE-C", 20),
      usage("Ideal Tech Help", "kid-2", "COR-LTE-C", 18),
    ];
    const { rated, exceptions, report } = closeFromInvoice(invoice, u, OPTS);

    // Invoice wins: total allocated qty = 371, split ~ proportional to 20:18.
    expect(rated.reduce((a, r) => a + r.quantity, 0)).toBe(371);
    expect(sum(rated.map((r) => r.amountCost)).toFixed2()).toBe("1020.25");
    expect(sum(rated.map((r) => r.amountCharge)).toFixed2()).toBe("1113.00"); // 3 × 371
    expect(exceptions.some((e) => e.kind === "USAGE_QTY_DISAGREES" && e.severity === "warn")).toBe(true);
    expect(report.lines[0]!.qtyTies).toBe(false);
    expect(report.lines[0]!.flags.join()).toMatch(/38 ≠ invoice 371/);
  });

  it("bills a partner-level line when usage has no breakdown", () => {
    const invoice = [
      inv({ partner: "IT Network Solutions Group LLC", sku: "COR-ESS-C", qty: 28, rate: 3.38, subtotal: 94.5, clientPrice: 3.75, servicePeriod: "2026-08" }),
    ];
    const { rated, exceptions } = closeFromInvoice(invoice, [], OPTS);

    expect(rated).toHaveLength(1);
    expect(rated[0]!.customer).toBeNull();
    expect(rated[0]!.quantity).toBe(28);
    expect(rated[0]!.amountCost.toFixed2()).toBe("94.50");
    expect(exceptions.some((e) => e.kind === "NO_USAGE_BREAKDOWN" && e.severity === "info")).toBe(true);
  });

  it("holds lines with blank Client Price — never fabricates L", () => {
    const invoice = [
      inv({ partner: "GOA-TECH", sku: "COR-ESS-C", qty: 3, rate: 4.13, subtotal: 12.38, clientPrice: null, servicePeriod: "2026-08" }),
    ];
    const u = [usage("GOA-TECH", "kid", "COR-ESS-C", 3)];
    const { rated, exceptions, report } = closeFromInvoice(invoice, u, OPTS);

    expect(rated).toHaveLength(1);
    expect(rated[0]!.exceptions.some((e) => e.kind === "MISSING_MSP_PRICE" && e.severity === "block")).toBe(true);
    expect(rated[0]!.amountCharge.isZero()).toBe(true); // never invented
    expect(exceptions.filter((e) => e.kind === "MISSING_MSP_PRICE")).toHaveLength(1);
    expect(report.heldH.toFixed2()).toBe("12.38");
    expect(report.lines[0]!.held).toBe(true);
  });

  it("excludes out-of-period lines from allocation but ties them into the grand total", () => {
    // The real 2193 Rocker shape: two July lines on the August invoice.
    const invoice = [
      inv({ partner: "Rocker", sku: "COR-COMP-C", qty: 46, rate: 5.55, subtotal: 255.3, clientPrice: 6.4, servicePeriod: "2026-08", lineNumber: 1 }),
      inv({ partner: "Rocker", sku: "BUCOMflex", qty: 11, rate: 2.75, subtotal: 30.24, clientPrice: 8.25, servicePeriod: "2026-07", startDate: "2026-07-01", endDate: "2026-07-31", note: "Jul period billed again - already on INV-0001914", lineNumber: 2 }),
    ];
    const u = [usage("Rocker", "kid", "COR-COMP-C", 46, { legacy: false })];
    const { rated, exceptions, report } = closeFromInvoice(invoice, u, OPTS);

    // Only the August line is rated.
    expect(rated.map((r) => r.sku.vendorSku)).toEqual(["COR-COMP-C"]);
    expect(report.outOfPeriod).toHaveLength(1);
    expect(report.outOfPeriod[0]!.servicePeriod).toBe("2026-07");
    expect(exceptions.some((e) => e.kind === "OUT_OF_PERIOD_LINE")).toBe(true);
    // The tie: allocated (255.30) + out-of-period (30.24) = invoice total (285.54).
    expect(report.allocatedH.toFixed2()).toBe("255.30");
    expect(report.outOfPeriodH.toFixed2()).toBe("30.24");
    expect(report.invoiceTotalH.toFixed2()).toBe("285.54");
    expect(report.grandTieOk).toBe(true);
  });

  it("surfaces usage with no invoice line as a finding and does NOT bill it", () => {
    const invoice = [
      inv({ partner: "Amplivity", sku: "BUCOROflex", qty: 87, rate: 4.13, subtotal: 358.88, clientPrice: 6, servicePeriod: "2026-08" }),
    ];
    const u = [
      usage("Amplivity", "kid", "BUCOROflex", 87),
      usage("Hurricane IT", "someone", "BUCOROflex", 12), // consumed, never billed by Coro
    ];
    const { rated, exceptions, report } = closeFromInvoice(invoice, u, OPTS);

    expect(rated.every((r) => r.partner === "Amplivity")).toBe(true);
    expect(report.usageOnly).toEqual([{ partner: "Hurricane IT", sku: "BUCOROflex", usageQty: 12 }]);
    expect(exceptions.some((e) => e.kind === "USAGE_NOT_ON_INVOICE" && e.partner === "Hurricane IT")).toBe(true);
  });

  it("flags negative margins (selling below Coro cost)", () => {
    // The real Teledata BUENDflex shape: L×qty 65.92 < Subtotal 66.00.
    const invoice = [
      inv({ partner: "Teledata Cloud Services", sku: "BUENDflex", qty: 16, rate: 4.12, subtotal: 66, clientPrice: 4.12, charge: 65.92, servicePeriod: "2026-08" }),
    ];
    const { report } = closeFromInvoice(invoice, [usage("Teledata Cloud Services", "kid", "BUENDflex", 16)], OPTS);
    expect(report.lines[0]!.margin!.toFixed2()).toBe("-0.08");
    expect(report.lines[0]!.flags.join()).toMatch(/NEGATIVE margin/);
  });

  it("cross-checks the sheet's own charge math and flags disagreement", () => {
    const invoice = [
      inv({ partner: "Acme", sku: "COR-COMP-C", qty: 10, rate: 5, subtotal: 50, clientPrice: 6, charge: 61, servicePeriod: "2026-08" }),
    ];
    const { exceptions } = closeFromInvoice(invoice, [usage("Acme", "kid", "COR-COMP-C", 10, { legacy: false })], OPTS);
    expect(exceptions.some((e) => e.kind === "COST_DISAGREES_WITH_INVOICE" && /61/.test(e.message))).toBe(true);
  });

  it("ignores lines from other invoices entirely", () => {
    const invoice = [
      inv({ partner: "Acme", sku: "COR-COMP-C", qty: 10, rate: 5, subtotal: 50, clientPrice: 6, servicePeriod: "2026-08" }),
      inv({ partner: "Acme", sku: "COR-COMP-C", qty: 99, rate: 5, subtotal: 495, clientPrice: 6, servicePeriod: "2026-08", invoiceNumber: "1914" }),
    ];
    const { rated, report } = closeFromInvoice(invoice, [], OPTS);
    expect(rated.reduce((a, r) => a + r.quantity, 0)).toBe(10);
    expect(report.invoiceTotalH.toFixed2()).toBe("50.00");
  });
});

describe("classifyInvoiceSku", () => {
  it("classes …flex as legacy and AI SKUs as current (decision D5)", () => {
    expect(classifyInvoiceSku("BUCOROflex")).toBe("legacy");
    expect(classifyInvoiceSku("ADDSECUREWEBflex")).toBe("legacy");
    expect(classifyInvoiceSku("COR-COMP-C")).toBe("current");
    expect(classifyInvoiceSku("COR-LTE-C")).toBe("current");
  });
});
