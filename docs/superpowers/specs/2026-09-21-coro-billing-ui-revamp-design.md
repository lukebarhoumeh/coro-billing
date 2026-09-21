# Coro Billing — UI/UX revamp around the special-pricing rate card

**Date:** 2026-09-21
**Approved by:** Luke (this session), based on the Sep 18 2026 call with Danny Gaston
**Supersedes:** the synthetic-fixture demo dashboard (`web/`) shipped 2026-09-14. The pure
pipeline modules (`src/`) are kept; the web app is rebuilt around the real monthly close.

## Why now

The missing piece from the Sep 11 Dane call — "we have all of the data except for our price
and their price" — has landed: **`Coro Special MSP Pricing(Special Pricing).csv`**, Coro's
per-partner rate card. Combined with the monthly usage report and (optionally) Coro's own
invoice to Hub, the close can now run on real data. Danny's Sep 18 framing: *"This is the
partner, this is their workspace. Here are all of the products they're buying or might be
buying. Here's the list price for those products. That should be the same in every single
one. Then here is the price that partner is buying those products for."*

The product: the account team opens a hosted page, drops in the month's files, and gets a
**draft invoice per MSP** they can double-check, approve, and export.

## Inputs (dropped into the browser; nothing is uploaded anywhere)

1. **Special Pricing CSV** (required) — Coro letterhead rows, then a header at row 6.
   Columns: A `MSP`, B `Workspace ID`, C `Product`, D `List Price`, E `Net Price to MSP`,
   F `MSP Discount`, G `MSPHUB Discount`, H `Net Price to MSPHUB (5%)`,
   I `Total Discount From List`, J `Approximate Monthly Spend`, K `Active Users`,
   L `Total workspaces`, M `Contact Name`, N `Number`, O `Email`, P `Billing Contact`,
   Q `Address`. Partner blocks: the MSP/Workspace ID appear on the first product row of a
   block and are blank on continuation rows. Sub-blocks titled `Managed` / `Managed
   Included` / bare aliases (`XTB`) belong to the enclosing partner. **Column E is the
   partner's cost — what the MSP pays Hub.** (Luke, this session.)
2. **Usage XLSX** (required) — `MSP Hub_<Month> Usage.xlsx`. Sheets: `Monthly Snapshot`
   (workspace × product × {Users, Devices} quantities), `Aggregation`, `Usage` (per child
   workspace, with an `Audit` string that states the billable metric per product, e.g.
   `CORO_ESSENTIALS=14 [math.max(users, devices)]`, `CORO_COMPLETE=2 [users]`).
3. **Coro Invoice XLSX** (optional) — Coro's tax invoice to Hub (`Invoice Detail` sheet:
   MSP Parent, Item ID, Product Name, Quantity, Rate, Discount, Subtotal). Loading it
   unlocks the cost cross-check and actual-vs-expected margin.

A **Load demo data** button feeds the existing synthetic fixtures through the same path;
the SYNTHETIC banner appears in that mode only.

## Money semantics

- **L — what Hub charges the MSP** = column E, `Net Price to MSP`. Unit price on every
  draft invoice line. Never derived, always read.
