# August 2026 close — invoice-driven design

The real August packet landed 2026-09-15 (SharePoint drop → `data/2026-08/`). Inspecting it
changed the close design in one fundamental way:

> **Invoice INVCUS2026-0002193 is both the pricing authority and the reconciliation target.**
> Someone at Hub already keyed the Coro PDF into an H/L matrix (`Invoice Detail` tab):
> `Rate`/`Subtotal` = H (our Coro cost), `Client Price`/`charge` = L (what we bill the MSP),
> margin precomputed, footing to the invoice total **$13,151.64**. It IS the "Lindita
> recreation target" — no separate Lindita workbook exists for August.

Usage's job is therefore NOT to recreate the bill from scratch; it is to
**break each invoice line down by customer** (Dane's Amplivity requirement) and to
**flag where consumption disagrees with what Coro billed**.

## What the real files taught us (facts, verified by inspection)

1. **`Rate` is display-rounded; `Subtotal` is computed on the unrounded rate.** The invoice
   says so verbatim (note under the table). E.g. XTB BUENDflex: 7 × 4.13 = 28.91 ≠ 28.88
   (the billed Subtotal). ⇒ **`Subtotal` is the authoritative H total; never recompute
   `Rate × Qty` as money.** Unit H is `Subtotal ÷ Qty` and is display-only.
2. **`Client Price × Quantity = charge` exactly** on every line. ⇒ L unit is exact cents.
3. **Every 2193 line carries a Client Price** (in-sheet totals: "Cost with NO Client Price
   (on hold): $0"). The blank-L "held" path is still implemented — it protects future months.
   The Summary-by-Product "Legacy Flex - no client price" statuses are stale relative to the
   detail tab (prices were carried over from the July workbook).
4. **Two Rocker lines on 2193 are July service** ("Jul period billed again - already on
   INV-0001914"). They are **out-of-period**: excluded from the August allocation, surfaced
   loudly, and included when tying to the $13,151.64 grand total.
5. **Usage is a two-rows-per-SKU metric model** (`Metric` = Users | Devices), with the billed
   quantity derivable per the row's own `Audit` string, e.g.
   `CORO_ESSENTIALS=14 [math.max(users, devices)]`, `CORO_COMPLETE=2 [users]`,
   `NETWORK=11 [devices]`. The audit-stated number IS Coro's billed figure — we use it as
   primary and cross-check our own users/devices reduction against it.
6. **Usage partner IDs are workspace slugs** (`amplivitycom_NE7N_b`); the invoice uses clean
   names (`Amplivity`). A curated slug→name map is required (automatic matching fails for
   `techlpcom`→Techlead, `evolvewithuscom`→Evolve, `itnsgroupcom`→IT Network…).
7. **Usage ≠ invoice, and that's a finding, not a bug.** Best-rule reduction ties only
   37/51 partner×SKU lines to the invoice quantity. Two usage parents (`hurricane-itcom`,
   `vaimancom`) have **no invoice line at all** (consumed but unbilled). The invoice also
   bills lines with **no usage detail** (e.g. IT Network COR-ESS-C). All surfaced.
8. **The per-partner special pricing did NOT arrive** — only a `.url` shortcut to
   `Coro Special MSP Pricing.xlsx` on Jack Rauch's SharePoint. Not blocking for August
   (2193 carries L), still wanted for future months / rate validation.

## Decisions (D1–D8)

| # | Decision | Why |
| --- | --- | --- |
| D1 | Bill from the invoice, allocate by usage. Per (partner, SKU): qty and H total come from 2193; customers get integer qty shares via **largest-remainder allocation** weighted by usage billed qty; H cents allocated the same way, so per-line cents **sum exactly** to the invoice Subtotal. | Hub pays Coro per the invoice; the customer split must sum to what the MSP is actually billed. Largest remainder keeps every partner×SKU cent-exact. |
| D2 | L amount per customer line = `Client Price × allocated qty` (exact). Blank L ⇒ line HELD (`MISSING_MSP_PRICE`, block) — never fabricated. | Rule "never invent a rate". L unit is exact per fact 2. |
| D3 | Usage qty ≠ invoice qty ⇒ `USAGE_QTY_DISAGREES` (warn, still billable). No usage detail ⇒ one partner-level line, `NO_USAGE_BREAKDOWN` (info). Usage with no invoice line ⇒ `USAGE_NOT_ON_INVOICE` (warn) + report; **not billed** (Coro didn't bill us — billing the MSP would invent revenue). | The invoice is authoritative for money; disagreements are accounting findings to take back to Coro. |
| D4 | Out-of-period invoice lines (`Start Date` month ≠ close month) excluded from allocation, surfaced as `OUT_OF_PERIOD_LINE` (warn), and included in the grand-total tie. | Fact 4; months never masquerade (existing non-negotiable). |
| D5 | SKU class: `…flex` ⇒ legacy, else current; cross-checked against usage `Billing Mode` (LEGACY/NEW) where present. | Holds for the entire August dataset (MSRP "Legacy SKUs" tab + Summary-by-Product statuses agree). |
| D6 | Partner slug map is **code** (`src/config/partners.ts`), curated per fact 6; unmapped slugs flagged `UNMAPPED_PARTNER` (warn), never guessed. | 16 entries, reviewable in git; data/ stays vendor-pristine (and is git-ignored). |
| D7 | The close emits standard `RatedLine[]` (rate.source = the invoice number), so `buildInvoices` → QuickBooks CSV/IIF export is reused unchanged. | Reuse the whole tested downstream. |
| D8 | The old usage→rate-card→Lindita path stays intact (synthetic tests keep passing); the invoice-driven close is a new parallel path + new CLI `close` command. | The rate-card path becomes the H/L *validation* path when Jack's pricing file lands. |

## Acceptance gates for the August close

- Allocated H (in-period) + out-of-period H **= $13,151.64** (2193 Total Before Tax), cent-exact.
- Every in-period partner×SKU allocated H total = that line's `Subtotal`, cent-exact (by construction; verified anyway — construction bugs must fail loudly).
- L totals = `charge` column wherever the sheet's own `Client Price × Quantity` math ties.
- Every usage parent slug maps (August: 16/16, of which 2 legitimately have no invoice lines).
- Negative-margin lines reported (real ones exist: Teledata BUENDflex, Net-Tech BUEMAILflex).

## New modules

- `src/config/partners.ts` — curated slug→name map + normalizer.
- `src/ingest/usageReduce.ts` — Users/Devices → billed qty per Audit rule (audit-stated qty primary, reduction cross-check).
- `src/lib/allocate.ts` — largest-remainder integer/cents allocation.
- `src/close/invoiceClose.ts` — the invoice-driven close (allocation + report).
- CLI `close` command; `tests/e2e.real.test.ts` (auto-skipped when `data/2026-08/` absent).
