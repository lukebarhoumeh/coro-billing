# Architecture — Coro billing automation

This is the build contract. It turns the `README.md` spec (Dane's words from the
Sep 11 2026 call) into fixed module boundaries and function signatures. Every
module implements the signatures below **exactly** so the pieces compose without
integration surprises.

## The one-sentence job

> Coro usage in → attach **H (our cost)** and **L (what we charge the MSP)** per
> partner×SKU → break the partner bill **down by customer** → **recreate August and
> diff it against Lindita** → emit **QuickBooks** invoices. Margin follows.

## Data flow

```
data/*.xlsx ──ingest──▶ UsageLine[] / RateCardEntry[] / MsrpEntry[] /
                        CoroInvoiceLine[] / LinditaLine[]
                              │
              rating (applyRates + 5% buffer + exceptions)
                              ▼
                        RatedLine[]  + Exception[]
                              │
                 invoicing (group by partner, break down by customer)
                              ▼
                         QbInvoice[]
                    │                     │
        reconcile (vs Lindita,      export (QuickBooks CSV / IIF /
        run checks)                 QBO API adapter stub)
                    ▼                     ▼
        DiscrepancyReport         out/*.csv  +  adapter.createInvoices()
```

## Non-negotiable rules (from README + transcript)

1. **Never invent rates.** Per-partner H/L come only from rate-card files. The only
   hardcoded constants are the **5% buffer** and **45% legacy discount** (both quoted
   in the call), in `src/config/pipeline.config.ts`.
2. **Never fall back to a house average** on a rate miss — Dane: "all these partners
   are on different stuff." A miss becomes an `Exception`, not a guess.
3. **MSRP is never Hub cost.**
4. **Quantity is the driver** — never optional.
5. **U and D stay unknown** — carried raw, never interpreted.
6. **Legacy stays visible** as its own class; August still has legacy.
7. **Two Coro invoices stay two** (1914 and 2193) until proven otherwise.
8. The system **flags** exceptions; it never silently "fixes" a rate. Accounting
   accepts / reclasses / holds.
9. **Determinism:** same inputs → byte-identical outputs. No `Date.now()` inside
   pure pipeline logic (inject dates at the CLI/export boundary).

## Foundation (already built — do not modify, only import)

| File | Exports |
| --- | --- |
| `src/lib/result.ts` | `Result<T,E>`, `ok`, `err`, `isOk`, `isErr`, `map`, `all`, `unwrap` |
| `src/lib/money.ts` | `Money` (decimal-exact), `sum` |
| `src/domain/types.ts` | all entity types (the contract) |
| `src/config/pipeline.config.ts` | `BUSINESS`, `*_COLUMN_MAP`, `defaultConfig`, `resolveColumn`, `normalizeHeader` |
| `src/ingest/xlsx.ts` | `loadWorkbook`, `readSheet`, `pickSheet`, `sheetNames`, `str`, `num`, `bool`, `WorkbookInput`, `SheetData`, `IngestError`, `ingestError` |

## Modules to implement (each = one owner, TDD)

Every parser accepts a `WorkbookInput` (path | buffer | in-memory workbook) plus the
relevant `ColumnMap`, and returns `Result<T[], IngestError>`. Use `readSheet` +
`resolveColumn` + the cell accessors. Attach `raw` and `sourceRow` for traceability.

### `src/ingest/usage.ts`
```ts
export function parseUsage(
  input: WorkbookInput,
  cfg?: { columns?: ColumnMap; period?: Period; sheet?: string }
): Result<UsageLine[], IngestError>;
```
- Locate the usage tab (default: sheet named ~"usage", else first). Classify each row's
  SKU (`legacy` if the legacy flag/column says so, else `current`; `noise` if no SKU).
- `customer` = workspace/child account (may be null for partner-level rows).
- `u`/`d` → `{ raw, known:false }`. `quantity` required (`NEGATIVE_OR_ZERO_QTY` handled
  downstream in rating, but keep the number).

