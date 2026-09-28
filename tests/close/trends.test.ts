import { describe, it, expect } from "vitest";
import { trendSeries, partnerDeltas, waterfall } from "../../src/close/trends.js";
import type { CloseSnapshot } from "../../src/domain/snapshot.js";

function snap(
  period: string,
  partners: Array<{ slug: string; name: string; lines: Array<{ sku: string; qty: number; unitL?: string }> }>
): CloseSnapshot {
  const ps = partners.map((p) => {
    const lines = p.lines.map((l) => ({
      vendorSku: l.sku, productLabel: l.sku, quantity: l.qty,
      ...(l.unitL !== undefined
        ? { unitL: l.unitL, amountL: (Number(l.unitL) * l.qty).toFixed(2) }
        : {}),
      marginBasis: "none" as const, customers: [],
    }));
    const billed = lines.reduce((s, l) => s + ("amountL" in l ? Number(l.amountL) : 0), 0).toFixed(2);
    return {
      slug: p.slug, cardName: p.name, billedL: billed, costExpected: "0.00",
      margin: "0.00", creditExpected: "0.00", heldLines: 0, lines,
    };
  });
  const billedL = ps.reduce((s, p) => s + Number(p.billedL), 0).toFixed(2);
  return {
    v: 1, period, savedAt: `${period}-28T00:00:00.000Z`, ratesRevision: 1,
    fingerprints: { pricing: "aaaaaaaaaaaa", usage: "bbbbbbbbbbbb" },
    totals: { billedL, costExpected: "0.00", margin: "0.00", creditExpected: "0.00" },
    partners: ps, creditStatus: {},
  };
}

const JUL = snap("2026-07", [
  { slug: "a", name: "Alpha", lines: [{ sku: "X", qty: 10, unitL: "5.00" }] },      // 50.00
  { slug: "gone", name: "Gone", lines: [{ sku: "X", qty: 4, unitL: "2.50" }] },     // 10.00
]);
const AUG = snap("2026-08", [
  { slug: "a", name: "Alpha", lines: [{ sku: "X", qty: 12, unitL: "6.00" }] },      // 72.00: vol +10, rate +12
  { slug: "n", name: "Newbie", lines: [{ sku: "Y", qty: 3, unitL: "8.00" }] },      // 24.00 new
]);

describe("trendSeries", () => {
  it("orders by period and carries totals", () => {
    const s = trendSeries([AUG, JUL]);
    expect(s.map((p) => p.period)).toEqual(["2026-07", "2026-08"]);
    expect(s[0]!.billedCents).toBe(6000);
    expect(s[1]!.billedCents).toBe(9600);
  });
});

describe("partnerDeltas", () => {
  it("computes pct vs prior and tags new partners", () => {
    const d = partnerDeltas(AUG, JUL);
    expect(d.get("a")).toEqual({ kind: "delta", pct: 44 }); // 50 → 72
    expect(d.get("n")).toEqual({ kind: "new" });
  });
  it("returns empty map with no prior snapshot", () => {
    expect(partnerDeltas(AUG, null).size).toBe(0);
  });
});

describe("waterfall", () => {
  it("decomposes into volume/rate/new/discontinued and the bridge sums exactly", () => {
    const b = waterfall(JUL, AUG);
    const byKey = Object.fromEntries(b.map((x) => [x.key, x.amountCents]));
    expect(byKey["start"]).toBe(6000);
    expect(byKey["end"]).toBe(9600);
    expect(byKey["new-partners"]).toBe(2400);
    expect(byKey["discontinued"]).toBe(-1000);
    expect(byKey["volume"]).toBe(1000);  // Δqty 2 × old 5.00
    expect(byKey["rate"]).toBe(1200);    // Δrate 1.00 × new qty 12
    const middle = b.filter((x) => x.kind === "delta").reduce((s, x) => s + x.amountCents, 0);
    expect(byKey["start"]! + middle).toBe(byKey["end"]);
  });
});
