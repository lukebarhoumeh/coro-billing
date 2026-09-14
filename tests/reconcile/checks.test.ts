/**
 * Tests for src/reconcile/checks.ts — the README "Reconciliation checks" table.
 *
 * Spec anchor (README "Reconciliation checks"):
 *   | Usage row with no H or L                          | Rate card gap (esp. legacy)    |
 *   | Partner on a deal not on the rate card            | "Partners are on different..." |
 *   | Child workspace not rolled into the parent invoice| We would bill the wrong party  |
 *   | Invoice from Coro vs our H × qty                  | Cost disagreement with vendor  |
 *   | Legacy priced as current                          | Mapping error                  |
 *
 * TDD: these are written BEFORE the implementation and must fail first.
 */
import { describe, it, expect } from "vitest";
import { runChecks } from "../../src/reconcile/checks.js";
import { Money } from "../../src/lib/money.js";
import type {
  RatedLine,
  QbInvoice,
  QbInvoiceLine,
  UsageLine,
  CoroInvoiceLine,
  Sku,
  RateCardEntry,
  Exception,
  UnknownField,
} from "../../src/domain/types.js";

const PERIOD = "2026-08";
const unknown = (): UnknownField => ({ raw: null, known: false });

function sku(vendorSku: string, klass: Sku["class"], isLegacy = false): Sku {
  return { vendorSku, class: klass, isLegacy };
}

function rateEntry(over: Partial<RateCardEntry> = {}): RateCardEntry {
  return {
    partner: "Acme MSP",
    sku: "SKU-A",
    period: PERIOD,
    class: "current",
    hubCost: Money.of("6.00"),
    mspPrice: Money.of("9.00"),
    source: "current",
    raw: {},
    ...over,
  };
}

function ratedLine(over: Partial<RatedLine> = {}): RatedLine {
  const qty = over.quantity ?? 10;
  const hubCost = over.hubCost ?? Money.of("6.00");
  const mspPrice = over.mspPrice ?? Money.of("9.00");
  return {
    period: PERIOD,
    partner: "Acme MSP",
    customer: "Cust One",
    sku: sku("SKU-A", "current"),
    quantity: qty,
    hubCost,
    mspPrice,
    amountCost: hubCost.mul(qty),
    amountCharge: mspPrice.mul(qty),
    margin: mspPrice.mul(qty).sub(hubCost.mul(qty)),
    rate: rateEntry(),
    exceptions: [],
    sourceRow: 2,
    ...over,
  };
}

function invoiceLine(over: Partial<QbInvoiceLine> = {}): QbInvoiceLine {
  const qty = over.quantity ?? 10;
  const rate = over.rate ?? Money.of("9.00");
  return {
    customer: "Cust One",
    sku: "SKU-A",
    description: "SKU-A — Cust One",
    quantity: qty,
    rate,
    amount: rate.mul(qty),
    ...over,
  };
}

function invoice(partner: string, lines: QbInvoiceLine[]): QbInvoice {
  const subtotalCharge = lines.reduce((a, l) => a.add(l.amount), Money.zero());
  return {
    partner,
    period: PERIOD,
    lines,
    subtotalCharge,
    subtotalCost: Money.zero(),
    margin: subtotalCharge,
  };
}

function usageLine(over: Partial<UsageLine> = {}): UsageLine {
  return {
    period: PERIOD,
    partner: "Acme MSP",
    customer: "Cust One",
    sku: sku("SKU-A", "current"),
    quantity: 10,
    u: unknown(),
    d: unknown(),
    raw: {},
    sourceRow: 2,
    ...over,
  };
}

function exception(over: Partial<Exception> = {}): Exception {
  return {
    kind: "MISSING_RATE_CARD_ROW",
    severity: "block",
    partner: "Acme MSP",
    customer: "Cust One",
    sku: "SKU-A",
    period: PERIOD,
    message: "no rate card row",
    ...over,
  };
}

function findCheck(results: ReturnType<typeof runChecks>, id: string) {
  const c = results.find((r) => r.id === id);
  if (!c) throw new Error(`no check with id "${id}"; have: ${results.map((r) => r.id).join(", ")}`);
  return c;
}

