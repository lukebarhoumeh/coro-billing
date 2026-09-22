# Coro Answers Adoption — Design Spec

**Date:** 2026-09-22
**Trigger:** Coro's email reply to `docs/CORO_CLARIFICATIONS_2026-09-21.md` + new files in
`C:\Users\lukeb\OneDrive\Desktop\CoroBillingFolder` (updated Special Pricing CSV, re-exported
August usage, signed distributor agreement PDF).
**Deployment rule for this round:** LOCAL ONLY. Lita is mid-test on https://coro-billing.vercel.app.
No `git push`, no `vercel` deploy until she signs off. Everything lands as local commits on `main`.

---

## 1. What Coro answered (and what each answer means for the engine)

| # | Coro's answer | Engine consequence |
| --- | --- | --- |
| 1a | Net-Tech Email Protection rate "has been added" | New sheet row **"BUEmail Flex"** (list $7.50, F 60%, E $3.00, G 5%, H $2.63, I 65%). Name not in `buemailflex` chain → add alias. Unholds 100 units → +$300.00 L. |
| 1b | Cyber Construction Managed Coro Classic "has been added" | New sheet row **"Managed Coro Classic"** (list $16.99, F 40%, E $10.20, G 5%, H $9.35, I 45%). Name not in `bucoclassmnflex` chain → add alias. Unholds 10 units → +$102.00 L. |
| 2 | **(c)** Partner discounts DO apply to legacy flex, **except Coro Classic & Managed Classic: 40% partner / 45% MSP Hub regardless**. Coro "had been crediting/working to credit MSP Hub". | The additive rule (`expectedHAdditive`) is confirmed canonical. Add a **Classic-family forced-cost rule** (list × 0.55 for `BUCOCLASSflex`/`BUCOCLASSMNflex` regardless of card F/G). Legacy lines where Coro's actual > additive become **CREDIT_EXPECTED** findings with quantified amounts (**$891.29 over 9 August lines** — see §4). |
| 3-H | Col H "meant to represent MSP Hub's expected cost of license… possible $0.01 rounding. Can you share the inconsistencies?" | H is **bimodal** in the new sheet: 276/297 rows = E×0.95, 17 = additive (all rows Coro re-derived this revision), 3 = neither, 1 blank. Under Coro's own stated model, **279 rows carry a wrong H** (deltas +$0.10…+$3.15 — not rounding). Deliverable: machine-readable discrepancy list (§6). Engine keeps carrying H as written; additive stays the canonical cost. |
| 3-I | I should = F+G, G = 45−F floored at 5% when F>40 | Exactly our additive rule. Seven Star + DK Systems I-errors **fixed in the new sheet**. Remaining violations (Rex Black ×3 impossible rows; Auditlytics/Copperband G=9) go in the reply doc. |
| 3-MDR | ADD\* (MDR, Secured Web Gateway) "Confirmed. These are modules." | `assumed-add` match kind → confirmed **`add-module`**; ASSUMED_MAPPING finding retired. |
| 3-XTB | Stray "XTB" row "Omitted" | Confirmed removed in new sheet. EMPTY_PARTNER_BLOCK finding count 1 → 0. |
| 4 (Rocker credit, Ideal 371) | "Quick call" | No engine change. Call-agenda doc (§6). |
| 5 (usage formats, audit rule) | "Quick call" | No engine change. **New fact for the call:** the Sep-22 usage re-export's Quantity column is the old file's values **sorted ascending** (289 cells scrambled) — second broken re-export in a row. We keep the archived richer file canonical; Audit strings (identical in both) remain the quantity source. |
| 5-NFR | "Confirmed - NFR is Not for resale" | Reason text gains "confirmed by Coro 2026-09-22". No behavior change. |

**Distributor agreement (new to us, signed 7/14/2026):** the only discount language is Exhibit A —
45% off PRM list for sales through MSPs (35% direct), and "Distributor shall not be entitled to any
other discounts". The +5% minimum additional discount exists only in the Compass program / Coro's
email, **not the contract** — flagged for Lisa in the call agenda, not an engine change. No legacy,
NFR, or credit-memo language anywhere in the contract. Usage is "measured and reported by Coro".
Net 30. MSRP workbook: byte-identical to archived.

## 2. Hazards found in the NEW sheet (Coro's email didn't mention these)

Probed by running the engine as-is against the new CSV (read-only, `coro_probe.mts`):

