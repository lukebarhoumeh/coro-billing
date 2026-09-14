/**
 * Tests for the invoicing module — buildInvoices.
 *
 * Contract (docs/ARCHITECTURE.md):
 *   export function buildInvoices(rated: RatedLine[], period: Period): QbInvoice[];
 *   - One invoice per partner (MSP) for the period.
 *   - lines broken down BY CUSTOMER (Dane's Amplivity example, README §"The magic sauce":
 *     "Amplivity is going to get a bill from us for all of this stuff. We break it down by customer.").
 *   - rate on each line = L (unit / mspPrice). amount = amountCharge.
 *   - subtotalCharge = sum(L amounts); subtotalCost = sum(H amounts); margin = charge - cost.
 *   - Sort deterministically: invoices by partner; lines by (customer ?? '', sku).
 *   - A null-customer rated line still belongs to its partner's invoice (partner-level line).
 *   - Invoices are NEVER merged across partners.
 */
import { describe, it, expect } from "vitest";
import { buildInvoices } from "../../src/invoicing/buildInvoices.js";
import { Money } from "../../src/lib/money.js";
import type {
  RatedLine,
  RateCardEntry,
  Sku,
  Period,
} from "../../src/domain/types.js";

const PERIOD: Period = "2026-08";

/** Build a minimal Sku for tests. */
function sku(vendorSku: string, isLegacy = false): Sku {
  return {
    vendorSku,
    class: isLegacy ? "legacy" : "current",
    isLegacy,
    product: `${vendorSku} product`,
  };
}

/** Build a minimal RateCardEntry to satisfy the RatedLine.rate contract. */
function rate(partner: string, s: string, hubCost: string, mspPrice: string): RateCardEntry {
  return {
    partner,
    sku: s,
    period: PERIOD,
    class: "current",
    hubCost: Money.of(hubCost),
    mspPrice: Money.of(mspPrice),
    source: "current",
    raw: {},
  };
}

/**
 * Build a RatedLine. H/L unit prices and quantity drive the derived amounts
 * exactly as rating would (amountCost = H*qty, amountCharge = L*qty, margin = charge-cost).
 */
function ratedLine(opts: {
  partner: string;
  customer: string | null;
  vendorSku: string;
  quantity: number;
  hubCost: string; // H unit
  mspPrice: string; // L unit
  isLegacy?: boolean;
  product?: string;
  sourceRow?: number;
}): RatedLine {
  const H = Money.of(opts.hubCost);
  const L = Money.of(opts.mspPrice);
  const amountCost = H.mul(opts.quantity);
  const amountCharge = L.mul(opts.quantity);
  const s = sku(opts.vendorSku, opts.isLegacy);
  return {
    period: PERIOD,
    partner: opts.partner,
    customer: opts.customer,
    sku: opts.product ? { ...s, product: opts.product } : s,
    quantity: opts.quantity,
    hubCost: H,
    mspPrice: L,
    amountCost,
    amountCharge,
    margin: amountCharge.sub(amountCost),
    rate: rate(opts.partner, opts.vendorSku, opts.hubCost, opts.mspPrice),
    exceptions: [],
    sourceRow: opts.sourceRow ?? 1,
  };
}

