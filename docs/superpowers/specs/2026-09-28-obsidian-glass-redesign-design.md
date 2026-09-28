# Obsidian Glass — UI/UX redesign + insights layer

**Date:** 2026-09-28
**Approved by:** Luke (this session, via visual companion — mockups in
`.superpowers/brainstorm/765-1790616020/content/`, esp. `obsidian-hero.html`)
**Builds on:** docs/superpowers/specs/2026-09-21-coro-billing-ui-revamp-design.md (the
rate-card close workbench). This spec changes how it LOOKS and adds an insights layer;
the close flow, engine, and screens' jobs are explicitly unchanged.

## Goals (Luke, verbatim intent)

1. "Glassier dynamic look and feel — institutional grade": full visual re-skin.
2. New insights & reporting features. Selected via companion: **month-over-month
   trends, GP waterfall, end-customer analytics, Coro credit tracker, rate
   intelligence, monthly report pack.** (Declined: partner scorecards, auto-insights
   feed, QBO push ledger.)
3. **The flow does not change.** Same screens, same jobs, same close process. One
   additive screen (Trends) is the only navigation change (Approach 1, approved).
4. Persistence choice (approved): **in-browser archive + JSON backup** — the
   zero-upload privacy stance stays intact (it is load-bearing: legal pages + Intuit).

## 1. Design language — "Obsidian Glass" (Midnight Ledger v2)

Identity kept: ink-blue-black ground, brass = money, viridian = positive margin,
amber = review, crimson = block, ink-blue = informational; Fraunces (headings, KPI
numerals) + IBM Plex Sans (UI, tables).

New surface system (replaces flat cards):

- **Tokens** (extend `web/src/index.css` + Tailwind config):
  - Ground: layered gradient (no pure black): `#0a0d18 → #0b101f → #090c16` plus two
    radial glows (brass 7%, ink-blue 6%), fixed attachment.
  - Glass surfaces: `--glass-1 rgba(255,255,255,.04)` (panel), `--glass-2 .06`
    (hover/elevated), `--glass-3 .085` (overlay chips); border `--edge
    rgba(255,255,255,.08)` with top-edge highlight `--edge-hi .17`; radius **16px**;
    shadow `0 10px 34px rgba(0,0,0,.45)` + `inset 0 1px 0 rgba(255,255,255,.05)`.
  - Backdrop blur: panels 12–14px, sidebar/nav 18px. **Blur budget: ≤6 blurred
    surfaces per viewport; table rows/lists NEVER blur** (translucent background
    only) — performance guardrail.
  - Brass numerals get `text-shadow: 0 0 26px rgba(217,180,92,.22)` on hero KPIs only.
  - Easing token `cubic-bezier(.16,1,.3,1)` shared by all transitions.
- **Ambient layer:** two fixed light blobs (brass ~480px, ink-blue ~420px, blur 46px,
  opacity .09–.10) drifting on 52s/64s transform-only keyframes. Off under
  `prefers-reduced-motion`.
- **Motion system:** enter 150–300ms ease-out (exits ~60–70% of enter); staggered
  entrance 30–40ms/item capped at first 12; hover lift `translateY(-2..3px)` + shadow
  deepen; KPI count-up 900ms cubic ease-out on the hero figure only; page switches
  crossfade ~200ms. Every one of these is disabled under `prefers-reduced-motion`.
- **Type & numbers:** `font-variant-numeric: tabular-nums` on every money/qty column.
  Body ≥13px; labels 10px uppercase tracked.
- **Accessibility:** body text ≥4.5:1 and muted text ≥3:1 measured against the GLASS
  surface over the ground (not the raw ground); 2px brass focus rings on all
  interactive elements; semantic states always icon/text + color, never color alone.
- Icons stay lucide-react (stroke-consistent); no emoji-as-icon anywhere.

Reference implementation of the whole language: the approved mockup
`obsidian-hero.html` (sidebar, topbar chips, KPI cards, panels, tables, charts,
buttons, status pills, month chips).

## 2. Screen map (Approach 1 — enrich in place, +1 screen)