1. **Cyber Construction label swap.** Old "Coro Classic Flex" (list $11.99, E $7.20) is now *named*
   "Modules Flex"; the true modules rate (list $7.50, E $3.00) moved to a new "Coro Module Flex" row.
   As-is this (a) HOLDS `BUCOCLASSflex` qty 41 (−$295.20 L that was previously billable) and
   (b) misprices all 7 CC MOD/ADD lines at E $7.20 instead of $3.00.
   CC is the **only** partner with both generic-modules names on one card (verified).
2. **Amplivity "Network Flex" renamed to "Modules Flex"** — the `modnetwflex` product-specific chain
   dangles; resolution falls through to generic modules at the same $3.00 (matchKind changes
   `specific-flex` → `modules-flex`; pinned test updates).
3. **1Wire "Email Protection Flex" renamed "BUEmail Flex"** — same alias fix as Net-Tech covers it
   (1Wire has no August BUEMAILflex usage; no dollar impact now).
4. **Live-Tech "Coro AI Modules" H $5.63** matches neither rule (likely typo for $5.70); its old
   discounted 74/5/79 rate survives on its "Modules Flex" row. Live-Tech has no August usage — reply-doc item only.
5. **Rex Black** new rows copy pre-existing broken math (F+G=101% vs I=45%). Card-only partner — reply-doc item.
6. **TechLead's "Managed Classic Flex" card row is 50/5** — contradicts answer (c)'s 40/45 rule
   (partner price should be $10.19, card says E $8.50 < the $9.34 cost → still upside-down even
   after credits). Surface as a finding + Danny item; we keep billing col E as written.

## 3. Design decisions

### D1 — Data adoption
- New CSV becomes canonical `data/2026-08/Coro Special MSP Pricing(Special Pricing).csv`;
  old file kept as `…(Special Pricing).superseded-2026-09-21.csv`. `data/README.md` updated.
- New usage re-export **NOT adopted** (corrupt sorted Quantity column). A copy is archived as
  `MSP Hub_August 2026 Usage.reexport-2026-09-22.corrupt.xlsx` for evidence.
- Agreement PDF copied to `data/agreement/`. OneDrive folder untouched.

### D2 — productMap (curated bridge, all changes code-reviewed)
- `buemailflex` chain += `"buemail flex"`; `bucoclassmnflex` chain += `"managed coro classic"`.
- `GENERIC_MODULES` reordered to `["coro module flex", "modules flex"]` — safe because only CC has
  both names, and on CC "Coro Module Flex" is the true modules row.
- **Signature-guarded mislabel override** for CC: `bucoclassflex` may resolve to a row *named*
  "Modules Flex" **only when** that row's list price is exactly the Classic list **$11.99** — match
  kind `mislabel-override`, emitting a `SHEET_MISLABEL_OVERRIDE` (warn) finding naming the swap.
  Self-disabling: when Coro fixes the labels, the guard no longer matches and normal resolution resumes.
- `add*` codes: kind `assumed-add` → **`add-module`**, reason "…(confirmed by Coro 2026-09-22)";
  no finding emitted. ASSUMED_MAPPING retired from the close (kind stays in the union for old data).

### D3 — rateCardClose
- **Classic forced cost:** for `bucoclassflex`/`bucoclassmnflex`, `expectedHAdditive` =
  `listPrice × 0.55` (Coro answer (c): 45% to MSP Hub regardless), independent of card F/G. When the
  card's F+G ≠ 45, emit `CLASSIC_RATE_RULE_DISAGREES` (info) so sheet drift stays visible.
  (With card F/G at 40/5 the number is identical to the general rule — most Classic rows already comply.)