### `src/ingest/rateCard.ts`
```ts
export function parseRateCard(
  input: WorkbookInput,
  cfg?: { columns?: ColumnMap; period?: Period }
): Result<RateCardEntry[], IngestError>;
```
- Read **all** sheets. A sheet whose name normalizes to include "legacy" → `class:"legacy"`;
  otherwise `class:"current"`. "same format" per Dane.
- `mspPrice` = L ("net price to MSP"/"their price"); `hubCost` = H ("our price").
- If a legacy sheet gives only a list cost + implies the 45% discount, compute
  `hubCost` via `Money.applyDiscount(0.45)` and set `bufferApplied` when the buffer is
  layered (buffer application itself lives in rating; the parser may pre-populate H
  when the sheet is explicit). Keep `discountPct` if present.

### `src/ingest/lindita.ts`
```ts
export function parseLinditaWorkbook(
  input: WorkbookInput,
  cfg?: { columns?: ColumnMap; period?: Period; sheet?: string }
): Result<LinditaLine[], IngestError>;
```
- The recreation target. Map column **H → ourPrice**, column **L → charge**. If a
  `margin` column exists, capture it; the reconciler recomputes and cross-checks.

### `src/ingest/msrp.ts`
```ts
export function parseMsrp(input: WorkbookInput, cfg?: { columns?: ColumnMap }): Result<MsrpEntry[], IngestError>;
```

### `src/ingest/coroInvoice.ts`
```ts
export function parseCoroInvoice(
  input: WorkbookInput,
  cfg?: { columns?: ColumnMap; invoiceNumber?: string }
): Result<CoroInvoiceLine[], IngestError>;
```
- If `invoiceNumber` isn't in the sheet, accept it from `cfg` (filenames encode 1914/2193).

### `src/rating/rateCardIndex.ts`
```ts
export function buildRateCard(entries: RateCardEntry[]): RateCard; // implements lookup()
```
- `lookup(partner, sku, period)` matches on normalized partner+sku, prefers exact period,
  else most recent ≤ period. **No** average fallback.

### `src/rating/buffer.ts`
```ts
export function applyHubBuffer(partnerDiscountFraction: number, bufferPct?: number): number; // 0.60 -> 0.65
export function legacyHubCostFromList(listPrice: Money, cfg?: { legacyDiscountPct?: number; bufferPct?: number; applyBuffer?: boolean }): Money;
```
- Encodes Dane's "60% → 65%" and Lisa's "list − 45%".

### `src/rating/applyRates.ts`
```ts
export function applyRates(
  usage: UsageLine[],
  rateCard: RateCard,
  cfg: PipelineConfig
): RatingResult; // { rated, exceptions }
```
- For each usage line: look up the rate row; compute `amountCost = H*qty`,
  `amountCharge = L*qty`, `margin = charge − cost`. Emit `Exception`s for every rule
  in `ExceptionKind` (missing H/L, missing row, legacy unconfirmed, unknown U/D as
  `info`, zero/neg qty, cost-vs-invoice when invoices are supplied via cfg later).
- A line with a blocking exception still appears in `rated` with `hubCost/mspPrice`
  = `Money.zero()` and the exception attached — never dropped silently.

