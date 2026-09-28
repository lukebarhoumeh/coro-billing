# Obsidian Glass Redesign + Insights Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the coro-billing workbench as "Obsidian Glass" (layered dark glass, institutional-grade motion) and add the insights layer — close archive, Trends screen (MoM charts + GP waterfall), rate intelligence, end-customer analytics, credit tracker, report pack — per `docs/superpowers/specs/2026-09-28-obsidian-glass-redesign-design.md`.

**Architecture:** Visual layer = CSS tokens + a `web/src/components/glass/` primitive kit adopted screen-by-screen (behavior frozen). Insights layer = pure, clock-free logic in `src/domain/snapshot.ts` + `src/close/trends.ts` (TDD, plain-Node vitest), a KV-injected archive store `web/src/lib/closeArchive.ts` (same discipline as `qbo.ts`), one new screen `Trends`, and feature sections added in place. Charts are hand-rolled SVG via pure geometry helpers. No new runtime dependencies.

**Tech Stack:** React 18 + Vite + Tailwind (web), TypeScript ESM, zod (already a root dep), decimal.js Money (existing), vitest, Playwright MCP for visual verification.

**Conventions (this repo):**
- Solo-dev single-main: commit directly to `main`, small green commits. No worktree.
- Run tests as `pnpm test tests/<path>` from repo root (the `--` form doesn't filter). Full suite: `pnpm test` (320 green today).
- Web gates: `cd web; pnpm typecheck; pnpm build` (root `pnpm typecheck` has 3 pre-existing errors — not your problem, don't fix, don't add to them).
- Web imports use `@/` alias inside `web/src`, and relative `../../../src/...js` for root-engine imports.
- Money is `src/lib/money.ts` (`Money.of`, `.toCents()`, `.toFixed2()`); snapshots serialize Money as `toFixed2()` strings.
- The engine is clock-free: `Date.now()` only in UI layers, always passed in as a parameter.
- PowerShell gotcha: never put `"` characters inside git commit messages (breaks native-arg marshalling); use here-strings as shown.
- Reference mockup for every visual decision: `.superpowers/brainstorm/765-1790616020/content/obsidian-hero.html` (open it in a browser next to your work).

---

## Phase 1 — Tokens + glass primitives

### Task 1: Obsidian Glass tokens (CSS + Tailwind)

**Files:**
- Modify: `web/src/index.css` (the `:root` block and `body` background, ~lines 14–90)
- Modify: `web/tailwind.config.js` (theme.extend)

- [ ] **Step 1: Extend `:root` in `web/src/index.css`.** Keep every existing variable (screens still reference them during migration). ADD these below the existing danger tokens:

```css
  /* ---- Obsidian Glass (Midnight Ledger v2) ---- */
  --glass-1: 0 0% 100% / 0.04;   /* panel surface */
  --glass-2: 0 0% 100% / 0.06;   /* hover / elevated */
  --glass-3: 0 0% 100% / 0.085;  /* overlay chips */
  --edge: 0 0% 100% / 0.08;      /* hairline border */
  --edge-hi: 0 0% 100% / 0.17;   /* top-edge light */
  --brass-glow: 41 62% 60% / 0.22;
  --radius-glass: 16px;
  --ease-glass: cubic-bezier(0.16, 1, 0.3, 1);
```

- [ ] **Step 2: Replace the `body` background** (keep the paper-grain `body::before` block untouched) with the layered ground from the spec:

```css
body {
  margin: 0;
  background-color: #0a0d18; /* no pure black — spec §1 */
  background-image:
    radial-gradient(1100px 550px at 12% -12%, hsl(41 62% 60% / 0.07), transparent 55%),
    radial-gradient(900px 520px at 96% 108%, hsl(210 65% 62% / 0.06), transparent 55%),
    linear-gradient(165deg, #0a0d18 0%, #0b101f 50%, #090c16 100%);
  background-attachment: fixed;
  color: hsl(var(--foreground));
  font-family: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 3: Add ambient blobs + motion utilities** at the end of `index.css`:

```css
/* ---- Obsidian Glass ambient layer (transform-only; off under reduced motion) ---- */
.ambient-blob { position: fixed; border-radius: 50%; filter: blur(46px); pointer-events: none; z-index: 0; }
.ambient-blob--brass { width: 480px; height: 480px; left: -140px; top: -120px;
  background: hsl(41 62% 60% / 0.10); animation: drift-a 52s var(--ease-glass) infinite alternate; }
.ambient-blob--ink { width: 420px; height: 420px; right: -120px; bottom: -140px;
  background: hsl(210 65% 62% / 0.09); animation: drift-b 64s var(--ease-glass) infinite alternate; }
@keyframes drift-a { to { transform: translate(120px, 90px); } }
@keyframes drift-b { to { transform: translate(-100px, -80px); } }

/* staggered entrance — apply .fade-up + inline animation-delay (cap: first 12 items) */
.fade-up { opacity: 0; transform: translateY(10px); animation: fadeup 0.5s var(--ease-glass) forwards; }
@keyframes fadeup { to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .ambient-blob { animation: none; }
  .fade-up { animation: none; opacity: 1; transform: none; }
}

/* brass focus rings on every interactive element (spec §1 accessibility) */
:focus-visible {
  outline: 2px solid hsl(var(--primary));
  outline-offset: 2px;
  border-radius: 4px;
}
```

- [ ] **Step 4: Extend `web/tailwind.config.js` theme.extend** — add to `colors`, `borderRadius`, `boxShadow`, and add `transitionTimingFunction`:

```js
      colors: {
        /* ...existing entries stay... */
        glass: {
          1: "hsl(var(--glass-1))",
          2: "hsl(var(--glass-2))",
          3: "hsl(var(--glass-3))",
        },
        edge: { DEFAULT: "hsl(var(--edge))", hi: "hsl(var(--edge-hi))" },
      },
      borderRadius: {
        /* ...existing... */
        glass: "var(--radius-glass)",
      },
      boxShadow: {
        /* ...existing ledger shadows stay... */
        glass: "0 10px 34px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.05)",
        "glass-lift": "0 16px 44px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.07)",
        "brass-glow": "0 4px 18px hsl(var(--brass-glow))",
      },
      transitionTimingFunction: { glass: "cubic-bezier(0.16, 1, 0.3, 1)" },
```

- [ ] **Step 5: Verify build.** Run from `web/`: `pnpm typecheck` then `pnpm build`. Expected: both clean (CSS-only change).

- [ ] **Step 6: Commit**

```powershell
git add web/src/index.css web/tailwind.config.js
git commit -m @'
feat(web): Obsidian Glass tokens - glass surfaces, edges, ambient layer, motion utilities
'@
```

### Task 2: Chart geometry helpers (pure, TDD)

**Files:**
- Create: `web/src/components/glass/chartGeometry.ts`
- Test: `tests/web/chartGeometry.test.ts`

- [ ] **Step 1: Write the failing tests** in `tests/web/chartGeometry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure.** `pnpm test tests/web/chartGeometry.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `web/src/components/glass/chartGeometry.ts`:**

```ts
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
```

- [ ] **Step 4: Run to verify pass.** `pnpm test tests/web/chartGeometry.test.ts` → PASS (6 tests).

- [ ] **Step 5: Commit**

```powershell
git add web/src/components/glass/chartGeometry.ts tests/web/chartGeometry.test.ts
git commit -m @'
feat(web): pure SVG chart geometry - scales, sparkline/area paths, waterfall bridge layout
'@
```

### Task 3: Glass primitive components

**Files:**
- Create: `web/src/components/glass/GlassPanel.tsx`
- Create: `web/src/components/glass/KpiCard.tsx`
- Create: `web/src/components/glass/AnimatedNumber.tsx`
- Create: `web/src/components/glass/TrendChip.tsx`
- Create: `web/src/components/glass/StatusPill.tsx`
- Create: `web/src/components/glass/Sparkline.tsx`
- Create: `web/src/components/glass/AreaChart.tsx`
- Create: `web/src/components/glass/WaterfallChart.tsx`
- Create: `web/src/components/glass/AmbientLayer.tsx`

These are presentational only — no closeStore imports, no engine imports (except chartGeometry). Visual reference for every prop combination: `obsidian-hero.html`.

- [ ] **Step 1: `GlassPanel.tsx`** — the workhorse surface:

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Obsidian Glass panel. Blur lives HERE (bounded surface) — never on table
 * rows (spec §1 blur budget: ≤6 blurred surfaces per viewport).
 */
export function GlassPanel({
  title, hint, right, children, className, flat,
}: {
  title?: ReactNode; hint?: ReactNode; right?: ReactNode;
  children: ReactNode; className?: string;
  /** flat: translucent surface WITHOUT backdrop blur (for busy screens near budget) */
  flat?: boolean;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-glass border border-edge shadow-glass",
        "bg-glass-1 [border-top-color:hsl(var(--edge-hi))]",
        !flat && "backdrop-blur-[12px]",
        className
      )}
    >
      {(title !== undefined || right !== undefined) && (
        <header className="flex items-center gap-2.5 border-b border-edge px-4 py-3">
          {title !== undefined && <h3 className="font-display text-[15px] text-foreground">{title}</h3>}
          {hint !== undefined && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
          {right !== undefined && <div className="ml-auto flex items-center gap-2">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
```

- [ ] **Step 2: `AnimatedNumber.tsx`** — count-up on mount, reduced-motion aware:

```tsx
import { useEffect, useRef, useState } from "react";

/**
 * Counts a preformatted money string up on mount (hero KPIs only, 900ms
 * cubic ease-out). value must look like "$13,957.76" or "13,957.76".
 * Under prefers-reduced-motion it renders the final value immediately.
 */
export function AnimatedNumber({ value, durationMs = 900 }: { value: string; durationMs?: number }) {
  const [text, setText] = useState(value);
  const raf = useRef(0);
  useEffect(() => {
    const numeric = Number(value.replace(/[^0-9.-]/g, ""));
    const prefix = value.startsWith("$") ? "$" : "";
    if (
      !Number.isFinite(numeric) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) { setText(value); return; }
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setText(prefix + (numeric * eased).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setText(value);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, durationMs]);
  return <span className="tabular-nums">{text}</span>;
}
```

- [ ] **Step 3: `TrendChip.tsx` + `StatusPill.tsx`:**

```tsx
// TrendChip.tsx
import { cn } from "@/lib/cn";

export type TrendTone = "up" | "down" | "flat" | "warn" | "new";

/** Small delta chip: ▲ +4.2% / ▼ −1.1% / NEW / — . Icon+text, never color alone. */
export function TrendChip({ tone, children }: { tone: TrendTone; children?: React.ReactNode }) {
  const arrow = tone === "up" ? "▲" : tone === "down" ? "▼" : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] tabular-nums",
        tone === "up" && "border-success/25 bg-success/10 text-success",
        tone === "down" && "border-danger/25 bg-danger/10 text-danger",
        tone === "flat" && "border-edge bg-glass-1 text-muted-foreground",
        tone === "warn" && "border-warning/30 bg-warning/10 text-warning",
        tone === "new" && "border-accent/30 bg-accent/10 text-accent"
      )}
    >
      {tone === "new" ? "NEW" : (<><span aria-hidden>{arrow}</span>{children}</>)}
    </span>
  );
}
```

```tsx
// StatusPill.tsx
import { cn } from "@/lib/cn";
import type { CreditStatus } from "../../../../src/domain/snapshot.js";

const LABEL: Record<CreditStatus, string> = {
  expected: "expected",
  "memo-received": "memo received",
  applied: "applied",
};

export function StatusPill({ status }: { status: CreditStatus }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[10.5px]",
        status === "expected" && "border-warning/30 bg-warning/10 text-warning",
        status === "memo-received" && "border-accent/30 bg-accent/10 text-accent",
        status === "applied" && "border-success/25 bg-success/10 text-success"
      )}
    >
      {LABEL[status]}
    </span>
  );
}
```

(Note: `CreditStatus` is created in Task 7 — build order within Phase 3 revisits this import; until Task 7 lands, keep the type inline as `type CreditStatus = "expected" | "memo-received" | "applied"` and swap to the import in Task 7's cleanup step.)

- [ ] **Step 4: `KpiCard.tsx`:**

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AnimatedNumber } from "./AnimatedNumber";

export function KpiCard({
  label, value, hero, valueClassName, delta, spark, animate,
}: {
  label: string; value: string; hero?: boolean;
  valueClassName?: string; delta?: ReactNode; spark?: ReactNode;
  /** count-up (hero card only per spec motion budget) */
  animate?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-glass border border-edge p-4 shadow-glass",
        "backdrop-blur-[14px] transition-[transform,box-shadow] duration-200 ease-glass",
        "hover:-translate-y-[3px] hover:shadow-glass-lift",
        "[border-top-color:hsl(var(--edge-hi))]",
        hero
          ? "border-primary/35 bg-gradient-to-br from-primary/15 to-primary/[0.03]"
          : "bg-glass-1"
      )}
    >
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-display text-[27px] font-semibold tabular-nums",
          hero && "text-primary [text-shadow:0_0_26px_hsl(var(--brass-glow))]",
          valueClassName
        )}
      >
        {animate ? <AnimatedNumber value={value} /> : <span className="tabular-nums">{value}</span>}
      </div>
      {delta !== undefined && <div className="mt-1.5">{delta}</div>}
      {spark !== undefined && <div className="absolute right-3 top-3.5 opacity-85">{spark}</div>}
    </div>
  );
}
```

- [ ] **Step 5: `Sparkline.tsx`, `AreaChart.tsx`, `WaterfallChart.tsx`, `AmbientLayer.tsx`:**

```tsx
// Sparkline.tsx
import { buildSparklinePath } from "./chartGeometry";

