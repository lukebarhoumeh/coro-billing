/**
 * Tests for buildRateCard() / RateCard.lookup().
 *
 * Anchors:
 *   - Dane: "all these ******* partners are on different stuff." => rates are
 *     per-partner+per-SKU; NEVER a house average or a cross-partner fallback.
 *   - Legacy stays separate & visible; current + legacy coexist per partner+SKU.
 *   - Period selection: prefer exact YYYY-MM, else most recent <= target
 *     (string compare on YYYY-MM), else null.
 */
import { describe, it, expect } from "vitest";
import { buildRateCard } from "../../src/rating/rateCardIndex.js";
import { Money } from "../../src/lib/money.js";
import type { RateCardEntry } from "../../src/domain/types.js";

function entry(over: Partial<RateCardEntry> & { partner: string; sku: string }): RateCardEntry {
  return {
    partner: over.partner,
    sku: over.sku,
    period: over.period ?? "2026-08",
    class: over.class ?? "current",
    hubCost: over.hubCost ?? Money.of(5),
    mspPrice: over.mspPrice ?? Money.of(10),
    discountPct: over.discountPct,
    source: over.source ?? "current",
    bufferApplied: over.bufferApplied,
    raw: over.raw ?? {},
  };
}

describe("buildRateCard / lookup", () => {
  it("returns per-partner rows — two partners, same SKU, different H/L (NO averaging)", () => {
    const rc = buildRateCard([
      entry({ partner: "Acme MSP", sku: "CORO-EDR", hubCost: Money.of(6), mspPrice: Money.of(9) }),
      entry({ partner: "Globex MSP", sku: "CORO-EDR", hubCost: Money.of(7), mspPrice: Money.of(12) }),
    ]);

    const a = rc.lookup("Acme MSP", "CORO-EDR", "2026-08");
    const g = rc.lookup("Globex MSP", "CORO-EDR", "2026-08");

    expect(a).not.toBeNull();
    expect(g).not.toBeNull();
    // Per-partner rate is preserved exactly — no average of 6 and 7.
    expect(a!.hubCost.equalsCents(Money.of(6))).toBe(true);
    expect(a!.mspPrice.equalsCents(Money.of(9))).toBe(true);
    expect(g!.hubCost.equalsCents(Money.of(7))).toBe(true);
    expect(g!.mspPrice.equalsCents(Money.of(12))).toBe(true);
  });

  it("normalizes partner+SKU (case / whitespace / punctuation insensitive)", () => {
    const rc = buildRateCard([entry({ partner: "Meeting Tree", sku: "CORO-EDR" })]);
    expect(rc.lookup("meeting  tree", "coro edr", "2026-08")).not.toBeNull();
    expect(rc.lookup("MEETING-TREE", "CORO_EDR", "2026-08")).not.toBeNull();
  });

  it("returns null on a miss — NEVER a house/average fallback", () => {
    const rc = buildRateCard([
      entry({ partner: "Acme MSP", sku: "CORO-EDR" }),
      entry({ partner: "Globex MSP", sku: "CORO-EDR" }),
    ]);
    // Unknown partner+SKU pair: no fallback to any existing row.
    expect(rc.lookup("Initech MSP", "CORO-EDR", "2026-08")).toBeNull();
    // Known partner, unknown SKU: still a miss.
    expect(rc.lookup("Acme MSP", "CORO-DLP", "2026-08")).toBeNull();
  });

  it("prefers the exact period when present", () => {
    const rc = buildRateCard([
      entry({ partner: "Acme MSP", sku: "CORO-EDR", period: "2026-07", hubCost: Money.of(5) }),
      entry({ partner: "Acme MSP", sku: "CORO-EDR", period: "2026-08", hubCost: Money.of(6) }),
    ]);
    const hit = rc.lookup("Acme MSP", "CORO-EDR", "2026-08");
    expect(hit!.hubCost.equalsCents(Money.of(6))).toBe(true);
  });

  it("falls back to the most recent entry with period <= target", () => {
    const rc = buildRateCard([
      entry({ partner: "Acme MSP", sku: "CORO-EDR", period: "2026-05", hubCost: Money.of(4) }),
      entry({ partner: "Acme MSP", sku: "CORO-EDR", period: "2026-07", hubCost: Money.of(5) }),
    ]);
    // Target 2026-08: no exact match; most recent <= 08 is the 07 row.
    const hit = rc.lookup("Acme MSP", "CORO-EDR", "2026-08");
    expect(hit!.period).toBe("2026-07");
    expect(hit!.hubCost.equalsCents(Money.of(5))).toBe(true);
  });

  it("does NOT use a future period newer than the target", () => {
    const rc = buildRateCard([
      entry({ partner: "Acme MSP", sku: "CORO-EDR", period: "2026-09", hubCost: Money.of(8) }),
    ]);
    // Only a future (09) row exists; asking for 08 must miss, not borrow the future.
    expect(rc.lookup("Acme MSP", "CORO-EDR", "2026-08")).toBeNull();
  });

  it("keeps legacy and current rows distinct for the same partner+SKU", () => {
    // Same partner+SKU can appear on both the current and legacy tabs. Both are
    // retained; lookup by period returns the right-period row and preserves class.
    const rc = buildRateCard([
      entry({ partner: "Acme MSP", sku: "CORO-EDR", period: "2026-08", class: "current", hubCost: Money.of(6) }),
      entry({ partner: "Acme MSP", sku: "CORO-EDR-L", period: "2026-08", class: "legacy", hubCost: Money.of(3) }),
    ]);
    const current = rc.lookup("Acme MSP", "CORO-EDR", "2026-08");
    const legacy = rc.lookup("Acme MSP", "CORO-EDR-L", "2026-08");
    expect(current!.class).toBe("current");
    expect(legacy!.class).toBe("legacy");
  });

  it("class-aware lookup: same partner+SKU on both tabs prices from the matching class (the $6-vs-$9 landmine)", () => {
    // Coro's transitional state (Lisa: "moving people off Legacy onto AI"): the SAME
    // partner+SKU exists on BOTH the current tab ($9) and the legacy tab ($6).
    const rc = buildRateCard([
      entry({ partner: "Acme MSP", sku: "CORO-SIEM", period: "2026-08", class: "current", hubCost: Money.of(9), mspPrice: Money.of(14) }),
      entry({ partner: "Acme MSP", sku: "CORO-SIEM", period: "2026-08", class: "legacy", hubCost: Money.of(6), mspPrice: Money.of(9) }),
    ]);

    // A legacy usage line must price from the legacy row ($6), not the current row ($9).
    const legacy = rc.lookup("Acme MSP", "CORO-SIEM", "2026-08", "legacy");
    expect(legacy!.class).toBe("legacy");
    expect(legacy!.hubCost.equalsCents(Money.of(6))).toBe(true);

    // A current usage line prices from the current row ($9).
    const current = rc.lookup("Acme MSP", "CORO-SIEM", "2026-08", "current");
    expect(current!.class).toBe("current");
    expect(current!.hubCost.equalsCents(Money.of(9))).toBe(true);
  });

  it("class-aware lookup falls back across class when the requested class is absent (surfaced later, not silent)", () => {
    // Only a CURRENT row exists; a legacy line still gets a rate (so it is not dropped),
    // and the 'legacy priced as current' reconciliation check flags the mismatch.
    const rc = buildRateCard([
      entry({ partner: "Acme MSP", sku: "CORO-SIEM", period: "2026-08", class: "current", hubCost: Money.of(9) }),
    ]);
    const hit = rc.lookup("Acme MSP", "CORO-SIEM", "2026-08", "legacy");
    expect(hit).not.toBeNull();
    expect(hit!.class).toBe("current"); // cross-class fallback, to be flagged downstream
  });

  it("exposes the underlying entries (read-only view)", () => {
    const rows = [entry({ partner: "Acme MSP", sku: "CORO-EDR" })];
    const rc = buildRateCard(rows);
    expect(rc.entries.length).toBe(1);
  });
});