| Screen | Re-skin | Feature added |
|---|---|---|
| Intake | glass drop-slots, animated dashed border on drag, file chips w/ fingerprint tails; checklist → glass stepper | — |
| Overview | KPI strip (4 glass cards), concentration bar, partner table | MoM sparklines + delta chips on KPIs; partner `vs last month` column w/ NEW tags; **Save to archive** + **Report pack** buttons |
| **Trends (NEW)** | — | month timeline (archive chips), billed/cost/GP area chart, **GP waterfall** (prev→current bridge), **credit tracker**, archive export/import |
| Rate Cards | glass partner cards | **rate intelligence**: per-row sheet E vs confirmed override (w/ QB-invoice provenance from RATE_OVERRIDE_APPLIED findings), additive cost, unit margin, below-cost crimson alarm; effective-rate diff vs prior month |
| Reconcile | glass | link/summary of credit tracker (canonical home is Trends) |
| Invoices | glass draft cards + detail; QuickBooksCard re-skinned | **end-customer breakdown** per partner: top customers by billed, product footprint per customer; `null` customer labeled "(partner workspace)" |
| Margins | glass | biggest movers vs last month (needs archive) |
| Exceptions | glass | findings grouped by kind into collapsible sections (severity-ordered), counts per group — kills the 330-row wall |

Nav: Trends sits directly under Overview. Badge counts unchanged elsewhere.

## 3. Close archive (the HISTORY layer)

**Schema — `CloseSnapshot` v1** (`src/domain/snapshot.ts`, zod-validated, versioned):

```ts
{
  v: 1,
  period: "2026-08",
  savedAt: string,             // ISO — from Date.now() at save time (UI layer)
  ratesRevision: number,       // CONFIRMED_RATES_REVISION at save time
  fingerprints: { pricing: string /*12*/, usage: string, invoice?: string },
  totals: { billedL: string, costExpected: string, costActual?: string,
            margin: string, creditExpected: string },   // Money.toFixed2 strings
  partners: Array<{
    slug: string, cardName: string,
    billedL: string, costExpected: string, costActual?: string,
    margin: string, creditExpected: string, heldLines: number,
    lines: Array<{
      vendorSku: string, productLabel: string, quantity: number,
      unitL?: string, amountL?: string, marginBasis: "actual"|"expected-additive"|"none",
      margin?: string, creditExpected?: string,
      customers: Array<{ customer: string|null, quantity: number }>,
    }>,
  }>,
  creditStatus: Record<string /*partner slug*/, "expected"|"memo-received"|"applied">,
}
```

- **Build:** pure `snapshotFromClose(model, fingerprints, revision, savedAt)` in
  `src/domain/snapshot.ts` — deterministic, unit-tested, Money serialized as
  `toFixed2()` strings.
- **Store:** `web/src/lib/closeArchive.ts`, KV-injected (identical discipline to
  qbo.ts so plain-Node vitest covers it). Keys: `coro-archive:v1:<period>` + index
  `coro-archive:v1:index` (sorted period list). ~30–60KB/month — localStorage is
  ample; IndexedDB deliberately NOT used (YAGNI).
- **Save triggers:** explicit "Save to archive" (Overview + Trends); auto-PROMPT (not
  auto-save) when every draft is approved. Re-save same period: same fingerprints →
  overwrite silently; different fingerprints → overwrite + "superseded earlier
  snapshot" note in Trends.
- **Credit status edits** (Trends) update the stored snapshot in place.
- **Export/import:** export downloads all snapshots as one JSON
  (`coro-close-archive-<today>.json`); import merges by period (newest `savedAt`
  wins), zod-validated, invalid file → clear error, nothing partial. A subtle chip
  reminds when the archive has changes not yet exported.
- **Privacy:** unchanged — snapshots never leave the browser except as user-initiated
  downloads.
- **Rollout note:** Trends renders its charts with ≥2 snapshots (single snapshot →
  helpful empty state). July is seeded by re-running the July files once and saving.

## 4. Feature computations (pure, in `src/close/trends.ts`)

- `trendSeries(snapshots)` → per-month billed/costExpected/costActual/margin arrays,
  period-sorted.
- `partnerDeltas(currentModel, prevSnapshot)` → per-partner `{pctChange | "new"}`;
  join by slug. Used by Overview's `vs last month` column and Margins' movers.