describe("buildInvoices", () => {
  it("groups two customers under one partner into a single invoice with a line per (customer, sku)", () => {
    // Amplivity has two child workspaces, each consuming one SKU.
    const rated: RatedLine[] = [
      ratedLine({
        partner: "Amplivity MSP",
        customer: "Acme Corp",
        vendorSku: "CORO-EDR",
        quantity: 10,
        hubCost: "5.00",
        mspPrice: "8.00",
      }),
      ratedLine({
        partner: "Amplivity MSP",
        customer: "Globex Inc",
        vendorSku: "CORO-SWG",
        quantity: 4,
        hubCost: "3.00",
        mspPrice: "5.50",
      }),
    ];

    const invoices = buildInvoices(rated, PERIOD);

    // One partner -> exactly one invoice.
    expect(invoices).toHaveLength(1);
    const inv = invoices[0]!;
    expect(inv.partner).toBe("Amplivity MSP");
    expect(inv.period).toBe(PERIOD);

    // Two lines, each labeled by its end customer.
    expect(inv.lines).toHaveLength(2);
    const [l1, l2] = inv.lines;
    expect(l1!.customer).toBe("Acme Corp");
    expect(l2!.customer).toBe("Globex Inc");

    // Description is ITEM-LEVEL (sku + product). The end customer lives in the separate
    // `customer` field and is prepended once by the export layer — so it must NOT be
    // baked into `description` (that produced a double customer prefix on export).
    expect(l1!.description).toContain("CORO-EDR");
    expect(l1!.description).toContain("CORO-EDR product");
    expect(l1!.description).not.toContain("Acme Corp");
    expect(l1!.customer).toBe("Acme Corp");

    // rate = L (unit); amount = L * qty.
    expect(l1!.rate.equalsCents(Money.of("8.00"))).toBe(true);
    expect(l1!.amount.equalsCents(Money.of("80.00"))).toBe(true);
    expect(l2!.rate.equalsCents(Money.of("5.50"))).toBe(true);
    expect(l2!.amount.equalsCents(Money.of("22.00"))).toBe(true);
  });

  it("computes subtotalCharge, subtotalCost, and margin cent-exact", () => {
    const rated: RatedLine[] = [
      ratedLine({
        partner: "Amplivity MSP",
        customer: "Acme Corp",
        vendorSku: "CORO-EDR",
        quantity: 10,
        hubCost: "5.00", // cost 50.00
        mspPrice: "8.00", // charge 80.00
      }),
      ratedLine({
        partner: "Amplivity MSP",
        customer: "Globex Inc",
        vendorSku: "CORO-SWG",
        quantity: 4,
        hubCost: "3.00", // cost 12.00
        mspPrice: "5.50", // charge 22.00
      }),
    ];

    const inv = buildInvoices(rated, PERIOD)[0]!;

    // subtotalCharge = 80 + 22 = 102.00 ; subtotalCost = 50 + 12 = 62.00 ; margin = 40.00
    expect(inv.subtotalCharge.equalsCents(Money.of("102.00"))).toBe(true);
    expect(inv.subtotalCost.equalsCents(Money.of("62.00"))).toBe(true);
    expect(inv.margin.equalsCents(Money.of("40.00"))).toBe(true);
    // margin must equal subtotalCharge - subtotalCost exactly.
    expect(inv.margin.equalsCents(inv.subtotalCharge.sub(inv.subtotalCost))).toBe(true);
  });

  it("handles fractional unit prices without float drift (cent-exact)", () => {
    // 0.1 + 0.2 style hazard: unit 0.01 * 3 seats across many lines.
    const rated: RatedLine[] = [
      ratedLine({
        partner: "Acme MSP",
        customer: "Cust A",
        vendorSku: "S1",
        quantity: 3,
        hubCost: "0.10",
        mspPrice: "0.20",
      }),
      ratedLine({
        partner: "Acme MSP",
        customer: "Cust B",
        vendorSku: "S2",
        quantity: 3,
        hubCost: "0.10",
        mspPrice: "0.20",
      }),
    ];
    const inv = buildInvoices(rated, PERIOD)[0]!;
    // charge = 0.60 + 0.60 = 1.20 ; cost = 0.30 + 0.30 = 0.60 ; margin = 0.60
    expect(inv.subtotalCharge.equalsCents(Money.of("1.20"))).toBe(true);
    expect(inv.subtotalCost.equalsCents(Money.of("0.60"))).toBe(true);
    expect(inv.margin.equalsCents(Money.of("0.60"))).toBe(true);
  });

  it("produces a separate invoice per partner and does NOT merge across partners", () => {
    const rated: RatedLine[] = [
      ratedLine({
        partner: "Amplivity MSP",
        customer: "Acme Corp",
        vendorSku: "CORO-EDR",
        quantity: 1,
        hubCost: "5.00",
        mspPrice: "8.00",
      }),
      ratedLine({
        partner: "Meeting Tree MSP",
        customer: "Beta LLC",
        vendorSku: "CORO-EDR",
        quantity: 2,
        hubCost: "5.00",
        mspPrice: "8.00",
      }),
    ];

    const invoices = buildInvoices(rated, PERIOD);
    expect(invoices).toHaveLength(2);
    const partners = invoices.map((i) => i.partner);
    expect(partners).toEqual(["Amplivity MSP", "Meeting Tree MSP"]);
    // Each invoice contains only its own partner's line.
    expect(invoices[0]!.lines).toHaveLength(1);
    expect(invoices[1]!.lines).toHaveLength(1);
    expect(invoices[0]!.subtotalCharge.equalsCents(Money.of("8.00"))).toBe(true);
    expect(invoices[1]!.subtotalCharge.equalsCents(Money.of("16.00"))).toBe(true);
  });

  it("orders invoices by partner and lines by (customer, sku) deterministically", () => {
    // Feed rows in deliberately jumbled order.
    const rated: RatedLine[] = [
      ratedLine({
        partner: "Zeta MSP",
        customer: "Yankee",
        vendorSku: "S9",
        quantity: 1,
        hubCost: "1.00",
        mspPrice: "2.00",
      }),
      ratedLine({
        partner: "Alpha MSP",
        customer: "Bravo",
        vendorSku: "S2",
        quantity: 1,
        hubCost: "1.00",
        mspPrice: "2.00",
      }),
      ratedLine({
        partner: "Alpha MSP",
        customer: "Bravo",
        vendorSku: "S1",
        quantity: 1,
        hubCost: "1.00",
        mspPrice: "2.00",
      }),
      ratedLine({
        partner: "Alpha MSP",
        customer: "Alfa",
        vendorSku: "S1",
        quantity: 1,
        hubCost: "1.00",
        mspPrice: "2.00",
      }),
    ];

    const invoices = buildInvoices(rated, PERIOD);
    // Invoices sorted by partner.
    expect(invoices.map((i) => i.partner)).toEqual(["Alpha MSP", "Zeta MSP"]);

    // Alpha's lines sorted by (customer, sku): Alfa/S1, Bravo/S1, Bravo/S2.
    const alpha = invoices[0]!;
    expect(alpha.lines.map((l) => [l.customer, l.sku])).toEqual([
      ["Alfa", "S1"],
      ["Bravo", "S1"],
      ["Bravo", "S2"],
    ]);
  });

  it("keeps a null-customer rated line on its partner's invoice as a partner-level line, sorted first", () => {
    const rated: RatedLine[] = [
      ratedLine({
        partner: "Amplivity MSP",
        customer: "Acme Corp",
        vendorSku: "CORO-EDR",
        quantity: 1,
        hubCost: "5.00",
        mspPrice: "8.00",
      }),
      ratedLine({
        partner: "Amplivity MSP",
        customer: null, // partner-level row, no child workspace
        vendorSku: "CORO-PLATFORM",
        quantity: 1,
        hubCost: "10.00",
        mspPrice: "15.00",
      }),
    ];

    const invoices = buildInvoices(rated, PERIOD);
    expect(invoices).toHaveLength(1);
    const inv = invoices[0]!;
    expect(inv.lines).toHaveLength(2);
    // (customer ?? '') sorts null-customer line before "Acme Corp".
    expect(inv.lines[0]!.customer).toBeNull();
    expect(inv.lines[1]!.customer).toBe("Acme Corp");
    // Totals still include the partner-level line.
    expect(inv.subtotalCharge.equalsCents(Money.of("23.00"))).toBe(true);
    expect(inv.subtotalCost.equalsCents(Money.of("15.00"))).toBe(true);
  });

  it("returns an empty array when there is no usage (no fabricated invoices)", () => {
    expect(buildInvoices([], PERIOD)).toEqual([]);
  });

  it("does not mutate the input array and is deterministic across repeated calls", () => {
    const rated: RatedLine[] = [
      ratedLine({
        partner: "Beta MSP",
        customer: "C2",
        vendorSku: "S2",
        quantity: 1,
        hubCost: "1.00",
        mspPrice: "2.00",
      }),
      ratedLine({
        partner: "Alpha MSP",
        customer: "C1",
        vendorSku: "S1",
        quantity: 1,
        hubCost: "1.00",
        mspPrice: "2.00",
      }),
    ];
    const before = [...rated];
    const first = buildInvoices(rated, PERIOD);
    const second = buildInvoices(rated, PERIOD);

    // Input order preserved (no in-place sort).
    expect(rated).toEqual(before);
    // Same output twice.
    expect(first.map((i) => i.partner)).toEqual(second.map((i) => i.partner));
    expect(first.map((i) => i.partner)).toEqual(["Alpha MSP", "Beta MSP"]);
  });

  it("aggregates multiple rated rows for the same (partner, customer, sku) into one invoice line", () => {
    // Two usage rows for the same customer+sku (e.g. adds mid-month) should roll up,
    // never silently drop, and totals must reflect both.
    const rated: RatedLine[] = [
      ratedLine({
        partner: "Amplivity MSP",
        customer: "Acme Corp",
        vendorSku: "CORO-EDR",
        quantity: 10,
        hubCost: "5.00",
        mspPrice: "8.00",
      }),
      ratedLine({
        partner: "Amplivity MSP",
        customer: "Acme Corp",
        vendorSku: "CORO-EDR",
        quantity: 5,
        hubCost: "5.00",
        mspPrice: "8.00",
      }),
    ];

    const inv = buildInvoices(rated, PERIOD)[0]!;
    expect(inv.lines).toHaveLength(1);
    const line = inv.lines[0]!;
    expect(line.quantity).toBe(15);
    // amount = 8.00 * 15 = 120.00
    expect(line.amount.equalsCents(Money.of("120.00"))).toBe(true);
    expect(inv.subtotalCharge.equalsCents(Money.of("120.00"))).toBe(true);
    expect(inv.subtotalCost.equalsCents(Money.of("75.00"))).toBe(true);
  });
});