- **H — Hub's cost.** Two candidate rules exist and demonstrably disagree, so the engine
  computes both and never silently picks:
  - *Sheet rule* (column H): `E × (1 − 5%)` — multiplicative (Seven Star Complete
    $6.40 → $6.08).
  - *Additive rule* (what Coro actually bills, per invoice INVCUS2026-0002193):
    `List × (1 − Total Discount)` where the total stacks additively (58% + 5% = 63%
    → 15 × 0.37 = **$5.55**; Meeting Tree 40%+5% → $8.25 matches the invoice, not the
    sheet's $8.55).
  - When the Coro invoice is loaded, its billed Rate is **actual cost** and drives margin;
    both expected values are shown with deltas as findings for the account team.
- Margin per line = (L − cost) × qty. Margin math is display, never an input.
- All arithmetic in integer cents (`src/lib/money.ts`), half-up rounding, deterministic.

## Matching

- **Workspace ID** (column B ↔ usage `Workspace`/`Group Key`, trimmed, case-insensitive)
  is the join key between rate card and usage.
- The Coro invoice has MSP **names** only → explicit alias map ("Net-Tech Consulting" ↔
  "Net-Tech", "AVOX LLC" ↔ "Avox", "Viener4Gates" ↔ "VienerX Consulting", "GOA-TECH" ↔
  "GOA-Tech", "IT Network Solutions Group LLC" ↔ "IT Network Solutions", "Techlead
  Professional Services LLC" ↔ "TechLead Professional Services LLC", …). Unmapped names
  are exceptions, never fuzzy-guessed silently.
- **Product mapping** (usage `Product Code`, Usage-sheet column J → rate-card `Product`):
  - Codes starting with **`MOD`** are **Modules Flex** SKUs (Luke: "module flex is a
    combination of skus … the product will say just NETWORK then the product code will be
    MODNETWflex — that = modules flex"). Precedence: a partner's *product-specific* flex
    row (e.g. Amplivity "Network Flex" for MODNETWflex) → generic "Modules Flex" /
    "Coro Module Flex" row → exception.
  - `Modsatflex` → "SAT Flex" where present (matches Coro's billing of Evolve).
  - Current-gen codes: COR-COMP-C → Coro AI Complete, COR-ESS-C → Coro AI Essentials,
    COR-ENDP-C → Coro AI Endpoint, COR-LTE-C → Coro AI Lite, COR-MANAGE-C → Coro
    Managed/Monthly (incl. MANAGED_* product-name variants).
  - Legacy bundle codes: BUCOMflex → Complete Flex, BUCOROflex → Essentials Flex,
    BUCOCLASSflex → Classic Flex, BUCOCLASSMNflex → Managed Classic Flex, BUCOMMNGflex →
    Complete Managed Flex, BUENDflex → Endpoint Protection Flex, BUEMAILflex → Email
    Protection Flex.
  - `ADD*` codes (ADDSECUREWEBflex, ADDMDRflex) → Modules Flex family, **marked as an
    assumed mapping** (surfaced as a low-severity finding until confirmed).
  - `COR-COMP-NFR` (NFR workspaces) → non-billable, listed informationally.
  - When the mapped row exists but has no price (blank E), fall back to the generic
    equivalent row if one exists; otherwise exception `MISSING_RATE`.
- **Billable quantity**: parsed from the usage `Audit` metric per workspace+product
  (`[users]`, `[devices]`, `[math.max(users, devices)]`). Missing/unparseable metric →
  exception, never a default.

## Validations (findings, each with severity + location)

- List price differs across partners for the same product (Danny: "should be the same in
  every single one").
- Column H ≠ E × 0.95, or column I ≠ F + G (internally inconsistent sheet cells).
- Missing / duplicate workspace IDs in the rate card.
- Usage workspace with no rate-card block; rate-card partner with no usage.
- Coro-invoice quantity ≠ usage-derived quantity; Coro-invoice rate ≠ either expected cost.
- Unknown product code; assumed (`ADD*`) mapping in use.

## Screens

Shell: left rail, month header showing loaded-file fingerprints, demo banner only in demo
mode.

1. **Intake** — three drop targets with per-file parse report (rows read, partners found,
   warnings). Re-dropping a file replaces it.
2. **Overview** — KPIs: total billed to MSPs, cost (expected/actual), margin $ and %,
   partner count, exception count; margin-by-MSP bar; cost-rule delta callout.
3. **Rate Cards** — searchable per-partner cards: workspace ID chip, contact, per-product
   waterfall table (List → MSP price → our cost → margin), inline quality flags,
   standard-tier vs special badge.
4. **Reconcile** — three-way workspace match (rate card ↔ usage ↔ invoice), per-product
   qty comparison with metric provenance, unmatched lists on both sides.
5. **Invoices** — the payoff. Per-MSP draft list with status; detail view is an invoice
   document: header (MSP, contact from CSV, period), lines (product, qty + metric badge,
   unit price E, extended, cost, margin), totals, anomaly badges per line. Actions:
   **Approve** / **Needs review** + note. Print stylesheet → clean PDF per MSP.
6. **Exceptions** — consolidated findings, linked back to source screen.

## Review state & exports

- Review status/notes persist in `localStorage`, keyed by period + file fingerprint
  (SHA-256 of file bytes), so a re-dropped identical file keeps its review.
- Exports: **QuickBooks CSV + IIF** (existing adapters, exports approved invoices;
  unapproved requires explicit "include drafts"), **printable invoice per MSP** (print
  CSS), **Excel workbook** (Summary, per-MSP tabs mirroring H/L/margin, Exceptions,
  Review sheet with statuses/notes).

## Architecture

- Everything client-side. New browser-safe ingest modules in `src/ingest/`:
  `specialPricing.ts` (CSV rate card → `RateCardEntry` + partner directory),
  usage/invoice parsing moved onto **SheetJS (`xlsx`)** workbook loading that accepts
  `ArrayBuffer` (browser) and file bytes (Node/tests) through the existing
  `WorkbookInput` seam.
- New `src/close/` composition: `buildClose(rateCard, usage, coroInvoice?) → CloseModel`
  (partners, drafts, findings, totals) — pure, deterministic, fully unit-tested; the
  web app renders `CloseModel` and owns only review state.
- `web/` UI rebuilt (React + Tailwind + existing ui primitives); screens are
  presentational over `CloseModel`.
- Old Lindita-recreation modules and tests remain; the demo path still exercises them.

## Testing

- Fixture slices cut from the real files (repo is private): rate-card parser block/
  continuation/Managed-sub-block cases; cost-rule pins from invoice INVCUS2026-0002193
  ($5.55 vs $6.08 Seven Star/Rocker; $8.25 vs $8.55 Meeting Tree); alias matching; MOD*/
  Modsatflex/BU* mapping incl. product-specific-flex precedence; audit-metric parsing;
  draft invoice totals; exception coverage (missing rate, unknown code, qty mismatch).
- Existing 131 tests stay green.
- Playwright pass over the built app (drop real files, walk all six screens) before ship.

## Out of scope

- No backend, auth, or shared multi-user review state (revisit if the team outgrows
  localStorage).
- No QuickBooks API connection — file import formats only, as before.
- Hosting hardening (password on the deployed site) decided at deploy time.