### `src/invoicing/buildInvoices.ts`
```ts
export function buildInvoices(rated: RatedLine[], period: Period): QbInvoice[];
```
- One invoice **per partner (MSP)** for the period. `lines` broken down **by customer**
  (Dane's Amplivity example). `rate` on each line = L (unit). Compute subtotals + margin.
  Sort deterministically (partner, then customer, then sku).

### `src/reconcile/checks.ts`
```ts
export function runChecks(ctx: {
  rated: RatedLine[]; invoices: QbInvoice[]; coroInvoices?: CoroInvoiceLine[]; usage: UsageLine[];
}): CheckResult[];
```
- Implement the README "Reconciliation checks" table: usage row with no H/L; partner on a
  deal not on the rate card; child workspace not rolled into the parent invoice; Coro
  invoice vs H×qty; legacy priced as current.

### `src/reconcile/august.ts`
```ts
export function reconcileAgainstLindita(
  rated: RatedLine[],
  lindita: LinditaLine[],
  cfg: PipelineConfig
): DiscrepancyReport;
```
- **The acceptance test.** Join on partner+customer+sku. Compare `ourPrice/charge`
  (cent-exact via `Money.equalsCents`), qty, and margin. `matched` iff no unexplained
  discrepancies and no only-in-one rows (within `reconToleratedCents`). Populate
  `discrepancies`, `onlyInOurs`, `onlyInLindita`, totals.

### `src/export/quickbooks.ts`
```ts
export function toQuickBooksCsv(invoices: QbInvoice[], opts?: { invoiceDate?: string; dueDate?: string; termsDays?: number }): string;
export function toIif(invoices: QbInvoice[], opts?: {...}): string; // QuickBooks Desktop
export interface QuickBooksAdapter { createInvoices(invoices: QbInvoice[]): Promise<{ created: number; ids: string[] }>; }
export class CsvQuickBooksAdapter implements QuickBooksAdapter { /* writes CSV to out/ */ }
export class ApiQuickBooksAdapter implements QuickBooksAdapter { /* DOCUMENTED STUB: QBO Invoice API. Throws NotConfigured until wired. */ }
```
- CSV columns follow the common QBO 3-line invoice import: `InvoiceNo, Customer,
  InvoiceDate, DueDate, Item(Product/Service), ItemDescription, ItemQuantity, ItemRate,
  ItemAmount`. One CSV row per invoice line; `Customer` = the MSP; the end customer/
  workspace goes in `ItemDescription` (the by-customer breakdown Dane wants).
- The API adapter must NOT hardcode secrets and must not run in tests; verify the QBO
  Invoice shape against live docs (Context7 `intuit/quickbooks` or developer.intuit.com)
  before wiring — leave a clear `TODO(verify)` with the doc link.

### `src/cli/index.ts`
```ts
// commander program: `run`, `reconcile`, `export`
//   coro-billing run       --data <dir> --month YYYY-MM [--out out/]
//   coro-billing reconcile --data <dir> --month YYYY-MM   (recreate vs Lindita, print report)
//   coro-billing export    --data <dir> --month YYYY-MM --format csv|iif
```
- Wires ingest → rating → invoicing → reconcile → export. Prints an exception/discrepancy
  summary. This is the only place `Date`/filesystem writes live in "business" flow.

## Synthetic fixtures — policy

Real Coro/Hub/Jack files are **not** in the repo. To prove the pipeline end-to-end we use
**synthetic** fixtures under `fixtures/synthetic/`. Rules:

- Every synthetic file/dataset is loudly labeled `SYNTHETIC — not real Coro/partner data`.
- Partner names are obviously fake (`Acme MSP`, `Globex MSP`, `Initech MSP`), never real
  partners from the call except where the README already names them as examples.
- Fixtures are generated in-memory by a builder (`fixtures/synthetic/build.ts`) using
  SheetJS so tests need no committed binaries; a `.gitkeep`/README documents provenance.
- The golden test constructs a self-consistent trio (usage + rate card + Lindita) so the
  pipeline reproduces Lindita **cent-exact** (diff = 0), plus a second dataset with a
  deliberate legacy `$6 vs $9` discrepancy to prove detection.

## Testing & verification

- **TDD**: write the test first, watch it fail, implement, watch it pass.
- `pnpm test` (vitest) must be green; `pnpm typecheck` must be clean (strict, `noUncheckedIndexedAccess`).
- Each module ships `*.test.ts` next to it or under `tests/`. The end-to-end golden test
  lives in `tests/e2e.golden.test.ts`.
- Money comparisons use `Money.equalsCents` — never `===` on floats.

## Coding standards

- ESM, NodeNext, strict TS. `.js` extensions on relative imports (NodeNext requirement).
- No throwing across module boundaries — return `Result`. Throw only for true programmer
  errors (e.g. `Money.div` by zero).
- Keep functions pure where possible; side effects (fs, stdout) only in `cli/` and the
  `CsvQuickBooksAdapter`.