- **CREDIT_EXPECTED (warn):** on legacy lines (`classifyInvoiceSku === "legacy"`) where
  `actualHUnit − expectedHAdditive > 1¢`: per-line `creditExpected = actualHAmount − expectedHAdditive × invoiceQuantity`,
  message cites answer (c). Excluded automatically for Classic lines (forced cost ≈ actual).
  Non-legacy or under-billed deviations stay `INVOICE_RATE_UNEXPECTED` (e.g. all the MOD\* lines
  Coro bills at $2.20 vs sheet-additive $2.62 — open call question: does legacy MOD pricing use the
  $4.00 legacy modules list or the sheet's $7.50 row?).
- **Margin basis unchanged** (actual invoice cost = cash truth; the 4 negative partners stay pinned).
  Credits are additive context: `DraftLine.creditExpected: Money | null`,
  `PartnerDraft.totalCreditExpected: Money`, `CloseModel.totalCreditExpected: Money`.
- specialPricing parser checks unchanged (H vs E×0.95 and I vs F+G stay `SHEET_MATH_INCONSISTENT` info).

### D4 — Web (imports the engine; copy + surfacing only)
- Overview: credits strip/KPI ("Credits expected from Coro"), delta-card labels reworded to
  "canonical additive vs sheet H (reference)". HelpDialog glossary: new finding kinds + the
  confirmed cost model + Classic exception. Reconcile: per-line credit badge. Margins: credit line
  in the GP bridge ("margin after expected credits"). Exceptions screen: new kinds render via the
  existing generic list (verify labels). Invoice doc (customer-facing): **no credit mention** — Coro-side only.
- Excel close workbook: `Credit Expected` column + total.

### D5 — Tests (numbers predicted by probe, verified line-by-line at re-pin time)
- New unit tests: productMap aliases/reorder/override-guard; Classic forced cost; CREDIT_EXPECTED emission.
- Re-pin `tests/e2e.rateCardClose.real.test.ts`: L **$13,778.40** (= old 13,376.40 + 300.00 + 102.00),
  actual H back to **$12,492.38**, held **[]**, UNKNOWN_PRODUCT_CODE 0, ASSUMED_MAPPING 0,
  EMPTY_PARTNER_BLOCK 0, +LIST_PRICE_DIVERGES 1 (CC $11.99 "Modules Flex" vs $7.50 elsewhere),
  +SHEET_MISLABEL_OVERRIDE 1, +CREDIT_EXPECTED 9, +CLASSIC_RATE_RULE_DISAGREES (TechLead ≥1),
  INVOICE_RATE_UNEXPECTED 24 → ~14 (the credit lines split out), CLIENT_PRICE_DIFFERS 33 → ~35
  (+Net-Tech email $3.00 vs team $4.12; +CC classmn $10.20 vs $9.35), negative partners unchanged,
  `totalCreditExpected` **$891.29**, totalHExpected recomputed (TechLead classmn forced 45 moves it),
  ratedLines 149 + new customer shares (measure). `e2e.techleadJuly.real.test.ts`: L-side pins
  ($3,555.00, unit rates) should hold — TechLead's rows are byte-identical; only cost-side
  expectations shift (verify; July has no Coro invoice loaded so CREDIT_EXPECTED can't fire there).
- Old-sheet parse fixtures unaffected (fixtures are synthetic).

### Non-goals this round
- No flat-45 repricing of partner sell prices (col E is read-never-derived; Danny owns sell-price calls).
- No July (invoice 1914) credit computation in-engine — noted in the call agenda instead.
- No demo-fixture credit examples; demo mode unchanged.
- No deploy, no push, no packet baking, no QBO work (still blocked on Intuit app).

## 4. Expected credit detail (August, invoice 2193, per answer (c))

Gross legacy over-bill $908.19 over 10 lines minus TechLead `BUCOCLASSMNflex` $16.90 (Classic
exception — Coro's $9.34 is the agreed cost): **$891.29 / 9 lines**:
Evolve BUCOMflex $27.00, Evolve BUCOMMNGflex $68.00, TechLead BUCOMMNGflex $680.00,
TechLead BUCOROflex $15.00, Teledata BUCOROflex $2.96, Teledata BUENDflex $21.92,
XTB BUCOMflex $37.50, XTB BUCOROflex $29.25, XTB BUENDflex $9.66.

## 5. Why margins stay actual-basis

Coro says credits are being worked; until a credit memo exists, cash truth is the invoice. The four
negative partners (TechLead −$359.70, Evolve −$67.70, XTB −$37.76, Teledata −$3.50) remain the
honest August picture; the UI shows "after expected credits" alongside. Post-credit, TechLead's
`BUCOMMNGflex` flips positive (+$1.00/unit) but his Managed Classic line stays negative
(E $8.50 < forced cost $9.34) until Danny reprices — that's a business decision, not ours.

## 6. Deliverables for Luke to send / bring to the call

- `docs/CORO_REPLY_2026-09-22.md` — everything Coro asked us to share: the column-H analysis +
  the new-sheet issues (§2), the credit quantification (§4), usage re-export corruption.
- `out/coro-reply/column-h-discrepancies.csv` — full 279-row machine-readable H list.
- Call agenda (in the reply doc): Rocker July double-bill credit ($153.31), Ideal Tech 371 seats,
  canonical usage format + stated-quantity rule + two corrupt re-exports, Avox naming (proposal:
  keep "Avox" + add a workspace-ID column to invoice detail), legacy MOD\* list-price question,
  credit timing/mechanics (no credit-memo process in the contract), Compass-vs-contract 5% note for Lisa.
