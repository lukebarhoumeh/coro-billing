/**
 * Tests for applyRates() — the "magic sauce": attach H and L to every usage line.
 *
 * Anchors:
 *   - Dane: "these two columns are H, our price, and what we're charging L ...
 *     the margin stuff's automatically calculated." => margin = charge - cost.
 *   - Dane: "all these partners are on different stuff" => per-partner rows only.
 *   - Dane: U/D unknown => info exception, never interpreted.
 *   - README reconciliation: "Usage row with no H or L" => a blocking exception,
 *     but the line is RETAINED (never silently dropped).
 *   - Quantity is the driver; zero/neg qty is a warning.
 */
import { describe, it, expect } from "vitest";
import { applyRates } from "../../src/rating/applyRates.js";
import { buildRateCard } from "../../src/rating/rateCardIndex.js";
import { Money } from "../../src/lib/money.js";
import { defaultConfig } from "../../src/config/pipeline.config.js";
import type { RateCardEntry, UsageLine, Sku, UnknownField } from "../../src/domain/types.js";

const PERIOD = "2026-08";
const cfg = defaultConfig(PERIOD);

function unknown(raw: string | number | null): UnknownField {
  return { raw, known: false };
}

function sku(over: Partial<Sku> & { vendorSku: string }): Sku {
  return {
    vendorSku: over.vendorSku,
    class: over.class ?? "current",
    isLegacy: over.isLegacy ?? false,
    product: over.product,
    description: over.description,
  };
}

function usage(over: Partial<UsageLine> & { partner: string; sku: Sku }): UsageLine {
  return {
    period: over.period ?? PERIOD,
    partner: over.partner,
    customer: over.customer ?? "Cust A",
    sku: over.sku,
    quantity: over.quantity ?? 1,
    subtype: over.subtype,
    product: over.product,
    u: over.u ?? unknown(null),
    d: over.d ?? unknown(null),
    raw: over.raw ?? {},
    sourceRow: over.sourceRow ?? 2,
  };
}

function rate(over: Partial<RateCardEntry> & { partner: string; sku: string }): RateCardEntry {
  return {
    partner: over.partner,
    sku: over.sku,
    period: over.period ?? PERIOD,
    class: over.class ?? "current",
    hubCost: over.hubCost ?? Money.of(5),
    mspPrice: over.mspPrice ?? Money.of(10),
    discountPct: over.discountPct,
    source: over.source ?? "current",
    bufferApplied: over.bufferApplied,
    raw: over.raw ?? {},
  };
}