- `waterfall(prevSnapshot, currSnapshot)` → buckets `[start, newPartners,
  discontinued, volume, rate, end]`, computed per partner×SKU with the standard
  price-volume-mix convention: `volume = Δqty × oldRate`, `rate = Δrate × newQty`
  (cross term rides in `rate` — stated in the UI tooltip); SKUs/partners absent on
  one side land in newPartners/discontinued. **Invariant (tested): start + Σdeltas =
  end exactly, in Money cents.** Held (unpriced) lines are excluded from both sides,
  matching close totals.
- Customer analytics: derived in the Invoices screen from `line.customers` —
  per-partner top customers by `unitL × share.quantity` and per-customer product
  lists. No new engine work.
- Rate intelligence: rendered from data the close already carries per line
  (`unitL`, `expectedHAdditive`, `expectedHSheet`, RATE_OVERRIDE_APPLIED finding
  text) + prior snapshot's `unitL` for the MoM rate diff. Below-cost alarm when
  `unitL < expectedHAdditive` (crimson, icon + text).

## 5. Report pack

- A print-optimized document view (rendered on demand, same in-app pattern as
  InvoiceDoc): cover header (period, MSP Hub brand), KPI block, GP concentration,
  partner summary table, waterfall (when history exists), credit tracker, findings
  digest (counts by kind/severity), audit footer (file fingerprints, rates revision,
  generated-at).
- Print CSS flips to a light "paper" palette (glass/dark does not print); charts
  render with print-safe colors. Export = `window.print()` → PDF. Zero new deps.

## 6. Engineering structure

- `web/src/components/glass/` — GlassPanel, KpiCard, AnimatedNumber, TrendChip,
  Sparkline, AreaChart, WaterfallChart, StatusPill, SectionHeader. Purely
  presentational; charts are hand-rolled SVG (line-style series differentiation,
  labels on every waterfall bar + directional arrows, aria-label summary, table
  fallback slot). **No chart library** (dep discipline; simple chart types).
- `src/domain/snapshot.ts` + `src/close/trends.ts` — pure logic (above).
- `web/src/lib/closeArchive.ts` — KV store module.
- `web/src/screens/Trends.tsx` — new screen; others edited in place to adopt
  primitives + their feature sections.
- Tailwind config + index.css carry the token extension; components consume tokens
  (no ad-hoc hex in screens).

## 7. Testing & verification

- Unit (vitest, plain Node): snapshot round-trip + zod rejection cases;
  `snapshotFromClose` over the REAL August packet pins totals (13,957.76 /
  12,998.33 / 959.43 — extends `e2e.rateCardClose.real.test.ts` family); waterfall
  invariant + convention cases (new partner, discontinued SKU, qty-only change,
  rate-only change, both); trendSeries ordering; archive merge rules (newer wins,
  invalid rejected); credit-status persistence.
- Existing 320 tests stay green at every round.
- Playwright visual pass at the end of each round (Intake render, Overview KPIs,
  Trends charts, report-pack print preview) — per the project's verify-with-Playwright
  convention.
- Manual gates: reduced-motion spot check; contrast spot check on glass surfaces
  (muted text, brass on glass); blur-budget check on Overview + Invoices.

## 8. Delivery rounds (each lands green before the next)

1. **Tokens + primitives** — index.css/Tailwind tokens, glass components, ambient
   layer, motion utilities. No screen changes yet (primitives demoed in isolation).
2. **Re-skin** — all 7 screens adopt primitives (visual only; zero behavior change;
   review-state keys untouched).
3. **Archive + Trends** — snapshot domain + store + Trends screen (charts empty-state
   until 2 snapshots) + Save-to-archive/export/import.
4. **Features in place** — Overview MoM, Rate Cards intelligence, Invoices customer
   breakdown, Margins movers, Exceptions grouping, credit tracker.
5. **Report pack** — print view + print CSS.

## Out of scope (explicit)

- No changes to the close engine, pricing semantics, confirmedRates, or QBO push
  behavior (skin-only touches to their UI).
- No backend/Supabase, no auth, no multi-vendor generalization.
- Declined features (scorecards, insights feed, push ledger) — not built.
- No chart library, no new runtime dependencies.
