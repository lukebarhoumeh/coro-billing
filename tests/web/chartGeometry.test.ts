/** Pure SVG geometry for the glass charts — DOM-free, runs under plain Node. */
import { describe, it, expect } from "vitest";
import {
  scaleLinear,
  buildSparklinePath,
  buildAreaPath,
  layoutWaterfall,
} from "../../web/src/components/glass/chartGeometry.js";

describe("scaleLinear", () => {
  it("maps domain to range linearly", () => {
    const s = scaleLinear([0, 10], [0, 100]);
    expect(s(0)).toBe(0);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(100);
  });
  it("handles a zero-width domain by pinning to range start", () => {
    const s = scaleLinear([5, 5], [0, 100]);
    expect(s(5)).toBe(0);
  });
});

describe("buildSparklinePath", () => {
  it("produces one M and n-1 L segments across the width", () => {
    const d = buildSparklinePath([1, 2, 3], 72, 26, 4);
    expect(d.startsWith("M")).toBe(true);
    expect(d.match(/L/g)).toHaveLength(2);
  });
  it("returns empty string for fewer than 2 points", () => {
    expect(buildSparklinePath([5], 72, 26, 4)).toBe("");
  });
});

describe("buildAreaPath", () => {
  it("closes the polygon down to the baseline", () => {
    const d = buildAreaPath([1, 2], 100, 50, 4);
    expect(d.endsWith("Z")).toBe(true);
  });
});

describe("layoutWaterfall", () => {
  it("stacks running totals and keeps totals bars grounded", () => {
    const bars = layoutWaterfall(
      [
        { key: "start", label: "July", amountCents: 100, kind: "total" },
        { key: "volume", label: "Volume", amountCents: 50, kind: "delta" },
        { key: "rate", label: "Rate", amountCents: -30, kind: "delta" },
        { key: "end", label: "Aug", amountCents: 120, kind: "total" },
      ],
      400,
      170
    );
    expect(bars).toHaveLength(4);
    // totals sit on the baseline; deltas float from the running total
    expect(bars[0]!.y + bars[0]!.h).toBeCloseTo(bars[3]!.y + bars[3]!.h, 5);
    // a negative delta drops from the prior running level
    expect(bars[2]!.y).toBeGreaterThanOrEqual(bars[1]!.y);
    // every bar carries its label + sign for rendering
    expect(bars[1]!.up).toBe(true);
    expect(bars[2]!.up).toBe(false);
  });
});