describe("applyRates — happy path", () => {
  it("attaches H and L and computes amounts + margin cent-exact", () => {
    const rc = buildRateCard([
      rate({ partner: "Acme MSP", sku: "CORO-EDR", hubCost: Money.of(6), mspPrice: Money.of(9) }),
    ]);
    const { rated, exceptions } = applyRates(
      [usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR" }), quantity: 4 })],
      rc,
      cfg
    );

    expect(rated).toHaveLength(1);
    const line = rated[0]!;
    expect(line.hubCost.equalsCents(Money.of(6))).toBe(true);
    expect(line.mspPrice.equalsCents(Money.of(9))).toBe(true);
    // amountCost = 6 * 4 = 24 ; amountCharge = 9 * 4 = 36 ; margin = 36 - 24 = 12
    expect(line.amountCost.equalsCents(Money.of(24))).toBe(true);
    expect(line.amountCharge.equalsCents(Money.of(36))).toBe(true);
    expect(line.margin.equalsCents(Money.of(12))).toBe(true);
    // No exceptions on a clean line.
    expect(line.exceptions).toHaveLength(0);
    expect(exceptions).toHaveLength(0);
  });

  it("uses the rate card's explicit H and L as-is (does NOT invent a buffer)", () => {
    // Rate card already carries whatever buffer was applied upstream; applyRates
    // must not re-buffer. H=6.30 (say 6 + 5% already), L=9.
    const rc = buildRateCard([
      rate({ partner: "Acme MSP", sku: "CORO-EDR", hubCost: Money.of("6.30"), mspPrice: Money.of(9) }),
    ]);
    const { rated } = applyRates(
      [usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR" }), quantity: 1 })],
      rc,
      cfg
    );
    expect(rated[0]!.hubCost.equalsCents(Money.of("6.30"))).toBe(true);
  });
});

describe("applyRates — per-partner, no averaging", () => {
  it("prices two partners on the same SKU with their own H/L", () => {
    const rc = buildRateCard([
      rate({ partner: "Acme MSP", sku: "CORO-EDR", hubCost: Money.of(6), mspPrice: Money.of(9) }),
      rate({ partner: "Globex MSP", sku: "CORO-EDR", hubCost: Money.of(7), mspPrice: Money.of(12) }),
    ]);
    const { rated } = applyRates(
      [
        usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR" }), quantity: 1 }),
        usage({ partner: "Globex MSP", sku: sku({ vendorSku: "CORO-EDR" }), quantity: 1 }),
      ],
      rc,
      cfg
    );
    const acme = rated.find((r) => r.partner === "Acme MSP")!;
    const globex = rated.find((r) => r.partner === "Globex MSP")!;
    expect(acme.mspPrice.equalsCents(Money.of(9))).toBe(true);
    expect(globex.mspPrice.equalsCents(Money.of(12))).toBe(true);
    // No cross-partner averaging: Acme != (9+12)/2.
    expect(acme.mspPrice.equalsCents(Money.of("10.50"))).toBe(false);
  });
});

describe("applyRates — exceptions", () => {
  it("MISSING_RATE_CARD_ROW (block) on a miss, but retains the line with zero values", () => {
    const rc = buildRateCard([]); // empty rate card => every line misses
    const { rated, exceptions } = applyRates(
      [usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR" }), quantity: 3 })],
      rc,
      cfg
    );
    // NEVER dropped — the line is still present.
    expect(rated).toHaveLength(1);
    const line = rated[0]!;
    expect(line.hubCost.isZero()).toBe(true);
    expect(line.mspPrice.isZero()).toBe(true);
    expect(line.amountCost.isZero()).toBe(true);
    expect(line.amountCharge.isZero()).toBe(true);
    const ex = line.exceptions.find((e) => e.kind === "MISSING_RATE_CARD_ROW");
    expect(ex).toBeDefined();
    expect(ex!.severity).toBe("block");
    // Also surfaced in the aggregate exceptions list.
    expect(exceptions.some((e) => e.kind === "MISSING_RATE_CARD_ROW")).toBe(true);
  });

  it("MISSING_HUB_COST (block) when H is zero on the rate row", () => {
    const rc = buildRateCard([
      rate({ partner: "Acme MSP", sku: "CORO-EDR", hubCost: Money.zero(), mspPrice: Money.of(9) }),
    ]);
    const { rated } = applyRates(
      [usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR" }) })],
      rc,
      cfg
    );
    const line = rated[0]!;
    const ex = line.exceptions.find((e) => e.kind === "MISSING_HUB_COST");
    expect(ex).toBeDefined();
    expect(ex!.severity).toBe("block");
  });

  it("MISSING_MSP_PRICE (block) when L is zero on the rate row", () => {
    const rc = buildRateCard([
      rate({ partner: "Acme MSP", sku: "CORO-EDR", hubCost: Money.of(6), mspPrice: Money.zero() }),
    ]);
    const { rated } = applyRates(
      [usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR" }) })],
      rc,
      cfg
    );
    const line = rated[0]!;
    const ex = line.exceptions.find((e) => e.kind === "MISSING_MSP_PRICE");
    expect(ex).toBeDefined();
    expect(ex!.severity).toBe("block");
  });

  it("NEGATIVE_OR_ZERO_QTY (warn) for zero quantity — line retained", () => {
    const rc = buildRateCard([rate({ partner: "Acme MSP", sku: "CORO-EDR" })]);
    const { rated } = applyRates(
      [usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR" }), quantity: 0 })],
      rc,
      cfg
    );
    expect(rated).toHaveLength(1);
    const ex = rated[0]!.exceptions.find((e) => e.kind === "NEGATIVE_OR_ZERO_QTY");
    expect(ex).toBeDefined();
    expect(ex!.severity).toBe("warn");
  });

  it("NEGATIVE_OR_ZERO_QTY (warn) for negative quantity", () => {
    const rc = buildRateCard([rate({ partner: "Acme MSP", sku: "CORO-EDR" })]);
    const { rated } = applyRates(
      [usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR" }), quantity: -2 })],
      rc,
      cfg
    );
    const ex = rated[0]!.exceptions.find((e) => e.kind === "NEGATIVE_OR_ZERO_QTY");
    expect(ex!.severity).toBe("warn");
  });

  it("UNKNOWN_UD_FIELD (info) when U is present — carried, never interpreted", () => {
    const rc = buildRateCard([rate({ partner: "Acme MSP", sku: "CORO-EDR" })]);
    const { rated } = applyRates(
      [usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR" }), u: unknown("something") })],
      rc,
      cfg
    );
    const ex = rated[0]!.exceptions.find((e) => e.kind === "UNKNOWN_UD_FIELD");
    expect(ex).toBeDefined();
    expect(ex!.severity).toBe("info");
  });

  it("UNKNOWN_UD_FIELD (info) when D is present", () => {
    const rc = buildRateCard([rate({ partner: "Acme MSP", sku: "CORO-EDR" })]);
    const { rated } = applyRates(
      [usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR" }), d: unknown(1) })],
      rc,
      cfg
    );
    expect(rated[0]!.exceptions.some((e) => e.kind === "UNKNOWN_UD_FIELD")).toBe(true);
  });

  it("does NOT emit UNKNOWN_UD_FIELD when both U and D are null", () => {
    const rc = buildRateCard([rate({ partner: "Acme MSP", sku: "CORO-EDR" })]);
    const { rated } = applyRates(
      [usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR" }) })],
      rc,
      cfg
    );
    expect(rated[0]!.exceptions.some((e) => e.kind === "UNKNOWN_UD_FIELD")).toBe(false);
  });

  it("SKU_CLASS_NOISE (block) when the SKU could not be classified", () => {
    const rc = buildRateCard([]);
    const { rated } = applyRates(
      [usage({ partner: "Acme MSP", sku: sku({ vendorSku: "", class: "noise" }) })],
      rc,
      cfg
    );
    expect(rated).toHaveLength(1);
    const ex = rated[0]!.exceptions.find((e) => e.kind === "SKU_CLASS_NOISE");
    expect(ex).toBeDefined();
    expect(ex!.severity).toBe("block");
  });
});

describe("applyRates — legacy vs current", () => {
  it("preserves the class of the matched rate and prices legacy separately", () => {
    const rc = buildRateCard([
      rate({ partner: "Acme MSP", sku: "CORO-EDR", class: "current", hubCost: Money.of(6), mspPrice: Money.of(9) }),
      rate({ partner: "Acme MSP", sku: "CORO-LEG", class: "legacy", hubCost: Money.of(3), mspPrice: Money.of(6) }),
    ]);
    const { rated } = applyRates(
      [
        usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR", class: "current" }) }),
        usage({
          partner: "Acme MSP",
          sku: sku({ vendorSku: "CORO-LEG", class: "legacy", isLegacy: true }),
        }),
      ],
      rc,
      cfg
    );
    const cur = rated.find((r) => r.sku.vendorSku === "CORO-EDR")!;
    const leg = rated.find((r) => r.sku.vendorSku === "CORO-LEG")!;
    expect(cur.rate.class).toBe("current");
    expect(leg.rate.class).toBe("legacy");
    // Legacy H/L preserved distinctly (not the current one).
    expect(leg.hubCost.equalsCents(Money.of(3))).toBe(true);
    expect(leg.mspPrice.equalsCents(Money.of(6))).toBe(true);
  });

  it("LEGACY_RATE_UNCONFIRMED (info/warn) when a legacy usage line has no rate-card row", () => {
    // Legacy is the landmine: no row for it yet (Jack's export not landed).
    const rc = buildRateCard([]);
    const { rated } = applyRates(
      [
        usage({
          partner: "Acme MSP",
          sku: sku({ vendorSku: "CORO-LEG", class: "legacy", isLegacy: true }),
        }),
      ],
      rc,
      cfg
    );
    const line = rated[0]!;
    const ex = line.exceptions.find((e) => e.kind === "LEGACY_RATE_UNCONFIRMED");
    expect(ex).toBeDefined();
    expect(["info", "warn"]).toContain(ex!.severity);
    // Still also a blocking MISSING_RATE_CARD_ROW; the line is retained.
    expect(line.exceptions.some((e) => e.kind === "MISSING_RATE_CARD_ROW")).toBe(true);
  });
});

describe("applyRates — determinism", () => {
  it("emits the aggregate exceptions in a stable, input-ordered way", () => {
    const rc = buildRateCard([]);
    const run = () =>
      applyRates(
        [
          usage({ partner: "Globex MSP", sku: sku({ vendorSku: "CORO-EDR" }), sourceRow: 3 }),
          usage({ partner: "Acme MSP", sku: sku({ vendorSku: "CORO-EDR" }), sourceRow: 2 }),
        ],
        rc,
        cfg
      );
    const a = run();
    const b = run();
    expect(a.exceptions.map((e) => `${e.partner}/${e.kind}`)).toEqual(
      b.exceptions.map((e) => `${e.partner}/${e.kind}`)
    );
  });
});
