/**
 * Tests for src/reconcile/august.ts — reconcileAgainstLindita, the ACCEPTANCE TEST.
 *
 * Spec anchor (README §3 "Recreate August against Lindita"):
 *   Dane: "recreate the August invoice and see any discrepancies we have against
 *   Lita's manual one, and we'll be able to make corrections there."
 *
 * Join on normalized partner+customer+sku. Compare UNIT ourPrice->hubCost,
 * UNIT charge->mspPrice, quantity, and margin via Money.equalsCents within
 * cfg.reconToleratedCents. matched === true iff no discrepancies AND no
 * only-in-one rows. The $6-vs-$9 legacy landmine carries an explanation.
 *
 * TDD: written BEFORE the implementation; must fail first.
 */
import { describe, it, expect } from "vitest";
import { reconcileAgainstLindita } from "../../src/reconcile/august.js";
import { defaultConfig } from "../../src/config/pipeline.config.js";
import { Money } from "../../src/lib/money.js";
import type {
  RatedLine,
  LinditaLine,
  Sku,
  RateCardEntry,
  Exception,
} from "../../src/domain/types.js";

const PERIOD = "2026-08";

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

function linditaLine(over: Partial<LinditaLine> = {}): LinditaLine {
  const qty = over.quantity ?? 10;
  const ourPrice = over.ourPrice ?? Money.of("6.00");
  const charge = over.charge ?? Money.of("9.00");
  return {
    period: PERIOD,
    partner: "Acme MSP",
    customer: "Cust One",
    sku: "SKU-A",
    quantity: qty,
    ourPrice,
    charge,
    raw: {},
    sourceRow: 2,
    ...over,
  };
}

const cfg = defaultConfig(PERIOD);

