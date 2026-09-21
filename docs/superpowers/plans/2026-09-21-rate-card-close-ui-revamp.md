# Rate-Card Close + Web UI Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the rate-card-driven monthly close (special pricing CSV × usage → per-MSP draft invoices, Coro invoice as cross-check) and rebuild the web dashboard around it: drag-drop intake, six screens, approve/flag review, QuickBooks/print/Excel exports.

**Architecture:** New pure modules (`src/ingest/specialPricing.ts`, `src/config/productMap.ts`, `src/close/rateCardClose.ts`) compose into a `CloseModel` consumed by the rebuilt `web/` app. Everything runs client-side; SheetJS already accepts `Uint8Array`, so the same parsers serve Node tests and the browser. The invoice-driven close (`src/close/invoiceClose.ts`) stays untouched as a parallel path.

**Tech Stack:** TypeScript, Vitest, SheetJS (`xlsx`), React 18 + Tailwind + existing `web/src/components/ui` primitives, Vite. Money is ALWAYS `src/lib/money.ts` `Money` (integer cents, `add/sub/mul/div/applyDiscount/equalsCents/toFixed2`); results are `src/lib/result.ts` `Result<T,E>`.

**Spec:** `docs/superpowers/specs/2026-09-21-coro-billing-ui-revamp-design.md`. Read it first — money semantics (col E = L; H under both the ×0.95 sheet rule and the additive rule Coro actually bills), MOD*→Modules Flex mapping, and validation list live there.

**Ground truth used for pinned test numbers** (verified against real files this session):
- Seven Star Systems, Coro AI Complete: list $15.00, E=$6.40, F=58%, G=5%, col H=$6.08, col I=61% (sheet cell inconsistent — 58+5=63). Additive H = 15×(1−0.63) = **$5.55** (matches Coro invoice 2193 Rocker/Viener4Gates lines: Rate 5.55, Discount 0.63).
- Meeting Tree Computer, Coro AI Complete: E=$9.00, F=40%, G=5%, col H=$8.55, additive H = 15×0.55 = **$8.25** = invoice 2193 line 4 Rate.
- Amplivity `MODNETWflex` must price from its **"Network Flex"** row ($3.00 E), NOT the generic modules row — specific flex beats generic.
- Evolve `Modsatflex` → "SAT Flex" row (E=$1.40) — matches 2193 line 14 billing SAT separately.
- Usage sheet Quantity column is UNRELIABLE (a later re-export zeroes it); the `Audit` string is the quantity authority. `reduceUsage` already implements this.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/domain/types.ts` (modify) | Add `partnerSlug?` to `UsageLine`; add `PricingRow`, `PricingPartner`, `SpecialPricingResult`, `DraftLine`, `PartnerDraft`, `CloseModel` |
| `src/lib/csv.ts` (create) | RFC4180 CSV text parser (quoted fields, CRLF, embedded commas/newlines) |
| `src/ingest/specialPricing.ts` (create) | CSV rate card → `SpecialPricingResult` + in-file validations + `validateListPrices` |
| `src/config/productMap.ts` (create) | usage product code → pricing row resolution (precedence chain) |
| `src/ingest/usageReduce.ts` (modify) | carry `partnerSlug` through reduction |
| `src/close/rateCardClose.ts` (create) | usage × rate card (× optional Coro invoice) → `CloseModel` + `RatedLine[]` |
| `tests/lib/csv.test.ts`, `tests/ingest/specialPricing.test.ts`, `tests/config/productMap.test.ts`, `tests/close/rateCardClose.test.ts` (create) | TDD suites for the above |
| `tests/e2e.rateCardClose.real.test.ts` (create) | full close over the real `data/2026-08/` packet (skip when absent) |
| `fixtures/synthetic/rateCardDemo.ts` (create) | loudly-synthetic pricing CSV text + usage workbook + invoice for demo mode & UI tests |
| `web/src/lib/loadFiles.ts` (create) | browser File → parsed inputs, SHA-256 fingerprints, parse report |
| `web/src/lib/closeStore.tsx` (create) | React store: loaded inputs, CloseModel, review state (localStorage), demo mode |
| `web/src/lib/exportWorkbook.ts`, `web/src/lib/download.ts` (create) | XLSX workbook + QB CSV/IIF/print exports, browser download |
| `web/src/App.tsx` (rewrite), `web/src/screens/{Intake,Overview,RateCards,Reconcile,Invoices,Exceptions}.tsx` | Six-screen shell (old screens replaced; old files deleted after) |
| `web/src/index.css` (modify) | print stylesheet for invoice pages |
| `README.md` (modify) | new close story + web usage |

Conventions to follow (read 2-3 existing files first, e.g. `src/ingest/rateCard.ts`, `src/close/invoiceClose.ts`): heavy "business anchor" doc comments quoting the source call/spec; deterministic iteration (sorted or first-seen order, no clock/randomness); never invent a rate — raise an `Exception` instead; parsers tolerate dirty cells and carry raw values.

---

### Task 1: Carry the workspace slug through usage reduction

**Files:** Modify `src/domain/types.ts` (UsageLine), `src/ingest/usageReduce.ts`; Test `tests/ingest/usageReduce.test.ts` (append)

- [ ] **Step 1: Failing test** — append to `tests/ingest/usageReduce.test.ts`:

```ts
it("carries the raw parent workspace slug on every reduced line", () => {
  const lines = [
    metricLine({ partner: "amplivitycom_NE7N_b", customer: "alnobaorg_O2MB_b", metric: "Users",
      quantity: 13, audit: "LEGACY | u=13 d=14 | CORO_ESSENTIALS=14 [math.max(users, devices)]" }),
    metricLine({ partner: "amplivitycom_NE7N_b", customer: "alnobaorg_O2MB_b", metric: "Devices",
      quantity: 14, audit: "LEGACY | u=13 d=14 | CORO_ESSENTIALS=14 [math.max(users, devices)]" }),
  ];
  const { billed } = reduceUsage(lines);
  expect(billed).toHaveLength(1);
  expect(billed[0]!.partnerSlug).toBe("amplivitycom_NE7N_b"); // raw, pre-mapping
  expect(billed[0]!.partner).toBe("Amplivity"); // mapped name unchanged
});
```

(Reuse the file's existing `metricLine` helper; if its signature differs, adapt the call, not the assertion.)

- [ ] **Step 2:** `pnpm vitest run tests/ingest/usageReduce.test.ts` → FAIL (`partnerSlug` undefined).
- [ ] **Step 3:** In `src/domain/types.ts` add to `UsageLine` (after `partner`):

```ts
  /**
   * Raw Coro parent-workspace slug exactly as the usage file keys it
   * (`amplivitycom_NE7N_b`). The special-pricing CSV joins on THIS (its
   * "Workspace ID" column), not on the mapped display name. Set by reduceUsage;
   * absent on hand-built fixtures.
   */
  readonly partnerSlug?: string;
