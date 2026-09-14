/**
 * Tests for the Hub buffer + legacy-from-list utilities.
 *
 * Anchors (Sep 11 2026 call, README "Commercial model"):
 *   - Dane: "we should have a 5% buffer on anything ... a legacy one where
 *     they're getting like a 60% discount ... we automatically should get a 65."
 *     => applyHubBuffer(0.60) === 0.65
 *   - Lisa: "the legacy SKU cost in that tab and 45% ... the list price with the
 *     45% discount. And that's yours." => legacyHubCostFromList(list) = list - 45%.
 */
import { describe, it, expect } from "vitest";
import { applyHubBuffer, legacyHubCostFromList } from "../../src/rating/buffer.js";
import { Money } from "../../src/lib/money.js";
import { BUSINESS } from "../../src/config/pipeline.config.js";

describe("applyHubBuffer", () => {
  it("turns Dane's 60% discount into 65% (0.60 -> 0.65)", () => {
    expect(applyHubBuffer(0.6)).toBeCloseTo(0.65, 10);
  });

  it("uses BUSINESS.hubBufferPct (0.05) by default", () => {
    expect(applyHubBuffer(0.4)).toBeCloseTo(0.4 + BUSINESS.hubBufferPct, 10);
  });

  it("respects an explicit buffer override", () => {
    expect(applyHubBuffer(0.5, 0.1)).toBeCloseTo(0.6, 10);
  });

  it("is pure — no clamping surprises for a 0 discount", () => {
    expect(applyHubBuffer(0)).toBeCloseTo(0.05, 10);
  });
});

describe("legacyHubCostFromList", () => {
  it("applies Lisa's straight 45% legacy discount off list", () => {
    // $100 list - 45% = $55.00 Hub cost.
    const cost = legacyHubCostFromList(Money.of(100));
    expect(cost.equalsCents(Money.of(55))).toBe(true);
  });

  it("honors a custom legacy discount percent", () => {
    // $100 - 50% = $50.00
    const cost = legacyHubCostFromList(Money.of(100), { legacyDiscountPct: 0.5 });
    expect(cost.equalsCents(Money.of(50))).toBe(true);
  });

  it("layers the buffer into the effective discount when applyBuffer is set", () => {
    // 45% + 5% buffer = 50% effective discount => $100 - 50% = $50.00
    const cost = legacyHubCostFromList(Money.of(100), { applyBuffer: true });
    expect(cost.equalsCents(Money.of(50))).toBe(true);
  });

  it("respects both a custom discount and a custom buffer when layering", () => {
    // 60% + 5% buffer (0.05) = 65% => $200 - 65% = $70.00
    const cost = legacyHubCostFromList(Money.of(200), {
      legacyDiscountPct: 0.6,
      bufferPct: 0.05,
      applyBuffer: true,
    });
    expect(cost.equalsCents(Money.of(70))).toBe(true);
  });

  it("does not apply the buffer unless explicitly asked (documented legacy-from-list path only)", () => {
    // Without applyBuffer: only the 45% discount, buffer ignored even if provided.
    const cost = legacyHubCostFromList(Money.of(100), { bufferPct: 0.05 });
    expect(cost.equalsCents(Money.of(55))).toBe(true);
  });
});