describe("reconcileAgainstLindita — the August acceptance test", () => {
  it("identical inputs => matched true, no discrepancies, totals tie", () => {
    const rated = [
      ratedLine({ customer: "Cust One", sku: sku("SKU-A", "current") }),
      ratedLine({
        customer: "Cust Two",
        sku: sku("SKU-B", "current"),
        hubCost: Money.of("4.00"),
        mspPrice: Money.of("7.50"),
        quantity: 3,
        sourceRow: 3,
      }),
    ];
    const lindita = [
      linditaLine({ customer: "Cust One", sku: "SKU-A" }),
      linditaLine({
        customer: "Cust Two",
        sku: "SKU-B",
        ourPrice: Money.of("4.00"),
        charge: Money.of("7.50"),
        quantity: 3,
        sourceRow: 3,
      }),
    ];

    const report = reconcileAgainstLindita(rated, lindita, cfg);
    expect(report.matched).toBe(true);
    expect(report.discrepancies).toHaveLength(0);
    expect(report.onlyInOurs).toHaveLength(0);
    expect(report.onlyInLindita).toHaveLength(0);
    // totals = sum of charge*qty on each side: 9*10 + 7.50*3 = 112.50
    expect(report.totalOurs.equalsCents(Money.of("112.50"))).toBe(true);
    expect(report.totalLindita.equalsCents(Money.of("112.50"))).toBe(true);
    expect(report.totalOurs.equalsCents(report.totalLindita)).toBe(true);
    expect(report.period).toBe(PERIOD);
  });

  it("legacy $6-vs-$9 charge mismatch => matched false with an explained charge Discrepancy", () => {
    // Dane's landmine: we charge $6 (legacy special deal); Lindita's manual file has $9.
    const rated = [
      ratedLine({
        sku: sku("LEG-1", "legacy", true),
        hubCost: Money.of("3.00"),
        mspPrice: Money.of("6.00"), // OUR charge = $6
        quantity: 10,
        rate: rateEntry({ sku: "LEG-1", class: "legacy" }),
        exceptions: [
          {
            kind: "PARTNER_SPECIAL_DEAL",
            severity: "warn",
            partner: "Acme MSP",
            customer: "Cust One",
            sku: "LEG-1",
            period: PERIOD,
            message: "legacy special deal for this partner",
          } satisfies Exception,
        ],
      }),
    ];
    const lindita = [
      linditaLine({
        sku: "LEG-1",
        ourPrice: Money.of("3.00"),
        charge: Money.of("9.00"), // LINDITA charge = $9
        quantity: 10,
      }),
    ];

    const report = reconcileAgainstLindita(rated, lindita, cfg);
    expect(report.matched).toBe(false);
    const chargeDisc = report.discrepancies.find((d) => d.field === "charge");
    expect(chargeDisc).toBeDefined();
    expect(chargeDisc?.ours).toContain("6");
    expect(chargeDisc?.lindita).toContain("9");
    // Explanation surfaces the special-deal exception (never invents a rate).
    expect(chargeDisc?.explanation).toBeDefined();
    expect(chargeDisc?.explanation?.toLowerCase()).toContain("legacy");
    expect(chargeDisc?.explanation).toContain("6");
    expect(chargeDisc?.explanation).toContain("9");
    // cent diff is unit charge cents (6 -> 9 => 300 cents on unit)
    expect(chargeDisc?.centsDiff).toBe(300);
  });

  it("a row only in Lindita => onlyInLindita populated, matched false", () => {
    const rated = [ratedLine({ customer: "Cust One", sku: sku("SKU-A", "current") })];
    const lindita = [
      linditaLine({ customer: "Cust One", sku: "SKU-A" }),
      linditaLine({ customer: "Ghost Cust", sku: "SKU-Z", sourceRow: 9 }),
    ];
    const report = reconcileAgainstLindita(rated, lindita, cfg);
    expect(report.matched).toBe(false);
    expect(report.onlyInLindita).toHaveLength(1);
    expect(report.onlyInLindita[0]?.sku).toBe("SKU-Z");
    expect(report.onlyInOurs).toHaveLength(0);
  });

  it("a row only in ours => onlyInOurs populated, matched false", () => {
    const rated = [
      ratedLine({ customer: "Cust One", sku: sku("SKU-A", "current") }),
      ratedLine({ customer: "Extra Cust", sku: sku("SKU-X", "current"), sourceRow: 5 }),
    ];
    const lindita = [linditaLine({ customer: "Cust One", sku: "SKU-A" })];
    const report = reconcileAgainstLindita(rated, lindita, cfg);
    expect(report.matched).toBe(false);
    expect(report.onlyInOurs).toHaveLength(1);
    expect(report.onlyInOurs[0]?.sku.vendorSku).toBe("SKU-X");
  });

  it("unit ourPrice (H) mismatch surfaces an ourPrice Discrepancy", () => {
    const rated = [ratedLine({ hubCost: Money.of("6.00") })];
    const lindita = [linditaLine({ ourPrice: Money.of("6.50") })];
    const report = reconcileAgainstLindita(rated, lindita, cfg);
    expect(report.matched).toBe(false);
    const d = report.discrepancies.find((x) => x.field === "ourPrice");
    expect(d).toBeDefined();
    expect(d?.centsDiff).toBe(50);
  });

  it("quantity mismatch surfaces a quantity Discrepancy", () => {
    const rated = [ratedLine({ quantity: 10 })];
    const lindita = [linditaLine({ quantity: 11 })];
    const report = reconcileAgainstLindita(rated, lindita, cfg);
    expect(report.matched).toBe(false);
    const d = report.discrepancies.find((x) => x.field === "quantity");
    expect(d).toBeDefined();
    expect(d?.ours).toBe("10");
    expect(d?.lindita).toBe("11");
  });

  it("join is order-independent and case/space tolerant on keys", () => {
    const rated = [ratedLine({ partner: "Acme MSP", customer: "Cust One", sku: sku("SKU-A", "current") })];
    const lindita = [linditaLine({ partner: "  acme   msp ", customer: "cust one", sku: "sku-a" })];
    const report = reconcileAgainstLindita(rated, lindita, cfg);
    expect(report.matched).toBe(true);
    expect(report.onlyInOurs).toHaveLength(0);
    expect(report.onlyInLindita).toHaveLength(0);
  });

  it("aggregates multiple rated rows for one partner+customer+sku before comparing (no false discrepancy)", () => {
    // Real usage often has >1 row per partner+customer+sku (mid-month adds, per-product
    // rows). The invoice rolls these up; Lindita's file has one row. The reconciler must
    // aggregate to the same grain, or a correct close would show spurious discrepancies.
    const rated = [
      ratedLine({ customer: "Cust One", sku: sku("SKU-A", "current"), quantity: 3 }),
      ratedLine({ customer: "Cust One", sku: sku("SKU-A", "current"), quantity: 2, sourceRow: 3 }),
    ];
    // One Lindita row for the same key at qty 5 (= 3 + 2), same unit H/L.
    const lindita = [linditaLine({ customer: "Cust One", sku: "SKU-A", quantity: 5 })];

    const report = reconcileAgainstLindita(rated, lindita, cfg);
    expect(report.matched).toBe(true);
    expect(report.discrepancies).toHaveLength(0);
    expect(report.onlyInOurs).toHaveLength(0);
    expect(report.onlyInLindita).toHaveLength(0);
    // Extended total on our side = 9 * (3 + 2) = 45.00, tying to Lindita 9 * 5.
    expect(report.totalOurs.equalsCents(Money.of("45.00"))).toBe(true);
    expect(report.totalOurs.equalsCents(report.totalLindita)).toBe(true);
  });

  it("reconToleratedCents allows small drift without failing", () => {
    const tolerated = { ...cfg, reconToleratedCents: 1 };
    // ourPrice differs by 1 cent (6.00 vs 6.01) -> within tolerance
    const rated = [ratedLine({ hubCost: Money.of("6.00") })];
    const lindita = [linditaLine({ ourPrice: Money.of("6.01") })];
    const report = reconcileAgainstLindita(rated, lindita, tolerated);
    expect(report.matched).toBe(true);
    expect(report.discrepancies).toHaveLength(0);
  });
});