describe("runChecks — README Reconciliation checks table", () => {
  it("all-clean inputs => every check passes", () => {
    const rated = [ratedLine()];
    const invoices = [invoice("Acme MSP", [invoiceLine()])];
    const usage = [usageLine()];
    const results = runChecks({ rated, invoices, usage });

    expect(results.length).toBeGreaterThanOrEqual(4);
    for (const r of results) {
      expect(r.status).toBe("pass");
      expect(r.failCount).toBe(0);
    }
  });

  it("Check 1: usage row with no H or L is flagged (rate card gap)", () => {
    // A rated line where H and L came back zero (blocking exception attached).
    const missing = ratedLine({
      hubCost: Money.zero(),
      mspPrice: Money.zero(),
      amountCost: Money.zero(),
      amountCharge: Money.zero(),
      margin: Money.zero(),
      exceptions: [exception({ kind: "MISSING_HUB_COST", message: "no H" })],
    });
    const results = runChecks({
      rated: [missing],
      invoices: [invoice("Acme MSP", [invoiceLine({ rate: Money.zero(), amount: Money.zero() })])],
      usage: [usageLine()],
    });
    const c = findCheck(results, "usage-no-h-or-l");
    expect(c.status).toBe("fail");
    expect(c.failCount).toBe(1);
    expect(c.rows?.length).toBe(1);
  });

  it("Check 2: partner on a deal not on the rate card (MISSING_RATE_CARD_ROW)", () => {
    const missingRow = ratedLine({
      hubCost: Money.zero(),
      mspPrice: Money.zero(),
      amountCost: Money.zero(),
      amountCharge: Money.zero(),
      margin: Money.zero(),
      exceptions: [exception({ kind: "MISSING_RATE_CARD_ROW", message: "partner+sku not on rate card" })],
    });
    const results = runChecks({
      rated: [missingRow],
      invoices: [invoice("Acme MSP", [invoiceLine({ rate: Money.zero(), amount: Money.zero() })])],
      usage: [usageLine()],
    });
    const c = findCheck(results, "partner-not-on-rate-card");
    expect(c.status).toBe("fail");
    expect(c.failCount).toBe(1);
  });

  it("Check 3: child workspace not rolled into the parent MSP invoice", () => {
    // Rated line for "Cust Two" under Acme, but the Acme invoice only has "Cust One".
    const rated = [ratedLine({ customer: "Cust One" }), ratedLine({ customer: "Cust Two", sourceRow: 3 })];
    const invoices = [invoice("Acme MSP", [invoiceLine({ customer: "Cust One" })])];
    const results = runChecks({ rated, invoices, usage: [usageLine()] });
    const c = findCheck(results, "child-not-rolled-into-parent");
    expect(c.status).toBe("fail");
    expect(c.failCount).toBe(1);
    expect(String(c.rows?.[0]?.customer)).toBe("Cust Two");
  });

  it("Check 4: Coro invoice vs our H*qty mismatch (only when coroInvoices supplied)", () => {
    // Our H*qty = 6.00*10 = 60.00; Coro billed 70.00 => cost disagreement.
    const rated = [ratedLine({ hubCost: Money.of("6.00"), quantity: 10, amountCost: Money.of("60.00") })];
    const coroInvoices: CoroInvoiceLine[] = [
      {
        invoiceNumber: "1914",
        lineNumber: 1,
        sku: "SKU-A",
        partner: "Acme MSP",
        quantity: 10,
        unitPrice: Money.of("7.00"),
        amount: Money.of("70.00"),
        raw: {},
      },
    ];
    const results = runChecks({
      rated,
      invoices: [invoice("Acme MSP", [invoiceLine()])],
      usage: [usageLine()],
      coroInvoices,
    });
    const c = findCheck(results, "coro-invoice-vs-hub-cost");
    expect(c.status).toBe("fail");
    expect(c.failCount).toBe(1);
  });

  it("Check 4: same SKU split across invoices 1914 + 2193 ties in aggregate (no false fail)", () => {
    // Our monthly H*qty for SKU-A = 6.00 * 10 = 60.00. Coro billed it across BOTH
    // invoices ($30 on 1914 + $30 on 2193 = $60). "Two invoices stay two" — we ingest
    // both, and the aggregate ties, so this must PASS (the pre-fix code false-failed).
    const rated = [ratedLine({ hubCost: Money.of("6.00"), quantity: 10, amountCost: Money.of("60.00") })];
    const coroInvoices: CoroInvoiceLine[] = [
      { invoiceNumber: "1914", lineNumber: 1, sku: "SKU-A", partner: "Acme MSP", quantity: 5, unitPrice: Money.of("6.00"), amount: Money.of("30.00"), raw: {} },
      { invoiceNumber: "2193", lineNumber: 1, sku: "SKU-A", partner: "Acme MSP", quantity: 5, unitPrice: Money.of("6.00"), amount: Money.of("30.00"), raw: {} },
    ];
    const results = runChecks({
      rated,
      invoices: [invoice("Acme MSP", [invoiceLine()])],
      usage: [usageLine()],
      coroInvoices,
    });
    const c = findCheck(results, "coro-invoice-vs-hub-cost");
    expect(c.status).toBe("pass");
    expect(c.failCount).toBe(0);
  });

  it("Check 4: skipped (no coroInvoices) => not present or a pass", () => {
    const results = runChecks({
      rated: [ratedLine()],
      invoices: [invoice("Acme MSP", [invoiceLine()])],
      usage: [usageLine()],
    });
    const c = results.find((r) => r.id === "coro-invoice-vs-hub-cost");
    // When invoices aren't supplied the check must not falsely fail.
    if (c) expect(c.status).not.toBe("fail");
  });

  it("Check 5: legacy SKU priced with a current rate-card entry (mapping error)", () => {
    const legacyAsCurrent = ratedLine({
      sku: sku("LEG-1", "legacy", true),
      rate: rateEntry({ sku: "LEG-1", class: "current" }),
    });
    const results = runChecks({
      rated: [legacyAsCurrent],
      invoices: [invoice("Acme MSP", [invoiceLine({ sku: "LEG-1" })])],
      usage: [usageLine()],
    });
    const c = findCheck(results, "legacy-priced-as-current");
    expect(c.status).toBe("fail");
    expect(c.failCount).toBe(1);
  });
});
