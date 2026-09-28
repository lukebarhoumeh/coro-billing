/**
 * Trends math over CloseSnapshots (spec 2026-09-28 §4). Pure and clock-free.
 * Waterfall uses standard price-volume-mix per partner×SKU:
 *   volume = Δqty × oldRate ; rate = Δrate × newQty (cross term rides in rate —
 *   stated in the UI tooltip). Lines without unitL (held) are excluded, which
 *   matches how close totals are built. Invariant: start + Σdeltas = end, in cents.
 */
import type { CloseSnapshot } from "../domain/snapshot.js";

const cents = (s: string | undefined): number => (s === undefined ? 0 : Math.round(Number(s) * 100));

export interface TrendPoint {
  readonly period: string;
  readonly billedCents: number;
  readonly costExpectedCents: number;
  readonly costActualCents: number | null;
  readonly marginCents: number;
}

export function trendSeries(snaps: readonly CloseSnapshot[]): TrendPoint[] {
  return [...snaps]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((s) => ({
      period: s.period,
      billedCents: cents(s.totals.billedL),
      costExpectedCents: cents(s.totals.costExpected),
      costActualCents: s.totals.costActual !== undefined ? cents(s.totals.costActual) : null,
      marginCents: cents(s.totals.margin),
    }));
}

export type PartnerDelta = { kind: "new" } | { kind: "delta"; pct: number };

/** Per-partner billed change vs the prior snapshot, joined by slug. */
export function partnerDeltas(
  curr: CloseSnapshot,
  prev: CloseSnapshot | null
): Map<string, PartnerDelta> {
  const out = new Map<string, PartnerDelta>();
  if (prev === null) return out;
  const prevBy = new Map(prev.partners.map((p) => [p.slug, cents(p.billedL)]));
  for (const p of curr.partners) {
    const before = prevBy.get(p.slug);
    if (before === undefined) { out.set(p.slug, { kind: "new" }); continue; }
    if (before === 0) continue; // avoid divide-by-zero noise (zero-billed prior)
    const pct = Math.round(((cents(p.billedL) - before) / before) * 100);
    out.set(p.slug, { kind: "delta", pct });
  }
  return out;
}

export interface WaterfallBucket {
  readonly key: "start" | "new-partners" | "discontinued" | "volume" | "rate" | "end";
  readonly label: string;
  readonly amountCents: number;
  readonly kind: "total" | "delta";
}

export function waterfall(prev: CloseSnapshot, curr: CloseSnapshot): WaterfallBucket[] {
  interface LineAgg { qty: number; rateCents: number }
  const index = (s: CloseSnapshot): Map<string, LineAgg> => {
    const m = new Map<string, LineAgg>();
    for (const p of s.partners) for (const l of p.lines) {
      if (l.unitL === undefined) continue; // held lines are outside totals
      m.set(`${p.slug}|${l.vendorSku.toLowerCase()}`, { qty: l.quantity, rateCents: cents(l.unitL) });
    }
    return m;
  };
  const before = index(prev);
  const after = index(curr);
  const prevPartners = new Set(prev.partners.map((p) => p.slug));

  let newPartners = 0, discontinued = 0, volume = 0, rate = 0;
  for (const [key, a] of after) {
    const slug = key.split("|")[0]!;
    const b = before.get(key);
    if (b === undefined) {
      const amt = a.qty * a.rateCents;
      if (prevPartners.has(slug)) volume += amt; // new SKU on an existing partner = volume
      else newPartners += amt;
      continue;
    }
    volume += (a.qty - b.qty) * b.rateCents;
    rate += (a.rateCents - b.rateCents) * a.qty;
  }
  for (const [key, b] of before) {
    if (!after.has(key)) discontinued -= b.qty * b.rateCents;
  }

  const start = cents(prev.totals.billedL);
  const end = cents(curr.totals.billedL);
  // Rounding residue (amounts vs qty×rate cents) rides in rate so the bridge ties exactly.
  rate += end - (start + newPartners + discontinued + volume + rate);

  return [
    { key: "start", label: prev.period, amountCents: start, kind: "total" },
    { key: "new-partners", label: "New partners", amountCents: newPartners, kind: "delta" },
    { key: "discontinued", label: "Discontinued", amountCents: discontinued, kind: "delta" },
    { key: "volume", label: "Volume", amountCents: volume, kind: "delta" },
    { key: "rate", label: "Rate changes", amountCents: rate, kind: "delta" },
    { key: "end", label: curr.period, amountCents: end, kind: "total" },
  ];
}