export function Sparkline({
  values, color = "hsl(var(--primary))", w = 72, h = 26, dashed,
}: { values: readonly number[]; color?: string; w?: number; h?: number; dashed?: boolean }) {
  const d = buildSparklinePath(values, w, h, 4);
  if (d === "") return null;
  const last = values.length - 1;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"
        strokeDasharray={dashed ? "3 3" : undefined} />
      {!dashed && <circle cx={w - 4} cy={h - 4 - ((values[last]! - Math.min(...values)) / Math.max(Math.max(...values) - Math.min(...values), 1)) * (h - 8)} r={2.6} fill={color} />}
    </svg>
  );
}
```

```tsx
// AreaChart.tsx — one filled series + optional dashed companions, with labels.
import { buildAreaPath, buildSparklinePath, scaleLinear } from "./chartGeometry";

export interface AreaSeries {
  readonly label: string;
  readonly values: readonly number[]; // one per period, same length as periods
  readonly color: string;
  readonly dashed?: boolean; // companion series are dashed (line-style, not color, distinguishes)
}

export function AreaChart({
  periods, series, h = 150, ariaSummary,
}: { periods: readonly string[]; series: readonly AreaSeries[]; h?: number; ariaSummary: string }) {
  const w = 640;
  const pad = 30;
  const x = scaleLinear([0, Math.max(periods.length - 1, 1)], [pad + 30, w - pad - 30]);
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={ariaSummary}>
      {[0.25, 0.55, 0.85].map((f) => (
        <line key={f} x1={0} x2={w} y1={h * f} y2={h * f} stroke="rgba(255,255,255,.06)" />
      ))}
      {series.map((s) => (
        <g key={s.label}>
          {!s.dashed && <path d={buildAreaPath(s.values, w, h - 22, 8)} fill={s.color} opacity={0.14} />}
          <path d={buildSparklinePath(s.values, w, h - 22, 8)} fill="none" stroke={s.color}
            strokeWidth={s.dashed ? 2 : 2.5} strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinecap="round" />
        </g>
      ))}
      {periods.map((p, i) => (
        <text key={p} x={x(i)} y={h - 6} fill="hsl(var(--muted-foreground))" fontSize={9} textAnchor="middle">{p}</text>
      ))}
    </svg>
  );
}
```

```tsx
// WaterfallChart.tsx — bridge bars with arrows + labels on EVERY bar (spec §6).
import { layoutWaterfall, type WaterfallInput } from "./chartGeometry";