```

In `reduceUsage`, store `slug: line.partner` on the `Group` when created, and emit `partnerSlug: g.slug` on the output line.

- [ ] **Step 4:** `pnpm vitest run tests/ingest/usageReduce.test.ts` → PASS; then full `pnpm vitest run` → 181 tests green.
- [ ] **Step 5:** Commit: `feat(usage): carry raw parent workspace slug through reduction`

### Task 2: RFC4180 CSV parser

**Files:** Create `src/lib/csv.ts`; Test `tests/lib/csv.test.ts`

- [ ] **Step 1: Failing tests** — `tests/lib/csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCsv } from "../../src/lib/csv.js";

describe("parseCsv", () => {
  it("splits simple rows and trims the trailing newline", () => {
    expect(parseCsv("a,b,c\r\n1,2,3\r\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
  it("honors quoted fields with commas, quotes and newlines", () => {
    expect(parseCsv('name,addr\n"Doe, Jane","169 Madison Ave\n#36073"\n"say ""hi"""\n'))
      .toEqual([["name", "addr"], ["Doe, Jane", "169 Madison Ave\n#36073"], ['say "hi"']]);
  });
  it("keeps empty cells and ragged rows as-is (caller pads)", () => {
    expect(parseCsv("a,,c\nd\n")).toEqual([["a", "", "c"], ["d"]]);
  });
});
```

- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3:** Implement a single-pass state machine (~40 lines): iterate chars, track `inQuotes`; `""` inside quotes → literal `"`; `\r` outside quotes ignored; `\n` outside quotes ends row; final field flushed; a trailing empty last row (from terminal newline) dropped. No regex splitting.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit: `feat(lib): RFC4180 CSV parser for the special-pricing rate card`

### Task 3: Special-pricing CSV parser + validations

**Files:** Create `src/ingest/specialPricing.ts`; Modify `src/domain/types.ts`; Test `tests/ingest/specialPricing.test.ts`

Domain types to add in `src/domain/types.ts`:

```ts
/** One product row of a partner's special-pricing block (CSV columns C–I). */
export interface PricingRow {
  readonly product: string;               // col C as written ("Coro AI Complete")
  readonly listPrice: Money | null;       // col D ("$15.00" or "15.00" or blank)
  readonly netMsp: Money | null;          // col E — L: what the MSP pays Hub (Luke, 2026-09-21)
  readonly mspDiscountPct: number | null; // col F, 60 for "60%"
  readonly hubDiscountPct: number | null; // col G
  readonly netHubStated: Money | null;    // col H as WRITTEN (do not trust; validated)
  readonly totalDiscountPct: number | null; // col I as written
  readonly sourceRow: number;             // 1-based CSV row
}

/** One partner block of the special-pricing CSV. */
export interface PricingPartner {
  readonly name: string;                  // col A ("Seven Star Systems")
  readonly workspaceId: string | null;    // col B, trimmed + lowercased ("sevenstarsystemscom_x8e3_b")
  readonly rows: readonly PricingRow[];
  readonly approxMonthlySpend: string | null; // col J raw (free text: "$1,000.00", "Awaiting sig.")
  readonly activeUsers: string | null;    // col K raw
  readonly totalWorkspaces: string | null;// col L raw
  readonly contactName: string | null;    // col M
  readonly contactPhone: string | null;   // col N
  readonly contactEmail: string | null;   // col O
  readonly address: string | null;        // col Q
  readonly sourceRow: number;
}

export interface SpecialPricingResult {
  readonly partners: readonly PricingPartner[];
  readonly findings: readonly Exception[];
}
```

Add these `ExceptionKind` members (find the union in types.ts and extend): `"SHEET_MATH_INCONSISTENT" | "DUPLICATE_RATE_ROW" | "MISSING_WORKSPACE_ID" | "DUPLICATE_WORKSPACE_ID" | "EMPTY_PARTNER_BLOCK" | "LIST_PRICE_DIVERGES"`.

Parser contract — `parseSpecialPricing(csvText: string, period: Period): Result<SpecialPricingResult, IngestError>`:

1. `parseCsv`, pad every row to 17 cells.
2. Header row = first row whose cell 0 normalizes to `msp` and cell 1 to `workspace id` (use `normalizeHeader` from `pipeline.config.ts`). Letterhead above ignored. No header → `err(ingestError("specialPricing", "header row not found"))`.
3. Walk data rows. A row with non-blank col A starts a block. **Sub-block fold-in:** block names normalizing to `managed` / `managed included` (case-insensitive) with blank workspace ID append their rows to the ENCLOSING partner (finding none — this is the sheet's idiom). A block with a name but zero product rows AND blank workspace (e.g. the stray `XTB` alias line) → dropped with `EMPTY_PARTNER_BLOCK` info.
4. A row with non-blank col C is a product row of the current block (the block's first row usually carries both A and C). Blank C rows are spacers — skipped.
5. Cell parsing: money = strip `$`, `,`, whitespace → `Money.of` (blank/garbage → null, never throw); percent = strip `%` → number (blank → null). Workspace ID trimmed + lowercased (the CSV has `Forcetechitcom_XCYS_b`).
6. Duplicate product name (normalized) within one partner → keep FIRST row, `DUPLICATE_RATE_ROW` warn.
7. In-file validations (findings, all with partner/sku/sourceRow):
   - `netHubStated` present, `netMsp` present, and `!netHubStated.equalsCents(netMsp.mul(0.95))` (compare via `equalsCents` after rounding — use `Money.of(netMsp.toNumber() * 0.95)` semantics consistent with money.ts rounding) → `SHEET_MATH_INCONSISTENT` info, message states both numbers.
   - `totalDiscountPct !== mspDiscountPct + hubDiscountPct` (all present) → `SHEET_MATH_INCONSISTENT` info.
   - Real partner block with blank workspace → `MISSING_WORKSPACE_ID` warn. Two blocks sharing a workspace → `DUPLICATE_WORKSPACE_ID` warn.
8. `validateListPrices(partners): Exception[]` (exported, called by the close): group all rows by normalized product name; if >1 distinct non-null list price cents → one `LIST_PRICE_DIVERGES` warn per product naming the variants and partners (Danny: "should be the same in every single one").

- [ ] **Step 1: Failing tests** — fixture is a template-literal CSV cut from the real file (keep real numbers; it's already committed data shape). Cover: Net-Tech block (9 rows incl. blank-price "Coro Managed Flex" row kept with nulls); Seven Star block (col H $6.08, col I 61 → expect BOTH sheet-math findings); Evolve + `Managed` sub-block (folds to 8 rows, "Coro Managed" E=$2.50); stray `XTB` alias line → EMPTY_PARTNER_BLOCK + XTB Solutions parsed normally; MC Squared (`15.00` no `$`); duplicate-product and duplicate-workspace synthetic cases; `validateListPrices` divergence case. Assert workspaceId lowercasing (`forcetechitcom_xcys_b`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement per contract. **Step 4:** Run → PASS + full suite green. **Step 5:** Commit: `feat(ingest): special-pricing CSV rate card parser (col E = partner cost)`

### Task 4: Product-code → pricing-row resolution

**Files:** Create `src/config/productMap.ts`; Test `tests/config/productMap.test.ts`

```ts
export type MatchKind =
  | "exact" | "specific-flex" | "modules-flex" | "sat-flex"
  | "fallback-current" | "assumed-add" | "nfr" | "none";

export interface RowMatch {
  readonly row: PricingRow | null;
  readonly kind: MatchKind;
  /** Human-readable why, for findings/UI ("MODNETWflex → partner's 'Network Flex' row"). */
  readonly reason: string;
}

export function resolvePricingRow(partner: PricingPartner, vendorSku: string): RowMatch;
```

Resolution (first hit wins; product-name compare = trim, lowercase, collapse spaces):

1. `COR-COMP-NFR` (any `-NFR` suffix) → `{ row: null, kind: "nfr" }` — non-billable.
2. Current-gen exact: `COR-COMP-C`→"Coro AI Complete"; `COR-ESS-C`→"Coro AI Essentials"; `COR-ENDP-C`→"Coro AI Endpoint"; `COR-LTE-C`→"Coro AI Lite"; `COR-MANAGE-C`→["Coro Managed/Monthly","Coro Managed"].
3. `Modsatflex` (case-insensitive) → "SAT Flex" (`sat-flex`), else fall through to the modules chain.
4. `MOD*flex` (Luke 2026-09-21: "MOD first = modules flex"): try the code-specific flex name first (`specific-flex`): MODNETWflex→"Network Flex", MODEMAILflex→"Email Flex", MODUSRDATAflex→"User Data Flex", MODENDSECflex→"Endpoint Security Flex", MODENDDATAflex→"Endpoint Data Flex", MODCLOUDflex→"Cloud Flex"; then generic (`modules-flex`): "Modules Flex" → "Coro Module Flex" → "Coro AI Modules" (last is `fallback-current`).
5. Legacy bundles — try flex row, then current row (`fallback-current`): `BUCOMflex`→["Complete Flex","Coro AI Complete"]; `BUCOROflex`→["Essentials Flex","Coro AI Essentials"]; `BUCOCLASSflex`→["Classic Flex","Coro Classic Flex","Coro Classic"]; `BUCOCLASSMNflex`→["Managed Classic Flex","Classic Flex"]; `BUCOMMNGflex`→["Complete Managed Flex","Complete Flex","Coro AI Complete"]; `BUENDflex`→["Endpoint Protection Flex","Coro AI Endpoint"]; `BUEMAILflex`→["Email Protection Flex","Email Flex"].
6. `ADD*flex` (ADDSECUREWEBflex, ADDMDRflex) → generic modules chain, kind `assumed-add` (spec: assumed mapping, surfaced until confirmed).
7. Nothing → `{ row: null, kind: "none" }`.

- [ ] **Step 1: Failing tests** — build tiny `PricingPartner` literals; pin: Amplivity MODNETWflex → Network Flex $3.00 `specific-flex`; Cyber-Construction-style partner (only "Modules Flex" $3.00) MODEMAILflex → `modules-flex`; Net-Tech-style (only "Coro Module Flex") MODUSRDATAflex → it; Evolve Modsatflex → SAT Flex $1.40; Rocker BUCOMflex → "Coro AI Complete" `fallback-current` (no flex row); ADDMDRflex → `assumed-add`; COR-COMP-NFR → `nfr`; unknown `XYZZY` → `none`; case-insensitivity (`modnetwflex`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement (data-driven tables + small resolver; no class). **Step 4:** PASS + suite. **Step 5:** Commit: `feat(config): usage product-code → special-pricing row resolution (MOD* = Modules Flex)`

### Task 5: The rate-card close

**Files:** Create `src/close/rateCardClose.ts`; Modify `src/domain/types.ts` (CloseModel types); Test `tests/close/rateCardClose.test.ts`

Types (types.ts):

```ts
/** Per-customer share of a draft line (child workspace breakdown). */
export interface DraftCustomerShare {
  readonly customer: string | null; // child slug; null = partner's own workspace
  readonly quantity: number;
}

/** One product line on a per-MSP draft invoice. */
export interface DraftLine {
  readonly vendorSku: string;            // usage product code (BUCOROflex, COR-COMP-C…)
  readonly productLabel: string;         // pricing row product, or usage product name if unpriced
  readonly quantity: number;             // audit-derived billed qty (sum over customers)
  readonly customers: readonly DraftCustomerShare[];
  readonly matchKind: MatchKind;
  readonly unitL: Money | null;          // pricing col E; null ⇒ HELD (MISSING_RATE)
  readonly amountL: Money | null;        // unitL × qty
  readonly expectedHSheet: Money | null;    // col H as stated (fallback E×0.95 when blank)
  readonly expectedHAdditive: Money | null; // list × (1 − (F+G)/100)
  readonly actualHUnit: Money | null;    // Coro invoice Subtotal ÷ qty (display), when loaded
  readonly actualHAmount: Money | null;  // Coro invoice Subtotal share (authoritative money)
  readonly invoiceQuantity: number | null; // Coro invoice qty for this partner×sku, when loaded
  readonly margin: Money | null;         // amountL − (actualHAmount ?? expectedHAdditive×qty)
  readonly marginBasis: "actual" | "expected-additive" | "none";
  readonly findings: readonly Exception[];
}

export interface PartnerDraft {
  readonly slug: string;                 // workspace slug (join key)
  readonly cardName: string;             // pricing CSV name ("Seven Star Systems")
  readonly invoiceName: string | null;   // PARTNER_SLUG_MAP name when known
  readonly contact: Pick<PricingPartner, "contactName" | "contactPhone" | "contactEmail" | "address">;
  readonly lines: readonly DraftLine[];
  readonly totalL: Money;                // sum of non-null amountL
  readonly totalHExpected: Money;
  readonly totalHActual: Money | null;   // null until an invoice line matched
  readonly totalMargin: Money;
  readonly heldLines: number;            // lines with null unitL
}

export interface CloseModel {
  readonly period: Period;
  readonly partners: readonly PartnerDraft[]; // sorted by cardName
  /** Rate-card partners with no usage this month (info). */
  readonly cardOnly: readonly PricingPartner[];
  /** Usage parents with no pricing block (warn) — slug + mapped name. */
  readonly usageOnly: readonly { slug: string; partner: string }[];
  readonly findings: readonly Exception[]; // global + roll-up of line findings
  readonly ratedLines: readonly RatedLine[]; // for buildInvoices → QuickBooks reuse
}

export function closeFromRateCard(args: {
  pricing: SpecialPricingResult;
  usage: readonly UsageLine[];          // parseUsage output (reduce happens inside)
  coroInvoiceLines?: readonly CoroInvoiceLine[]; // optional cross-check
  period: Period;
}): CloseModel;
```

New `ExceptionKind` members: `"MISSING_RATE" | "UNKNOWN_PRODUCT_CODE" | "INVOICE_QTY_DISAGREES" | "INVOICE_RATE_UNEXPECTED" | "ASSUMED_MAPPING" | "USAGE_NOT_ON_CARD" | "NFR_LINE"` (reuse existing kinds where a same-named one already exists — check the union before adding).

Algorithm:

1. `reduceUsage(usage)` → billed lines carrying `partnerSlug`. Group by slug → per-slug by `sku.vendorSku`; qty = Σ, customers = per-customer shares (sorted: partner-level `null` first, then slug asc).
2. Index pricing partners by `workspaceId`. Join per slug (lowercase both).
3. Per (partner, sku): `resolvePricingRow`. `none` → `UNKNOWN_PRODUCT_CODE` block + HELD; `nfr` → `NFR_LINE` info, line included with null money, excluded from totals; `assumed-add` → `ASSUMED_MAPPING` info; `fallback-current` → info finding naming the fallback; row with null `netMsp` → `MISSING_RATE` block + HELD.
4. Money: `amountL = unitL.mul(qty)`. `expectedHAdditive = listPrice.applyDiscount((F+G)/100)` when list/F/G present. `expectedHSheet = netHubStated ?? unitL.mul(0.95)`.
5. Invoice cross-check (when lines provided): map invoice partner name → slug by inverting `PARTNER_SLUG_MAP` (exported helper `slugForInvoiceName(name)` added to `src/config/partners.ts` — normalize case; unmatched invoice partners → global warn). Match on (slug, vendorSku); out-of-period lines (servicePeriod ≠ close period) excluded with the existing OUT_OF_PERIOD kind. Sum matched invoice qty + Subtotal `amount`; `actualHAmount` = that Subtotal total (authoritative — never `Rate × qty`, per AUGUST_CLOSE_PLAN fact 1); `actualHUnit = actualHAmount.div(qty)` display. `invoiceQuantity ≠ quantity` → `INVOICE_QTY_DISAGREES` warn. `actualHUnit` differing from BOTH expected values by >1¢/unit → `INVOICE_RATE_UNEXPECTED` warn naming all three numbers.
6. `margin = amountL − (actualHAmount ?? expectedHAdditive.mul(qty))`, basis tracked; both-null → basis `none`, margin null.
7. `ratedLines`: one `RatedLine` per (partner, customer, sku) with unitL/qty split per customer (qty from the customer share; HELD/NFR lines excluded), `rate` = a `RateCardEntry` built from the pricing row (source: "special-pricing CSV"), so `buildInvoices` + QB export work unchanged.
8. Global findings: pricing findings + `validateListPrices` + join gaps (`USAGE_NOT_ON_CARD` warn per usage-only slug; cardOnly listed, one info) — all deterministic order.

- [ ] **Step 1: Failing tests** — fixtures as literals. Pin at minimum:
  - Seven Star: qty 10 × Complete → unitL $6.40, amountL $64.00, expectedHSheet $6.08, expectedHAdditive $5.55, margin basis expected-additive = 64.00 − 55.50 = $8.50.
  - Meeting Tree + invoice fixture line (COR-COMP-C qty 59, amount $486.75): actualHAmount 486.75, actualHUnit 8.25, margin = 9.00×59 − 486.75 = $44.25, basis actual; sheet-vs-actual delta produces `INVOICE_RATE_UNEXPECTED`? NO — 8.25 equals expectedHAdditive → no finding. Add a separate case where the invoice rate matches neither → finding fires.
  - Qty disagreement (usage 59 vs invoice 55) → `INVOICE_QTY_DISAGREES`.
  - Missing rate row → HELD + `MISSING_RATE`, partner `heldLines` counts it, ratedLines excludes it.
  - NFR excluded from totals; usage-only slug → `USAGE_NOT_ON_CARD`; card-only partner listed.
  - Determinism: two runs deep-equal.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + full suite. **Step 5:** Commit: `feat(close): rate-card-driven close — special pricing × usage with Coro-invoice cross-check`

### Task 6: Real-packet e2e test

**Files:** Create `tests/e2e.rateCardClose.real.test.ts`

- [ ] **Step 1:** Mirror the skip-guard pattern of `tests/e2e.real.test.ts` (describe.skipIf when `data/2026-08/` files absent). Load real CSV (`data/2026-08/Coro Special MSP Pricing(Special Pricing).csv`), usage xlsx, invoice 2193 via existing parsers; run `closeFromRateCard`.
- [ ] **Step 2:** First run in "discovery" mode: log partner count, join coverage, totals, finding histogram. **Pin the observed values as assertions** (e.g. expect ≥14 joined partners of 16 usage parents, expected `usageOnly` empty-or-named, totalL/totalHActual exact cents, LIST_PRICE_DIVERGES for Classic Flex 11.99-vs-? if real). Assert: no `UNKNOWN_PRODUCT_CODE` for the August packet; every non-held line has non-null margin; run-twice determinism.
- [ ] **Step 3:** Full suite green. **Step 4:** Commit: `test(close): pin the real August 2026 rate-card close end-to-end`

### Task 7: Synthetic demo dataset for the new path

**Files:** Create `fixtures/synthetic/rateCardDemo.ts`; Test `tests/close/rateCardDemo.test.ts`

- [ ] **Step 1:** Export `buildRateCardDemo(): { pricingCsv: string; usage: UsageLine[]; coroInvoiceLines: CoroInvoiceLine[]; period: Period }` — 3 fake partners ("Acme MSP", "Globex Managed", "Initech IT"; slugs `acmemsp_TEST_b`…), obviously fake contacts, a deliberate qty-mismatch, one HELD line, one MOD* line, one NFR. Reuse the SYNTHETIC_BANNER constant.
- [ ] **Step 2:** Test: demo close produces ≥3 partners, exactly one MISSING_RATE, one INVOICE_QTY_DISAGREES, deterministic. **Step 3:** Green + commit: `feat(fixtures): synthetic demo packet for the rate-card close`

### Task 8: Browser plumbing — file loading + close store

**Files:** Create `web/src/lib/loadFiles.ts`, `web/src/lib/closeStore.tsx`; Test `tests/web/loadFiles.test.ts` (node-runnable parts)

`loadFiles.ts`:

```ts
export type SlotKey = "pricing" | "usage" | "invoice";
export interface LoadedFile {
  readonly slot: SlotKey;
  readonly fileName: string;
  readonly fingerprint: string; // hex SHA-256 of bytes (crypto.subtle)
  readonly report: { readonly rowsRead: number; readonly partners?: number; readonly warnings: readonly string[] };
}
export async function ingestFile(slot: SlotKey, file: File): Promise<Result<{ loaded: LoadedFile; payload: SlotPayload }, string>>;
```

- pricing: `await file.text()` → `parseSpecialPricing`; usage/invoice: `new Uint8Array(await file.arrayBuffer())` → existing `parseUsage`/`parseCoroInvoice` with `{ buffer }` input. Wrong-shape file for a slot (header not found) → friendly err naming what was expected. Pure parse helpers (`fingerprintBytes`, slot dispatch on parsed result) factored so Vitest covers them without DOM `File`.

`closeStore.tsx` — React context + `useClose()` hook:

- State: `files: Partial<Record<SlotKey, {loaded, payload}>>`, `demo: boolean`, derived `model: CloseModel | null` (memo: needs pricing+usage; invoice optional), `review: ReviewState`, `setReview`.
- `ReviewState = Record<string /*partner slug*/, { status: "approved" | "needs_review"; note: string }>`; persisted to `localStorage` key `coro-close-review:${period}:${pricingFp.slice(0,12)}:${usageFp.slice(0,12)}`; loaded on model change; storage failures swallowed (private mode).
- `loadDemo()` builds `buildRateCardDemo()` payloads and sets `demo: true`; dropping any real file clears demo.

- [ ] Steps: failing tests for fingerprint hex + slot dispatch + review-key shape → implement → green → commit: `feat(web): in-browser file ingestion and close store`

### Task 9: App shell + Intake screen

**Files:** Rewrite `web/src/App.tsx`; Create `web/src/screens/Intake.tsx`; Delete old `web/src/screens/{Overview,Invoices,Reconcile,Exceptions}.tsx` **at the end of Task 12** (they keep compiling until replacements land); Modify `web/src/main.tsx` (wrap in `CloseProvider`)

- [ ] Shell: same left-rail idiom as the current App.tsx (keep the visual language: `bg-card/40` rail, lucide icons) with sections Intake / Overview / Rate Cards / Reconcile / Invoices / Exceptions; Exceptions badge = model findings count; Invoices badge = partners not yet approved. Header shows period + three file chips (name + fingerprint prefix, green when loaded). SYNTHETIC banner renders ONLY when `demo`. Screens receive `model` via `useClose()`; sections other than Intake render an empty-state ("Drop the month's files first") when `model` is null.
- [ ] Intake: three drop targets (also `<input type="file">` for Playwright/accessibility), per-slot parse report (rows, partners, warnings list), demo button, "what to drop" copy naming the real file names. Drag-over highlight; re-drop replaces.
- [ ] Verify: `pnpm --dir web dev` renders; demo mode walks all six nav entries without console errors. Commit: `feat(web): six-screen shell + intake with drag-drop and demo mode`

### Task 10: Overview + Rate Cards screens

**Files:** Create `web/src/screens/Overview.tsx`, `web/src/screens/RateCards.tsx`

- [ ] Overview: KPI cards (Total billed L, Cost — expected additive + actual when invoice loaded, Margin $ + %, Partners joined x/y, Findings by severity); horizontal margin-by-MSP bar (pure divs, no chart lib — existing repo has none); "cost rule" callout card explaining sheet-vs-additive with the month's aggregate delta. All from `CloseModel`; zero computation in the screen beyond formatting (`web/src/lib/format.ts` helpers exist).
- [ ] Rate Cards: search box (name/slug); card per `PricingPartner` — workspace chip, contact line, per-product table List → E → stated H → additive H → margin %, finding badges inline on affected rows (SHEET_MATH_INCONSISTENT etc.), "standard tier" badge when every row's F=20/G=25 pattern matches, card-only partners dimmed with "no usage this month".
- [ ] Verify in demo + real files; commit: `feat(web): overview and rate-card screens`

### Task 11: Reconcile + Exceptions screens

**Files:** Create `web/src/screens/Reconcile.tsx`, `web/src/screens/Exceptions.tsx`

- [ ] Reconcile: three-way match table, one row per partner slug: card ✓/—, usage ✓/—, invoice ✓/— (with names as each source spells them); expandable per-product rows showing usage qty (+ metric provenance from audit rule), invoice qty, delta highlighted. Sections beneath: usage-only slugs, card-only partners.
- [ ] Exceptions: model findings grouped by severity (block/warn/info), each row: kind chip, partner, sku, message, and a "view" link that switches to the relevant section (callback prop from App).
- [ ] Verify; commit: `feat(web): reconcile and exceptions screens`

### Task 12: Invoices screen — drafts, review, print

**Files:** Create `web/src/screens/Invoices.tsx`; Modify `web/src/index.css` (print styles); Delete the four old screen files; update any residual imports

- [ ] List: one card per `PartnerDraft` — total L, margin, held-line count, review status pill; click → detail.
- [ ] Detail: invoice document layout (MSP Hub header block, partner name + contact/address from the CSV, period, line table: product label, qty + metric badge, unit L, amount L, cost basis + margin per line with basis badge, anomaly badges from line findings; customer breakdown expandable under each line; totals footer). Held lines rendered prominently amber with the reason.
- [ ] Review controls: Approve / Needs review buttons + note textarea → `setReview`; status visible in list and in nav badge.
- [ ] Print: `@media print` — hide rail/header/controls, show only the open invoice detail (`.print-invoice` region), letter-size margins; "Print / PDF" button calls `window.print()`.
- [ ] Old screens deleted; `pnpm --dir web build` clean; commit: `feat(web): per-MSP draft invoices with approve/flag review and print layout`

### Task 13: Exports — Excel workbook, QuickBooks, downloads

**Files:** Create `web/src/lib/exportWorkbook.ts`, `web/src/lib/download.ts`; Modify `web/src/screens/Invoices.tsx` (export buttons); Test `tests/web/exportWorkbook.test.ts`

- [ ] `download.ts`: `downloadBlob(name, mime, bytes|string)` via object URL; trivial.
- [ ] `exportWorkbook.ts`: `buildCloseWorkbook(model, review): XLSX.WorkBook` — tabs: `Summary` (per-partner L/H/margin/status), one tab per partner (invoice lines incl. customer breakdown, H/L/margin columns mirroring Lindita's shape), `Exceptions`, `Review` (slug, status, note, fingerprints). Pure WorkBook builder = Node-testable (assert tab names, cell values for the demo model); browser button wraps with `XLSX.write(..., {type:"array"})` → download.
- [ ] QuickBooks: buttons call existing `toQuickBooksCsv`/`toIif` over `buildInvoices(model.ratedLines)` filtered to approved partners; unapproved present → confirm dialog listing them with "include drafts anyway".
- [ ] Print button already in Task 12. Tests green; commit: `feat(web): Excel close workbook + approval-gated QuickBooks exports`

### Task 14: Verify end-to-end, document, ship

**Files:** Modify `README.md`; no code beyond fixes

- [ ] `pnpm vitest run` — everything green (expect ~210+).
- [ ] `pnpm --dir web build` then serve `web/dist` (`npx serve` or vite preview); Playwright MCP: load page → demo walk (six screens, approve one invoice, export CSV) → then real-file walk (set the three real files via the file inputs, screenshot each screen, verify Seven Star Complete shows 6.40/6.08/5.55 and Amplivity MODNETWflex prices from Network Flex $3.00).
- [ ] Fix anything found (each fix its own commit).
- [ ] README: new "Rate-card close (Sep 2026)" section — the two transcripts, column E semantics, MOD* rule, both cost rules, web workflow (drop files → review → export), demo mode note.
- [ ] Final commit: `docs: rate-card close story + web runbook`

---

## Self-review notes

- Spec coverage: intake/screens (T8–T12), money semantics + both H rules (T5), MOD* mapping incl. specific-flex precedence + Modsatflex + ADD* assumed (T4), audit-qty authority (already landed; T1 exposes slug), validations incl. Danny's list-price check (T3), review persistence keyed period+fingerprint (T8), all three exports (T12–T13), demo mode (T7/T9), real-data verification (T6, T14). Hosting hardening explicitly out of scope per spec.
- Numbers pinned here were computed from the real files this session; T6 re-derives and pins from the packet itself, so a bad transcription in this plan fails loudly, not silently.
- Type names used across tasks are consistent: `PricingRow/PricingPartner/SpecialPricingResult` (T3) consumed by T4/T5; `MatchKind` (T4) consumed by T5's `DraftLine`; `CloseModel` (T5) consumed by T8–T13.
