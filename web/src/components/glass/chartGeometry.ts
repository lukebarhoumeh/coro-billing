/**
 * Pure SVG geometry for the Obsidian Glass charts. DOM-free by design (same
 * rule as loadFiles.ts) so plain-Node vitest covers it; components only wire
 * these paths into <svg>.
 */
export function scaleLinear(
  domain: readonly [number, number],
  range: readonly [number, number]
): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) return () => r0;
  return (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

function pointsFor(values: readonly number[], w: number, h: number, pad: number) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = scaleLinear([0, values.length - 1], [pad, w - pad]);
  const y = scaleLinear([lo, hi], [h - pad, pad]);
  return values.map((v, i) => ({ x: x(i), y: y(v) }));
}

/** Polyline path for a sparkline; "" when there is nothing to draw. */
export function buildSparklinePath(
  values: readonly number[],
  w: number,
  h: number,
  pad: number
): string {
  if (values.length < 2) return "";
  const pts = pointsFor(values, w, h, pad);
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}

/** Sparkline path closed down to the baseline for a gradient fill. */
export function buildAreaPath(
  values: readonly number[],
  w: number,
  h: number,
  pad: number
): string {
  if (values.length < 2) return "";
  const line = buildSparklinePath(values, w, h, pad);
  const pts = pointsFor(values, w, h, pad);
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  return `${line} L${last.x.toFixed(2)} ${h - pad} L${first.x.toFixed(2)} ${h - pad} Z`;
}

export interface WaterfallInput {
  readonly key: string;
  readonly label: string;
  readonly amountCents: number; // totals: absolute level; deltas: signed change
  readonly kind: "total" | "delta";
}
export interface WaterfallBar {
  readonly key: string;
  readonly label: string;
  readonly amountCents: number;
  readonly kind: "total" | "delta";
  readonly up: boolean;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Classic bridge layout: totals grounded at 0, deltas floating from the running level. */
export function layoutWaterfall(
  buckets: readonly WaterfallInput[],
  width: number,
  height: number
): WaterfallBar[] {
  const pad = 20;
  const baseline = height - 30;
  let running = 0;
  let peak = 0;
  const levels = buckets.map((b) => {
    if (b.kind === "total") { running = b.amountCents; peak = Math.max(peak, running); return { from: 0, to: running }; }
    const from = running; running += b.amountCents; peak = Math.max(peak, from, running);
    return { from, to: running };
  });
  const y = scaleLinear([0, Math.max(peak, 1)], [baseline, pad]);
  const slot = (width - pad * 2) / buckets.length;
  const barW = Math.min(72, slot * 0.72);
  return buckets.map((b, i) => {
    const { from, to } = levels[i]!;
    const top = Math.min(y(from), y(to));
    const bottom = Math.max(y(from), y(to));
    return {
      key: b.key, label: b.label, amountCents: b.amountCents, kind: b.kind,
      up: b.kind === "total" ? true : b.amountCents >= 0,
      x: pad + slot * i + (slot - barW) / 2,
      y: top, w: barW, h: Math.max(bottom - top, 2),
    };
  });
}