const COLORS = {
  total: "#3d6ea8",
  up: "hsl(var(--success))",
  down: "hsl(var(--danger))",
};

export function WaterfallChart({
  buckets, h = 170, ariaSummary, formatCents,
}: {
  buckets: readonly WaterfallInput[];
  h?: number;
  ariaSummary: string;
  formatCents: (cents: number) => string;
}) {
  const w = 560;
  const bars = layoutWaterfall(buckets, w, h);
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={ariaSummary}>
      <line x1={0} x2={w} y1={h - 30} y2={h - 30} stroke="rgba(255,255,255,.08)" />
      {bars.map((b, i) => (
        <g key={b.key}>
          {i > 0 && (
            <line x1={bars[i - 1]!.x + bars[i - 1]!.w} y1={b.kind === "delta" ? (b.up ? b.y + b.h : b.y) : b.y}
              x2={b.x} y2={b.kind === "delta" ? (b.up ? b.y + b.h : b.y) : b.y}
              stroke="rgba(255,255,255,.18)" strokeDasharray="3 3" />
          )}
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={5}
            fill={b.kind === "total" ? COLORS.total : b.up ? COLORS.up : COLORS.down}
            opacity={b.kind === "total" ? 1 : 0.9} />
          <text x={b.x + b.w / 2} y={b.y - 7} fontSize={10} textAnchor="middle"
            fill={b.kind === "total" ? "#9fc4ee" : b.up ? "hsl(var(--success))" : "hsl(var(--danger))"}>
            {b.kind === "delta" ? (b.up ? "▲ +" : "▼ ") : ""}{formatCents(b.amountCents)}
          </text>
          <text x={b.x + b.w / 2} y={h - 14} fontSize={9} textAnchor="middle" fill="hsl(var(--muted-foreground))">
            {b.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
```

```tsx
// AmbientLayer.tsx — mount once in App.
export function AmbientLayer() {
  return (
    <>
      <div className="ambient-blob ambient-blob--brass" aria-hidden />
      <div className="ambient-blob ambient-blob--ink" aria-hidden />
    </>
  );
}
```

- [ ] **Step 6: Gates.** From `web/`: `pnpm typecheck` + `pnpm build` → clean. From root: `pnpm test tests/web/chartGeometry.test.ts` → still PASS.

- [ ] **Step 7: Commit**

```powershell
git add web/src/components/glass
git commit -m @'
feat(web): Obsidian Glass primitive kit - GlassPanel, KpiCard, AnimatedNumber, chips, SVG charts, ambient layer
'@
```

---

## Phase 2 — Re-skin (behavior frozen)

**Protocol for every task in this phase:** read the target file fully first; change ONLY classNames/JSX structure, never data flow, handlers, testids, or closeStore usage; keep every `data-testid`. The class mapping is:

| Old pattern | New pattern |
|---|---|
| `bg-card` / `bg-card/60` panel wrappers | `GlassPanel` (or `bg-glass-1 border-edge rounded-glass shadow-glass` where a component swap is too invasive) |
| `rounded-lg` on surfaces | `rounded-glass` |
| `shadow-ledger` | `shadow-glass` |
| `shadow-ledger-lift` / hover states | `hover:-translate-y-[3px] hover:shadow-glass-lift transition-[transform,box-shadow] duration-200 ease-glass` |
| `border-border` on panels | `border-edge [border-top-color:hsl(var(--edge-hi))]` |
| section `<Card>` from ui/card | keep for forms/dialogs; visual parity comes from Task 4's card.tsx retint |
| KPI stat blocks | `KpiCard` |
| entrance animation `animate-rise-in` | `fade-up` with inline `style={{animationDelay}}` stagger (cap 12) |

Tables: rows keep solid/translucent backgrounds (`hover:bg-glass-2`), NO backdrop-blur. All money cells get `tabular-nums` if missing.

### Task 4: Shell + shared ui retint (App.tsx, ui/card, ui/button, ui/badge)

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/ui/card.tsx`, `web/src/components/ui/button.tsx`, `web/src/components/ui/badge.tsx`

- [ ] **Step 1:** In `App.tsx` render, add `<AmbientLayer />` as the first child inside the root div (`import { AmbientLayer } from "@/components/glass/AmbientLayer";`), and add `relative z-[1]` to the `flex flex-1` wrapper so content sits above blobs.
- [ ] **Step 2:** Sidebar `<aside>` (line ~111): replace `border-b border-border bg-card/60 backdrop-blur` with `m-3 h-fit rounded-glass border border-edge bg-glass-1 shadow-glass backdrop-blur-[18px] [border-top-color:hsl(var(--edge-hi))] lg:sticky lg:top-3`. Drop `lg:border-r`/`lg:border-b-0`.
- [ ] **Step 3:** Nav buttons (line ~136): active state → `rounded-[10px] border border-primary/25 bg-gradient-to-r from-primary/15 to-primary/5 font-medium text-primary` (replace the border-l-2 treatment); inactive hover → `hover:bg-glass-2 hover:translate-x-[2px] transition-all duration-200 ease-glass`.
- [ ] **Step 4:** Header (line ~165): keep structure; give the header chips glass style by updating `FileChip`'s base classes: `border-edge bg-glass-1 backdrop-blur-[10px]` for unloaded, keep success tint for loaded.
- [ ] **Step 5:** `ui/card.tsx`: change the Card base classes from its current `bg-card ...` to `rounded-glass border-edge bg-glass-1 shadow-glass [border-top-color:hsl(var(--edge-hi))]` (read the file; preserve its API and sub-components). `ui/button.tsx`: primary variant gains `shadow-brass-glow hover:-translate-y-px transition-[transform,box-shadow] duration-150 ease-glass`; ghost/outline variants use `border-edge bg-glass-1 hover:bg-glass-2`. `ui/badge.tsx`: outline variant → `border-edge bg-glass-3`.
- [ ] **Step 6:** Gates: `cd web; pnpm typecheck; pnpm build` clean. Run full suite from root: `pnpm test` → 320+ PASS (component tests don't render, but web module tests must not break).
- [ ] **Step 7:** Visual check via Playwright MCP: `cd web; pnpm build; pnpm preview` (background), navigate `http://localhost:4173`, load demo data from Intake, screenshot the shell. Compare against `obsidian-hero.html` sidebar/topbar. Kill the preview's child process when done (TaskStop kills the wrapper only, on Windows kill child PIDs).
- [ ] **Step 8:** Commit

```powershell
git add web/src/App.tsx web/src/components/ui
git commit -m @'
feat(web): glass shell - floating sidebar, ambient layer, retinted ui primitives
'@
```

### Task 5: Re-skin Intake + Overview

**Files:**
- Modify: `web/src/screens/Intake.tsx` (drop-slots → GlassPanel-style surfaces, dashed `border-edge` idle → `border-primary/50` on dragover; file chips `bg-glass-3`; checklist panel → GlassPanel)
- Modify: `web/src/screens/Overview.tsx` (KPI stat blocks → `KpiCard` grid `grid-cols-2 xl:grid-cols-4 gap-3.5`; hero = Billed with `hero animate`; GP value `valueClassName="text-success"`; concentration + partner table wrapped in `GlassPanel`; table rows `hover:bg-glass-2`; stagger `fade-up` on the 4 KPI cards with 40ms delays)
- Modify: `web/src/components/CloseChecklist.tsx` (stepper items on `bg-glass-1`, active step `border-primary/30`)

- [ ] **Step 1:** Read all three files fully. Apply the phase protocol + the specifics above. No data/handler changes; `delta`/`spark` props stay UNUSED this phase (MoM arrives in Task 10).
- [ ] **Step 2:** Gates: web typecheck + build; root `pnpm test` all green.
- [ ] **Step 3:** Playwright: screenshot Intake (empty + files loaded via demo button) and Overview; verify KPI hover lift, count-up on Billed, no blurred rows (inspect: table row elements must not have backdrop-filter).
- [ ] **Step 4:** Commit

```powershell
git add web/src/screens/Intake.tsx web/src/screens/Overview.tsx web/src/components/CloseChecklist.tsx
git commit -m @'
feat(web): glass re-skin - Intake drop slots, Overview KPI cards and panels
'@
```

### Task 6: Re-skin Invoices, Rate Cards, Reconcile, Margins, Exceptions

**Files:**
- Modify: `web/src/screens/Invoices.tsx`, `web/src/components/QuickBooksCard.tsx`, `web/src/components/ExportBar.tsx`
- Modify: `web/src/screens/RateCards.tsx`, `web/src/screens/Reconcile.tsx`, `web/src/screens/Margins.tsx`
- Modify: `web/src/screens/Exceptions.tsx` (re-skin AND the one structural change: group findings by `kind`, ordered block→warn→info, each group a collapsible `GlassPanel` — `<details>`/`<summary>` is fine — with `{kind} · {count}` in the summary; keep each finding row's existing rendering inside)

- [ ] **Step 1:** One screen at a time: read fully, apply protocol. Draft invoice cards in Invoices get `hover:-translate-y-[3px] hover:shadow-glass-lift`; the 4-tone push-result rows in QuickBooksCard keep their tone colors on `bg-glass-1` rows. `InvoiceDoc.tsx` (the printable customer invoice) is NOT re-skinned — it's a paper document; leave it.
- [ ] **Step 2:** Gates after EACH screen: web typecheck+build; after all: root `pnpm test` green (Exceptions grouping is presentational; no engine tests touch it).
- [ ] **Step 3:** Playwright pass over all five screens with the real demo dataset; check the blur budget on Invoices (panels + sidebar ≤6 blurred surfaces — use `flat` on inner panels if over).
- [ ] **Step 4:** Commit per screen (5 commits), message pattern:

```powershell
git commit -m @'
feat(web): glass re-skin - <Screen>
'@
```

- [ ] **Step 5 (phase gate):** Full suite `pnpm test` → all green. Push: `git push origin main`. Deploy decision point: ship the re-skin to prod now (`vercel deploy --prod`, verify home 200 + bundle hash + connect 503; retry once on transient Not authorized) or hold — ASK LUKE.

---

## Phase 3 — Archive + Trends

### Task 7: `CloseSnapshot` domain (types + zod + builder, TDD)

**Files:**
- Create: `src/domain/snapshot.ts`
- Test: `tests/domain/snapshot.test.ts`
- Modify (cleanup): `web/src/components/glass/StatusPill.tsx` (swap inline type for the import)

- [ ] **Step 1: Failing tests** in `tests/domain/snapshot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotFromClose, CloseSnapshotSchema } from "../../src/domain/snapshot.js";
import { parseSpecialPricing } from "../../src/ingest/specialPricing.js";
import { parseUsage } from "../../src/ingest/usage.js";
import { parseCoroInvoice } from "../../src/ingest/coroInvoice.js";
import { closeFromRateCard } from "../../src/close/rateCardClose.js";
import { isOk } from "../../src/lib/result.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "..", "data", "2026-08");
const hasRealData = existsSync(join(DATA, "MSP Hub_August 2026 Usage.xlsx"));

function realModel() {
  const pricing = parseSpecialPricing(
    readFileSync(join(DATA, "Coro Special MSP Pricing(Special Pricing).csv"), "utf8"), "2026-08");
  const usage = parseUsage({ buffer: readFileSync(join(DATA, "MSP Hub_August 2026 Usage.xlsx")) }, { period: "2026-08" });
  const inv = parseCoroInvoice({ buffer: readFileSync(join(DATA, "Coro_Invoice_INVCUS2026-0002193.xlsx")) },
    { invoiceNumber: "INVCUS2026-0002193", period: "2026-08" });
  if (!isOk(pricing) || !isOk(usage) || !isOk(inv)) throw new Error("parse failed");
  return closeFromRateCard({ pricing: pricing.value, usage: usage.value, coroInvoiceLines: inv.value, period: "2026-08" });
}

const FP = { pricing: "aaaaaaaaaaaa", usage: "bbbbbbbbbbbb" };

describe.skipIf(!hasRealData)("snapshotFromClose — real August packet", () => {
  const snap = hasRealData
    ? snapshotFromClose(realModel(), FP, 1, "2026-09-28T20:00:00.000Z")
    : (null as never);

  it("pins the month totals (post confirmed-rates)", () => {
    expect(snap.totals.billedL).toBe("13957.76");
    expect(snap.totals.costActual).toBe("12998.33");
    expect(snap.totals.costExpected).toBe("12070.82");
    expect(snap.totals.margin).toBe("959.43");
    expect(snap.totals.creditExpected).toBe("1041.38");
    expect(snap.partners).toHaveLength(16);
  });

  it("carries per-line rate, quantity, and customer shares", () => {
    const xtb = snap.partners.find((p) => p.cardName === "XTB Solutions")!;
    const ess = xtb.lines.find((l) => l.vendorSku.toLowerCase() === "bucoroflex")!;
    expect(ess.unitL).toBe("6.00");
    expect(ess.quantity).toBe(39);
    expect(ess.customers.length).toBeGreaterThan(0);
  });

  it("round-trips through the zod schema", () => {
    const parsed = CloseSnapshotSchema.parse(JSON.parse(JSON.stringify(snap)));
    expect(parsed).toEqual(snap);
  });

  it("is deterministic", () => {
    expect(snapshotFromClose(realModel(), FP, 1, "2026-09-28T20:00:00.000Z")).toEqual(snap);
  });
});

describe("CloseSnapshotSchema — rejection", () => {
  it("rejects a wrong version and missing fields", () => {
    expect(CloseSnapshotSchema.safeParse({ v: 2 }).success).toBe(false);
    expect(CloseSnapshotSchema.safeParse({}).success).toBe(false);
  });
});
```

- [ ] **Step 2:** `pnpm test tests/domain/snapshot.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/domain/snapshot.ts`:**

```ts
/**
 * CloseSnapshot v1 — the archived form of a monthly close (spec 2026-09-28 §3).
 *
 * Built purely from a CloseModel: deterministic, clock-free (savedAt is a
 * parameter), Money serialized as toFixed2 strings so snapshots survive JSON.
 * The archive store (web/src/lib/closeArchive.ts) persists these locally —
 * nothing ever leaves the browser except user-initiated exports.
 */
import { z } from "zod";
import type { CloseModel } from "./types.js";

export type CreditStatus = "expected" | "memo-received" | "applied";

const money = z.string().regex(/^-?\d+\.\d{2}$/);

export const CloseSnapshotSchema = z.object({
  v: z.literal(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  savedAt: z.string(),
  ratesRevision: z.number().int().nonnegative(),
  fingerprints: z.object({
    pricing: z.string().min(6),
    usage: z.string().min(6),
    invoice: z.string().min(6).optional(),
  }),
  totals: z.object({
    billedL: money, costExpected: money, costActual: money.optional(),
    margin: money, creditExpected: money,
  }),
  partners: z.array(z.object({
    slug: z.string(), cardName: z.string(),
    billedL: money, costExpected: money, costActual: money.optional(),
    margin: money, creditExpected: money, heldLines: z.number().int().nonnegative(),
    lines: z.array(z.object({
      vendorSku: z.string(), productLabel: z.string(), quantity: z.number(),
      unitL: money.optional(), amountL: money.optional(),
      marginBasis: z.enum(["actual", "expected-additive", "none"]),
      margin: money.optional(), creditExpected: money.optional(),
      customers: z.array(z.object({ customer: z.string().nullable(), quantity: z.number() })),
    })),
  })),
  creditStatus: z.record(z.string(), z.enum(["expected", "memo-received", "applied"])),
});

export type CloseSnapshot = z.infer<typeof CloseSnapshotSchema>;

export function snapshotFromClose(
  model: CloseModel,
  fingerprints: { pricing: string; usage: string; invoice?: string },
  ratesRevision: number,
  savedAt: string
): CloseSnapshot {
  const partners = model.partners.map((p) => ({
    slug: p.slug,
    cardName: p.cardName,
    billedL: p.totalL.toFixed2(),
    costExpected: p.totalHExpected.toFixed2(),
    ...(p.totalHActual !== null ? { costActual: p.totalHActual.toFixed2() } : {}),
    margin: p.totalMargin.toFixed2(),
    creditExpected: p.totalCreditExpected.toFixed2(),
    heldLines: p.heldLines,
    lines: p.lines.map((l) => ({
      vendorSku: l.vendorSku,
      productLabel: l.productLabel,
      quantity: l.quantity,
      ...(l.unitL !== null ? { unitL: l.unitL.toFixed2() } : {}),
      ...(l.amountL !== null ? { amountL: l.amountL.toFixed2() } : {}),
      marginBasis: l.marginBasis,
      ...(l.margin !== null ? { margin: l.margin.toFixed2() } : {}),
      ...(l.creditExpected !== null ? { creditExpected: l.creditExpected.toFixed2() } : {}),
      customers: l.customers.map((c) => ({ customer: c.customer, quantity: c.quantity })),
    })),
  }));

  const sumFixed = (get: (p: (typeof partners)[number]) => string | undefined): string => {
    const cents = partners.reduce((s, p) => {
      const v = get(p);
      return s + (v === undefined ? 0 : Math.round(Number(v) * 100));
    }, 0);
    return (cents / 100).toFixed(2);
  };

  const anyActual = model.partners.some((p) => p.totalHActual !== null);

  return {
    v: 1,
    period: model.period,
    savedAt,
    ratesRevision,
    fingerprints,
    totals: {
      billedL: sumFixed((p) => p.billedL),
      costExpected: sumFixed((p) => p.costExpected),
      ...(anyActual ? { costActual: sumFixed((p) => p.costActual) } : {}),
      margin: sumFixed((p) => p.margin),
      creditExpected: model.totalCreditExpected.toFixed2(),
    },
    partners,
    creditStatus: Object.fromEntries(
      model.partners
        .filter((p) => p.totalCreditExpected.toCents() !== 0)
        .map((p) => [p.slug, "expected" as const])
    ),
  };
}
```

- [ ] **Step 4:** `pnpm test tests/domain/snapshot.test.ts` → PASS (6 tests). Then full `pnpm test` → green.
- [ ] **Step 5:** Swap StatusPill's inline `CreditStatus` for `import type { CreditStatus } from "../../../../src/domain/snapshot.js"`. Web typecheck clean.
- [ ] **Step 6:** Commit

```powershell
git add src/domain/snapshot.ts tests/domain/snapshot.test.ts web/src/components/glass/StatusPill.tsx
git commit -m @'
feat(domain): CloseSnapshot v1 - zod schema + deterministic snapshotFromClose (real-packet pinned)
'@
```

### Task 8: Archive store (KV-injected, TDD)

**Files:**
- Create: `web/src/lib/closeArchive.ts`
- Test: `tests/web/closeArchive.test.ts`

- [ ] **Step 1: Failing tests** (memoryKV pattern copied from `tests/web/qboClient.test.ts:21-29`):

```ts
import { describe, it, expect } from "vitest";
import {
  saveSnapshot, loadSnapshot, listPeriods, exportArchive, importArchive, setCreditStatus,
} from "../../web/src/lib/closeArchive.js";
import type { CloseSnapshot } from "../../src/domain/snapshot.js";
import type { KV } from "../../web/src/lib/qbo.js";

function memoryKV(): KV & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

function snap(period: string, savedAt: string, billed = "100.00"): CloseSnapshot {
  return {
    v: 1, period, savedAt, ratesRevision: 1,
    fingerprints: { pricing: "aaaaaaaaaaaa", usage: "bbbbbbbbbbbb" },
    totals: { billedL: billed, costExpected: "80.00", margin: "20.00", creditExpected: "0.00" },
    partners: [], creditStatus: {},
  };
}

describe("closeArchive", () => {
  it("saves, lists (sorted), and loads snapshots", () => {
    const kv = memoryKV();
    saveSnapshot(kv, snap("2026-08", "2026-09-28T00:00:00.000Z"));
    saveSnapshot(kv, snap("2026-07", "2026-09-28T00:00:00.000Z"));
    expect(listPeriods(kv)).toEqual(["2026-07", "2026-08"]);
    expect(loadSnapshot(kv, "2026-08")!.totals.billedL).toBe("100.00");
    expect(loadSnapshot(kv, "2026-01")).toBeNull();
  });

  it("overwrites the same period", () => {
    const kv = memoryKV();
    saveSnapshot(kv, snap("2026-08", "2026-09-28T00:00:00.000Z", "100.00"));
    saveSnapshot(kv, snap("2026-08", "2026-09-29T00:00:00.000Z", "200.00"));
    expect(listPeriods(kv)).toEqual(["2026-08"]);
    expect(loadSnapshot(kv, "2026-08")!.totals.billedL).toBe("200.00");
  });

  it("survives corrupted storage entries", () => {
    const kv = memoryKV();
    kv.map.set("coro-archive:v1:index", "not json");
    expect(listPeriods(kv)).toEqual([]);
    saveSnapshot(kv, snap("2026-08", "2026-09-28T00:00:00.000Z"));
    expect(listPeriods(kv)).toEqual(["2026-08"]);
  });

  it("exports all and imports with newest-wins merge + validation", () => {
    const a = memoryKV();
    saveSnapshot(a, snap("2026-07", "2026-09-01T00:00:00.000Z", "70.00"));
    saveSnapshot(a, snap("2026-08", "2026-09-28T00:00:00.000Z", "100.00"));
    const json = exportArchive(a);

    const b = memoryKV();
    saveSnapshot(b, snap("2026-08", "2026-09-29T00:00:00.000Z", "999.00")); // newer than export
    const res = importArchive(b, json);
    expect(res).toEqual({ imported: 1, skipped: 1 }); // 07 in, 08 skipped (older)
    expect(loadSnapshot(b, "2026-08")!.totals.billedL).toBe("999.00");
    expect(loadSnapshot(b, "2026-07")!.totals.billedL).toBe("70.00");
  });

  it("rejects invalid import wholesale", () => {
    const kv = memoryKV();
    expect(() => importArchive(kv, '{"nope":true}')).toThrow();
    expect(listPeriods(kv)).toEqual([]);
  });

  it("updates credit status in place", () => {
    const kv = memoryKV();
    saveSnapshot(kv, snap("2026-08", "2026-09-28T00:00:00.000Z"));
    setCreditStatus(kv, "2026-08", "evolvewithuscom", "memo-received");
    expect(loadSnapshot(kv, "2026-08")!.creditStatus["evolvewithuscom"]).toBe("memo-received");
  });
});
```

- [ ] **Step 2:** Run → FAIL (module not found).
- [ ] **Step 3: Implement `web/src/lib/closeArchive.ts`:**

```ts
/**
 * Local close archive — CloseSnapshots in injected KV storage (localStorage in
 * the app; memory in tests). Spec 2026-09-28 §3: local-only, export/import as
 * the backup path, newest-savedAt wins on merge, invalid imports rejected
 * wholesale. Same DOM-free discipline as qbo.ts.
 */
import { CloseSnapshotSchema, type CloseSnapshot, type CreditStatus } from "../../../src/domain/snapshot.js";
import type { KV } from "./qbo.js";

const INDEX_KEY = "coro-archive:v1:index";
const keyFor = (period: string) => `coro-archive:v1:${period}`;

function readIndex(kv: KV): string[] {
  try {
    const raw = kv.getItem(INDEX_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch { return []; }
}

function writeIndex(kv: KV, periods: string[]): void {
  kv.setItem(INDEX_KEY, JSON.stringify([...new Set(periods)].sort()));
}

export function saveSnapshot(kv: KV, snap: CloseSnapshot): void {
  kv.setItem(keyFor(snap.period), JSON.stringify(snap));
  writeIndex(kv, [...readIndex(kv), snap.period]);
}

export function loadSnapshot(kv: KV, period: string): CloseSnapshot | null {
  try {
    const raw = kv.getItem(keyFor(period));
    if (raw === null) return null;
    const parsed = CloseSnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** Sorted period list (only periods whose snapshot actually loads). */
export function listPeriods(kv: KV): string[] {
  return readIndex(kv).filter((p) => loadSnapshot(kv, p) !== null).sort();
}

export function exportArchive(kv: KV): string {
  const snapshots = listPeriods(kv).map((p) => loadSnapshot(kv, p)!);
  return JSON.stringify({ kind: "coro-close-archive", v: 1, snapshots }, null, 2);
}

const ArchiveFileSchema = { parse: (raw: unknown) => {
  if (typeof raw !== "object" || raw === null) throw new Error("not an archive file");
  const o = raw as { kind?: unknown; v?: unknown; snapshots?: unknown };
  if (o.kind !== "coro-close-archive" || o.v !== 1 || !Array.isArray(o.snapshots)) {
    throw new Error("not a coro close archive (kind/v mismatch)");
  }
  return o.snapshots.map((s) => CloseSnapshotSchema.parse(s));
}};

/** Merge an exported archive: newest savedAt wins per period. Throws on any invalid content; imports nothing partial. */
export function importArchive(kv: KV, json: string): { imported: number; skipped: number } {
  const snapshots = ArchiveFileSchema.parse(JSON.parse(json));
  let imported = 0, skipped = 0;
  for (const snap of snapshots) {
    const existing = loadSnapshot(kv, snap.period);
    if (existing !== null && existing.savedAt >= snap.savedAt) { skipped++; continue; }
    saveSnapshot(kv, snap);
    imported++;
  }
  return { imported, skipped };
}

export function setCreditStatus(kv: KV, period: string, slug: string, status: CreditStatus): void {
  const snap = loadSnapshot(kv, period);
  if (snap === null) return;
  saveSnapshot(kv, { ...snap, creditStatus: { ...snap.creditStatus, [slug]: status } });
}
```

- [ ] **Step 4:** Run → PASS (6 tests). Full suite green. Web typecheck clean.
- [ ] **Step 5:** Commit

```powershell
git add web/src/lib/closeArchive.ts tests/web/closeArchive.test.ts
git commit -m @'
feat(web): local close archive - KV snapshot store with export/import newest-wins merge
'@
```

### Task 9: Trends math (`trendSeries`, `partnerDeltas`, `waterfall`, TDD)

**Files:**
- Create: `src/close/trends.ts`
- Test: `tests/close/trends.test.ts`

- [ ] **Step 1: Failing tests:**

```ts
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
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement `src/close/trends.ts`:**

```ts
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
```

- [ ] **Step 4:** Run → PASS (4 tests). Full suite green.
- [ ] **Step 5:** Commit

```powershell
git add src/close/trends.ts tests/close/trends.test.ts
git commit -m @'
feat(close): trends math - series, partner deltas, price-volume-mix waterfall with exact bridge invariant
'@
```

### Task 10: closeStore archive wiring + Trends screen + nav

**Files:**
- Modify: `web/src/lib/nav.ts` (add `"trends"` to the `SectionKey` union)
- Modify: `web/src/lib/closeStore.tsx` (expose archive API)
- Create: `web/src/screens/Trends.tsx`
- Modify: `web/src/App.tsx` (SECTIONS entry after overview: `{ key: "trends", label: "Trends", icon: LineChart, Screen: TrendsScreen, needsModel: false }` — Trends works from the archive even before files are dropped; import `LineChart` from lucide)
- Modify: `web/src/screens/Overview.tsx` (add "Save to archive" button next to the existing export actions)

- [ ] **Step 1:** Read `closeStore.tsx` fully. Add to the store (following its existing patterns exactly):
  - `archivePeriods: string[]` (from `listPeriods(localStorage)`, refreshed via a `bumpArchive()` counter state),
  - `saveCurrentToArchive(): { ok: boolean; period?: string }` — guards `model !== null && files.pricing && files.usage`; builds `snapshotFromClose(model, {pricing: files.pricing.fingerprint.slice(0,12), usage: files.usage.fingerprint.slice(0,12), ...(files.invoice ? {invoice: files.invoice.fingerprint.slice(0,12)} : {})}, CONFIRMED_RATES_REVISION, new Date().toISOString())`, then `saveSnapshot(localStorage, snap)`; PRESERVE any existing creditStatus edits: merge `{...freshSnap, creditStatus: {...freshSnap.creditStatus, ...(loadSnapshot(localStorage, period)?.creditStatus ?? {})}}` before saving,
  - `loadArchived(period)` passthrough, `exportArchiveFile()` (uses the existing `download.ts` helper to save `coro-close-archive-<period>.json`), `importArchiveFile(text): {imported, skipped}` (try/catch → error string), `setCredit(period, slug, status)`.
- [ ] **Step 2:** Auto-PROMPT: in the store, when every partner becomes approved (the same condition the checklist uses) AND the current period is not yet archived with current fingerprints, set a flag `archivePromptDue: boolean`; Overview renders a dismissible glass banner "All drafts approved — save this close to the archive?" with Save/dismiss. No auto-save (spec §3).
- [ ] **Step 3:** Build `Trends.tsx`:
  - Month chips from `archivePeriods` (+ current unsaved close as a ghost chip "unsaved" when model loaded but not archived).
  - `< 2` snapshots → empty state panel: "Trends light up with two archived months — save July and August from Overview." plus export/import buttons.
  - With ≥2: pick `prev, curr` = last two periods (chips let the user choose curr; prev = the one before it). Render:
    - `AreaChart` with `periods` and two series: billed (brass `hsl(var(--primary))`, filled) and margin (viridian, dashed), `ariaSummary` = "Billed and gross profit by month".
    - `WaterfallChart` from `waterfall(prevSnap, currSnap)` with `formatCents=(c)=>"$"+(c/100).toLocaleString(...)`; beneath it the accessible fallback table (Bucket | Amount) — plain rows.
    - Credit tracker panel: rows = union of partners with `creditExpected !== "0.00"` across snapshots; columns Partner | Month | Expected | Status (`StatusPill` + a `<select>` bound to `setCredit`); footer running balance = Σ expected where status ≠ applied.
    - Archive panel: per-period chips with savedAt + fingerprints tail; Export button; Import via `<input type="file">` reading text → `importArchiveFile`; result/error line. "Unexported changes" chip when any `savedAt` > last export marker (store the last export ISO in KV key `coro-archive:v1:last-export`). When a save replaced a snapshot with DIFFERENT fingerprints, show a muted one-line note under that period's chip: "superseded an earlier snapshot (different files)" — detect by keeping the replaced snapshot's fingerprints in KV key `coro-archive:v1:superseded:<period>` at save time (write it in `saveCurrentToArchive` when fingerprints differ).
- [ ] **Step 4:** Gates: web typecheck + build; full suite; Playwright — archive July+August flows: load Aug files → Save to archive → chip appears; import/export round-trip; screenshot Trends with 1 and 2 snapshots.
- [ ] **Step 5:** Commit

```powershell
git add web/src/lib/nav.ts web/src/lib/closeStore.tsx web/src/screens/Trends.tsx web/src/App.tsx web/src/screens/Overview.tsx
git commit -m @'
feat(web): Trends screen + close archive wiring - month chips, area chart, GP waterfall, credit tracker, export/import
'@
```

---

## Phase 4 — Features in place

### Task 11: Overview MoM layer

**Files:**
- Modify: `web/src/screens/Overview.tsx`

- [ ] **Step 1:** In the screen, compute once (memoized on model+archivePeriods):

```ts
const prevPeriod = archivePeriods.filter((p) => p < period).at(-1) ?? null;
const prev = prevPeriod !== null ? loadArchived(prevPeriod) : null;
const currSnap = snapshotFromClose(model, fp, CONFIRMED_RATES_REVISION, new Date().toISOString());
const deltas = partnerDeltas(currSnap, prev);
const series = trendSeries([
  ...archivePeriods.filter((p) => p !== period).map((p) => loadArchived(p)!),
  currSnap, // current model wins its own period
]);
```
- [ ] **Step 2:** KPI cards get `spark={<Sparkline values={series.map(p => p.billedCents)} />}` (cost dashed, GP viridian) when `series.length >= 2`, and `delta={<TrendChip tone=... >±x% vs <prevPeriod-short></TrendChip>}` computed from the totals; hero stays `animate`.
- [ ] **Step 3:** Partner table: add a right-aligned `vs <prev>` column — `TrendChip` per row from `deltas` (`new` tone for NEW, up/down with pct, em-dash when no prior). Column renders only when `prev !== null`.
- [ ] **Step 4:** Gates + Playwright (Overview with 1 archived month showing the column; with none showing no column). Full suite green.
- [ ] **Step 5:** Commit

```powershell
git add web/src/screens/Overview.tsx
git commit -m @'
feat(web): Overview month-over-month layer - KPI sparklines, delta chips, partner vs-prior column
'@
```

### Task 12: Rate Cards intelligence

**Files:**
- Modify: `web/src/screens/RateCards.tsx`

- [ ] **Step 1:** Read the screen. For each partner card's product rows, join the close model's `DraftLine`s by (partner slug, vendorSku) where usage priced a row this month. Add per row, when available:
  - **Confirmed-rate badge** when the line's findings include `RATE_OVERRIDE_APPLIED`: brass pill "confirmed" with `title` = the finding message (carries sheet value + provenance).
  - **Unit margin**: `unitL − expectedHAdditive` when both exist, viridian/crimson by sign.
  - **Below-cost alarm**: when `unitL < expectedHAdditive` → crimson pill "below cost" (icon + text — TriangleAlert).
  - **MoM rate diff**: from `loadArchived(prevPeriod)` — the prior snapshot line's `unitL` for the same slug+sku; when different, a muted chip "was 7.20".
- [ ] **Step 2:** Header of the screen gains counts: "30 confirmed overrides · N below-cost". Gates + Playwright screenshot. Full suite green.
- [ ] **Step 3:** Commit

```powershell
git add web/src/screens/RateCards.tsx
git commit -m @'
feat(web): Rate Cards intelligence - override provenance, unit margin, below-cost alarms, MoM rate diffs
'@
```

### Task 13: Invoices end-customer breakdown + Margins movers

**Files:**
- Modify: `web/src/screens/Invoices.tsx`
- Modify: `web/src/screens/Margins.tsx`

- [ ] **Step 1 (Invoices):** In the draft detail view, add a collapsible GlassPanel "Customers" per partner: aggregate `line.customers` across the partner's priced lines into per-customer `{customer, billedCents: Σ unitL×qty, products: string[]}`; sort by billed desc; render Customer | Products | Billed rows (customer `null` → "(partner workspace)"); top row highlighted. Pure aggregation inline in the screen (it's presentation of existing model data).
- [ ] **Step 2 (Margins):** When a prior snapshot exists, add a "Biggest movers vs <prev>" GlassPanel above the existing content: top 5 partners by `|Δ billed|` from `partnerDeltas` + amounts; NEW partners listed separately.
- [ ] **Step 2b (Reconcile, spec §2):** Add a compact GlassPanel at the bottom of `web/src/screens/Reconcile.tsx`: "Coro credits — $<running balance> outstanding across <n> partners" + a "View in Trends →" button (`onNavigate("trends")`). Read-only summary; the tracker's canonical home stays Trends.
- [ ] **Step 3:** Gates + Playwright all three screens. Full suite green. Commit (include `web/src/screens/Reconcile.tsx` in the add):

```powershell
git add web/src/screens/Invoices.tsx web/src/screens/Margins.tsx
git commit -m @'
feat(web): end-customer breakdown on Invoices + biggest-movers panel on Margins
'@
```

---

## Phase 5 — Report pack

### Task 14: Report pack view + print CSS

**Files:**
- Create: `web/src/components/ReportPack.tsx`
- Modify: `web/src/screens/Overview.tsx` (the "Report pack ↧" button — opens the report overlay then `window.print()`)
- Modify: `web/src/index.css` (print styles)

- [ ] **Step 1:** `ReportPack.tsx` — a full-screen overlay (`fixed inset-0 z-[100] overflow-auto bg-white text-slate-900 print:static`) rendered only while open; content sections, in order: header (MSP Hub brand + "Coro Close — <period>" + generated date), KPI block (billed/costExpected/costActual/margin/creditExpected as plain stat rows), GP concentration (plain horizontal bars, print-safe colors: navy/gold/slate), partner summary table (Partner | Billed | Cost | GP | GM), waterfall table (the accessible fallback table only — charts as SVG print acceptably but the TABLE is the canonical print form), credit tracker table with statuses, findings digest (count by kind × severity), audit footer (pricing/usage/invoice fingerprint tails, rates revision, savedAt). Every table is plain semantic HTML with 1px slate borders — NO glass classes anywhere in this component.
- [ ] **Step 2:** Print CSS in `index.css`:

```css
@media print {
  body { background: #fff !important; }
  body::before, .ambient-blob { display: none !important; }
  .no-print { display: none !important; }
}
```

  The overlay adds `no-print` close/print buttons at top; App shell elements outside the overlay are hidden while it's open (conditional render), so print output is the report alone.
- [ ] **Step 3:** Gates: typecheck/build; Playwright: open report, `emulate media print`, screenshot — verify white ground, no glass, tables legible. Full suite green.
- [ ] **Step 4:** Commit

```powershell
git add web/src/components/ReportPack.tsx web/src/screens/Overview.tsx web/src/index.css
git commit -m @'
feat(web): monthly report pack - print-grade close document with audit footer
'@
```

### Task 15: Final verification + ship

- [ ] **Step 1:** Full suite: `pnpm test` → all green (expected: 320 baseline + ~16 new = ~336).
- [ ] **Step 2:** Web gates: `cd web; pnpm typecheck; pnpm build` clean.
- [ ] **Step 3:** Playwright full pass on the built preview: Intake (drop/demo) → Overview (KPIs, MoM, report button) → Trends (charts, credit tracker, export/import) → Rate Cards (badges/alarms) → Reconcile → Invoices (customers panel, QBO card states) → Margins (movers) → Exceptions (grouped). Reduced-motion spot check (emulate `prefers-reduced-motion`), blur-budget count on Overview + Invoices, contrast spot check of muted text on glass.
- [ ] **Step 4:** `git push origin main`.
- [ ] **Step 5 (with Luke):** `vercel deploy --prod` (retry once on transient Not authorized); verify: home 200, bundle hash matches local `web/dist`, `/api/qbo/connect` still 503 (dark until task #5 arming), legal pages 200. Update `docs/LITA_CALL_PREP_2026-09-29.md` only if this ships before the call.

---

## Out of scope (do not touch)

Engine pricing semantics, `confirmedRates.ts` values, QBO push behavior, `InvoiceDoc.tsx` paper document, legal pages, review-state key format (`:r1` stays — re-skin must NOT bump `CONFIRMED_RATES_REVISION`).
