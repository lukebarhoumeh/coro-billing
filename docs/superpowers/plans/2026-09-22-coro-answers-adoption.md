# Coro Answers Adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt Coro's 2026-09-22 email answers + corrected Special Pricing sheet into the close engine: unhold the two missing-rate lines, canonize the additive cost rule with the Classic-family exception, quantify expected credits ($891.29), and produce the reply deliverables — all as LOCAL commits (no push, no deploy — Lita is mid-test on prod).

**Architecture:** Data adoption first (new CSV canonical, corrupt usage re-export rejected), then the curated productMap bridge (aliases, generic-modules reorder, signature-guarded mislabel override), then two close-engine rules (Classic forced cost; CREDIT_EXPECTED), then re-pin the real-packet e2e against probed ground truth, then web surfacing + deliverable docs.

**Tech Stack:** TypeScript/ESM, vitest, decimal.js Money, xlsx; web = Vite/React importing the engine from `../src`.

**Spec:** `docs/superpowers/specs/2026-09-22-coro-answers-adoption.md` (read it first — §2 hazards and §3 decisions drive every task).

**Ground truth probe:** `C:\Users\lukeb\AppData\Local\Temp\coro_probe.mts` (read-only; run with `npx tsx <path>` from repo root). OLD-sheet output must keep matching current pins; NEW-sheet output after each engine task converges toward the §D5 targets.

---

### Task 1: Data adoption

**Files:**
- Rename: `data/2026-08/Coro Special MSP Pricing(Special Pricing).csv` → `data/2026-08/Coro Special MSP Pricing(Special Pricing).superseded-2026-09-21.csv`
- Create: `data/2026-08/Coro Special MSP Pricing(Special Pricing).csv` (copy of the new file)
- Create: `data/2026-08/MSP Hub_August 2026 Usage.reexport-2026-09-22.corrupt.xlsx` (evidence copy)
- Create: `data/agreement/MSP Hub - Coro Hybrid Distributor Agreement (2 tier) V2.pdf` (copy)
- Modify: `data/README.md` (provenance notes)

- [ ] **Step 1: Move + copy files** (data/ is gitignored; only README.md is tracked)

```powershell
Set-Location C:\Users\lukeb\coro-billing
Rename-Item "data\2026-08\Coro Special MSP Pricing(Special Pricing).csv" "Coro Special MSP Pricing(Special Pricing).superseded-2026-09-21.csv"
Copy-Item "C:\Users\lukeb\OneDrive\Desktop\CoroBillingFolder\Coro Special MSP Pricing(Special Pricing) (1).csv" "data\2026-08\Coro Special MSP Pricing(Special Pricing).csv"
Copy-Item "C:\Users\lukeb\OneDrive\Desktop\CoroBillingFolder\MSP Hub_August 2026 Usage.xlsx" "data\2026-08\MSP Hub_August 2026 Usage.reexport-2026-09-22.corrupt.xlsx"
Copy-Item "C:\Users\lukeb\OneDrive\Desktop\CoroBillingFolder\MSP Hub - Coro Hybrid Distributor Agreement (2 tier) V2 after cmnts.docx.pdf" "data\agreement\MSP Hub - Coro Hybrid Distributor Agreement (2 tier) V2.pdf"
```

- [ ] **Step 2: README provenance** — add a "2026-09-22 revision" section to `data/README.md`: new CSV canonical (Coro email answers; adds Net-Tech BUEmail Flex, CC Managed Coro Classic, ForceTech/Rex Black rows; fixes Seven Star/DK I-column; removes stray XTB; **CC Modules/Classic label swap hazard**), old CSV superseded suffix, usage re-export rejected (Quantity column = old values sorted ascending — Audit strings identical; archived `.corrupt.xlsx`), agreement PDF filed.

- [ ] **Step 3: Verify tests now FAIL in the expected shape** (real e2e reads the canonical CSV path):
Run: `pnpm test 2>&1 | tail -20` — expect `e2e.rateCardClose.real.test.ts` failures (held list gains `Cyber Construction|BUCOCLASSflex`, totals move) and **everything else green**. This failure set is the Task-2..5 worklist; do NOT re-pin yet.

- [ ] **Step 4: Commit** — `git add data/README.md docs/superpowers/specs/2026-09-22-coro-answers-adoption.md docs/superpowers/plans/2026-09-22-coro-answers-adoption.md` → `docs+data: adopt Coro 2026-09-22 sheet revision (spec+plan+provenance)`

### Task 2: productMap — aliases, reorder, mislabel override, ADD\* confirmed

**Files:**
- Modify: `src/domain/types.ts` (MatchKind union ~:379-385)
- Modify: `src/config/productMap.ts`
- Modify: `src/close/rateCardClose.ts:219-222` (drop ASSUMED_MAPPING emission)
- Test: `tests/config/productMap.test.ts`

- [ ] **Step 1: Failing tests.** In `tests/config/productMap.test.ts` add (build synthetic `PricingPartner`s with the existing test helpers in that file — follow its `partner(...)` fixture idiom):
  - `buemailflex` resolves a row named `"BUEmail Flex"` (kind `"exact"`).
  - `bucoclassmnflex` resolves `"Managed Coro Classic"` (kind `"exact"`).
  - Generic modules preference: partner with BOTH `"Modules Flex"` (list 11.99) and `"Coro Module Flex"` (list 7.50) → `modcloudflex` resolves **"Coro Module Flex"**.
  - Mislabel override: same both-rows partner → `bucoclassflex` resolves the `"Modules Flex"` row, kind `"mislabel-override"`; a partner whose `"Modules Flex"` has list 7.50 (no 11.99 signature) → `bucoclassflex` behaves as before (chain miss → `none` when no classic rows).
  - `addmdrflex` on a modules-flex partner → kind `"add-module"`, reason contains `confirmed by Coro 2026-09-22`; update the existing `:167` expectation off `"assumed-add"`.
- [ ] **Step 2: Run** `npx vitest run tests/config/productMap.test.ts` — new tests FAIL (unknown kinds / wrong rows).
- [ ] **Step 3: Implement.**
  - types.ts MatchKind: replace the `"assumed-add"` member with:
    ```ts
    | "add-module" // ADD*flex priced via the modules chain — confirmed by Coro 2026-09-22
    | "mislabel-override" // row matched via a curated sheet-mislabel signature (see productMap)
    ```
  - productMap.ts: `buemailflex` flex list += `"buemail flex"`; `bucoclassmnflex` flex list += `"managed coro classic"`; `GENERIC_MODULES = ["coro module flex", "modules flex"]`; ADD\* branch returns kind `"add-module"`, reason `` `${vendorSku} = Modules Flex (confirmed by Coro 2026-09-22) → "${m.row!.product}"` ``; `resolveModulesChain` genericKind param type follows. Mislabel override, placed at the TOP of the `LEGACY_BUNDLES` branch:
    ```ts
    /** 2026-09-22 sheet mislabel (Cyber Construction): the row NAMED "Modules Flex"
     *  carrying the Classic list price IS Coro Classic Flex; the true modules rate
     *  lives on "Coro Module Flex". Signature-guarded (exact $11.99 list) so a
     *  corrected sheet disables this automatically. */
    const CLASSIC_MISLABEL = { code: "bucoclassflex", rowName: "modules flex", listCents: 1199 } as const;
    ```
    and inside `resolvePricingRow` for the legacy branch, before the flex-chain lookup:
    ```ts
    if (code === CLASSIC_MISLABEL.code) {
      const mislabeled = partner.rows.find(
        (r) => normalizeProduct(r.product) === CLASSIC_MISLABEL.rowName &&
          r.listPrice !== null && r.listPrice.toCents() === CLASSIC_MISLABEL.listCents
      );
      if (mislabeled && findRow(partner, legacy.flex) === null) {
        return {
          row: mislabeled,
          kind: "mislabel-override",
          reason: `${vendorSku} → "${mislabeled.product}" via the 2026-09-22 sheet-mislabel signature ` +
            `(list $11.99 = Coro Classic Flex; ask Coro to fix the label)`,
        };
      }
    }
    ```
  - rateCardClose.ts: replace the `assumed-add` finding branch with a `mislabel-override` branch emitting `SHEET_MISLABEL_OVERRIDE` (warn) — kind added in Task 3 Step 3 types edit; do the types edit here if running this task independently: add `| "SHEET_MISLABEL_OVERRIDE"` to ExceptionKind with a comment. `add-module` emits nothing.
- [ ] **Step 4: Run** `npx vitest run tests/config/productMap.test.ts tests/close` — PASS. `pnpm typecheck` — clean (this catches every exhaustive-match on MatchKind, including `web/` via its own tsconfig at web build time; run `pnpm --dir web build` if typecheck misses web).
- [ ] **Step 5: Commit** — `feat(productMap): Coro 2026-09-22 rows — BUEmail/Managed Coro Classic aliases, modules reorder, CC mislabel override, ADD* confirmed`

### Task 3: Close — Classic-family forced cost

**Files:**
- Modify: `src/domain/types.ts` (ExceptionKind union ~:197-230)
- Modify: `src/close/rateCardClose.ts:239-245`
- Test: `tests/close/rateCardClose.test.ts` (follow its synthetic-fixture idiom)

- [ ] **Step 1: Failing test.** Synthetic partner with a `"Managed Classic Flex"` row (list 16.99, F 50, G 5, E 8.50) + usage line `BUCOCLASSMNflex` qty 10 → expect `expectedHAdditive` **9.34** (16.99×0.55, NOT 7.65) and one `CLASSIC_RATE_RULE_DISAGREES` info finding; a 40/5 Classic row emits none.
- [ ] **Step 2:** `npx vitest run tests/close/rateCardClose.test.ts` — FAIL.
- [ ] **Step 3: Implement.** types.ts ExceptionKind add:
  ```ts
  | "CLASSIC_RATE_RULE_DISAGREES" // card F/G on a Classic-family row ≠ the confirmed 40/5 (Coro 2026-09-22 answer c)
  | "SHEET_MISLABEL_OVERRIDE" // line priced via a curated sheet-mislabel signature — sheet needs fixing
  | "CREDIT_EXPECTED" // Coro invoiced above the confirmed additive cost on a legacy line — credit due (answer c)
  ```
  rateCardClose.ts — after the current `expectedHAdditive` computation:
  ```ts
  /** Coro 2026-09-22 answer (c): Coro Classic & Managed Classic are 45% to MSP Hub
   *  regardless of the card's partner-specific F/G. Forced here so cost, credits and
   *  the invoice cross-check all agree with the confirmed rule; card drift surfaces
   *  as a finding instead of skewing cost. */
  const CLASSIC_FLAT: ReadonlySet<string> = new Set(["bucoclassflex", "bucoclassmnflex"]);
  ```
  (module scope) and in the line loop:
  ```ts
  let expectedHAdditive = /* existing expression */;
  if (billable && CLASSIC_FLAT.has(g.vendorSku.trim().toLowerCase()) && row?.listPrice != null) {
    const forced = row.listPrice.applyDiscount(0.45);
    if (row.mspDiscountPct !== null && row.hubDiscountPct !== null &&
        row.mspDiscountPct + row.hubDiscountPct !== 45) {
      flist.push(exception("CLASSIC_RATE_RULE_DISAGREES", "info", card.name, g.vendorSku, period,
        `card says ${row.mspDiscountPct}%+${row.hubDiscountPct}% but Coro confirmed Classic-family ` +
          `cost is a flat 45% off list (2026-09-22 answer c) — using ${forced.toFixed2()}/unit; ` +
          `card row needs correcting`, row.sourceRow));
    }
    expectedHAdditive = forced;
  }
  ```
- [ ] **Step 4:** `npx vitest run tests/close` — PASS. **Probe check:** `npx tsx C:\Users\lukeb\AppData\Local\Temp\coro_probe.mts` — NEW-sheet TechLead `BUCOCLASSMNflex` line now shows addH=9.34 (no longer in the credit list); CC classf/classmn resolve via Task 2.
- [ ] **Step 5: Commit** — `feat(close): Classic-family forced 45% cost per Coro answer (c)`

### Task 4: Close — CREDIT_EXPECTED + model fields

**Files:**
- Modify: `src/domain/types.ts` (`DraftLine`, `PartnerDraft`, `CloseModel`)
- Modify: `src/close/rateCardClose.ts` (line build + partner totals + model)
- Test: `tests/close/rateCardClose.test.ts`

- [ ] **Step 1: Failing test.** Synthetic legacy line (e.g. `BUCOMMNGflex`, card additive $9.00) with an invoice aggregate at $11.00×10 → expect line `creditExpected` **20.00**, partner `totalCreditExpected` 20.00, model `totalCreditExpected` 20.00, one `CREDIT_EXPECTED` warn finding, and NO `INVOICE_RATE_UNEXPECTED` for that line; a current-gen line off-rate still yields `INVOICE_RATE_UNEXPECTED` and null credit; an under-billed legacy line (actual < additive, the MOD $2.20 pattern) yields `INVOICE_RATE_UNEXPECTED` and null credit.
- [ ] **Step 2:** `npx vitest run tests/close/rateCardClose.test.ts` — FAIL.
- [ ] **Step 3: Implement.** types.ts: `DraftLine.creditExpected: Money | null` (doc: "Coro billed above the confirmed additive cost on this legacy line — credit due per 2026-09-22 answer (c); actualHAmount − expectedHAdditive×invoiceQuantity"), `PartnerDraft.totalCreditExpected: Money`, `CloseModel.totalCreditExpected: Money`. rateCardClose.ts, inside the invoice-actuals block after the `INVOICE_RATE_UNEXPECTED` logic — compute first, then branch the finding:
  ```ts
  let creditExpected: Money | null = null;
  const isLegacySku = classifyInvoiceSku(g.vendorSku) === "legacy";
  if (actualHUnit !== null && expectedHAdditive !== null && isLegacySku &&
      actualHUnit.toCents() - expectedHAdditive.toCents() > UNIT_TOLERANCE_CENTS) {
    creditExpected = actualHAmount!.sub(expectedHAdditive.mul(invoiceQuantity!));
    flist.push(exception("CREDIT_EXPECTED", "warn", card.name, g.vendorSku, period,
      `Coro billed ${actualHUnit.toFixed2()}/unit but partner-specific additive cost is ` +
        `${expectedHAdditive.toFixed2()} — per Coro's 2026-09-22 answer (c) this legacy line was ` +
        `over-billed; credit expected ${creditExpected.toFixed2()}`));
  }
  ```
  and make the existing `INVOICE_RATE_UNEXPECTED` push conditional on `creditExpected === null`. Wire `creditExpected` into the pushed DraftLine; partner totals: `totalCreditExpected: sum(lines.filter((l) => l.creditExpected !== null).map((l) => l.creditExpected!))`; model: sum over partners. Keep field order/naming consistent everywhere so the determinism deep-equal stays clean.
- [ ] **Step 4:** `npx vitest run tests/close` — PASS. Probe: NEW-sheet credit list = **9 lines / $891.29** and `CREDIT_EXPECTED:9` in the histogram.
- [ ] **Step 5: Commit** — `feat(close): CREDIT_EXPECTED — quantified Coro over-bill credits on legacy lines`

### Task 5: Re-pin the real-packet e2e

**Files:**
- Modify: `tests/e2e.rateCardClose.real.test.ts`
- Verify-only: `tests/e2e.techleadJuly.real.test.ts`

- [ ] **Step 1: Measure.** Run the probe; reconcile EVERY delta against spec §D5 before touching a pin. Non-negotiable identities: `L_new = 13376.40 + 300.00 + 102.00 = 13778.40`; `HActual_new = 12492.38` (CC classf actual restored); held `[]`; negative partners unchanged; `totalCreditExpected = 891.29`. If any probe number disagrees with its identity, STOP and debug — do not pin the probe output blind.
- [ ] **Step 2: Re-pin** totals, held (now `[]` — keep the assertion, it's the headline), histogram (`toEqual` with: EMPTY_PARTNER_BLOCK gone, UNKNOWN_PRODUCT_CODE gone, ASSUMED_MAPPING gone, +LIST_PRICE_DIVERGES 1, +SHEET_MISLABEL_OVERRIDE 1, +CREDIT_EXPECTED 9, +CLASSIC_RATE_RULE_DISAGREES n, INVOICE_RATE_UNEXPECTED ~14, CLIENT_PRICE_DIFFERS ~35, SHEET_MATH_INCONSISTENT as measured), Amplivity MODNETW (`modules-flex` / `"Modules Flex"` / 3.00), ratedLines count, PLUS new assertions: Net-Tech BUEMAILflex billable (kind exact, unitL 3.00, amountL 300.00), CC BUCOCLASSMNflex (exact, 10.20), CC BUCOCLASSflex (`mislabel-override`, 7.20), `model.totalCreditExpected` 891.29, TechLead classmn line addH 9.34 + no credit. Update the header comment to tell the 2026-09-22 story (what moved and why, incl. the $891.29).
- [ ] **Step 3:** `npx vitest run tests/e2e.rateCardClose.real.test.ts tests/e2e.techleadJuly.real.test.ts` — PASS. techleadJuly should pass untouched (rows byte-identical; no invoice loaded → no credits); if a cost-side assertion trips there, verify it's the Classic forced-cost doing the right thing before editing anything.
- [ ] **Step 4:** `pnpm test` — full suite green.
- [ ] **Step 5: Commit** — `test(e2e): re-pin August close to the 2026-09-22 corrected sheet — held 0, L 13778.40, credits 891.29`

### Task 6: Web surfacing + Excel export

**Files:**
- Modify: `web/src/screens/Reconcile.tsx:20-26` (MATCH_LABEL: `"add-module": "module"`, `"mislabel-override": "mislabel fix"`; credit badge on lines with `creditExpected`)
- Modify: `web/src/screens/Exceptions.tsx:21-38` (SECTION_FOR_KIND entries for the three new kinds; ASSUMED_MAPPING entry can stay for old files)
- Modify: `web/src/screens/Overview.tsx` (credits KPI/strip: `model.totalCreditExpected` "Credits expected from Coro — 2026-09-22 answer (c)"; delta-card copy → "canonical additive vs sheet col H (reference)")
- Modify: `web/src/screens/Margins.tsx` (bridge row "margin after expected credits" = totalMargin + totalCreditExpected)
- Modify: `web/src/components/HelpDialog.tsx` (glossary: confirmed cost model, Classic exception, CREDIT_EXPECTED, mislabel override)
- Modify: `web/src/components/InvoiceDoc.tsx` — NO credit content (customer-facing); just confirm the new kinds don't leak into ANOMALY_LABELS output
- Modify: `web/src/lib/exportWorkbook.ts` (+`Credit Expected` column + footer total)
- Test: `tests/web/exportWorkbook.test.ts` (extend for the new column)

- [ ] **Step 1:** Failing exportWorkbook test (credit column present, total row foots). Run targeted vitest — FAIL → implement → PASS.
- [ ] **Step 2:** Screen edits above; keep the Midnight Ledger idiom (existing KPI/chip components, no new styles).
- [ ] **Step 3:** `pnpm --dir web build` — clean. `pnpm test` — green.
- [ ] **Step 4:** Visual sanity via Playwright MCP against `pnpm --dir web dev` with the real August files (drag-drop): Overview credits KPI, Reconcile credit badges + mislabel chip, Margins bridge, Exceptions sections, invoice doc unchanged. Screenshots to `out/walkthrough-2026-09-22/`.
- [ ] **Step 5: Commit** — `feat(web): surface confirmed cost model — credits KPI, mislabel/module chips, glossary, Excel credit column`

### Task 7: Reply deliverables

**Files:**
- Create: `scripts/columnHReport.mts` (parses the canonical CSV with `parseSpecialPricing`, writes `out/coro-reply/column-h-discrepancies.csv`: partner, product, list, F, G, I, E, H, expected `list×(1−I)`, delta, rule-H-matches: e2e95|additive|neither|blank)
- Create: `docs/CORO_REPLY_2026-09-22.md` (spec §6 content: adopted-answers summary; column-H analysis + CSV pointer; new-sheet issues incl. CC label swap, Live-Tech $5.63, Rex Black impossible rows, Auditlytics/Copperband G, Classic-row card drift incl. TechLead 50/5 + E $8.50 < $9.34 cost; usage re-export sorted-column corruption; **credit table $891.29/9 lines**; call agenda incl. Rocker $153.31, Ideal 371, usage canon, Avox proposal, legacy MOD list question, credit mechanics, Compass-vs-contract 5% note for Lisa)
- Modify: `docs/CORO_CLARIFICATIONS_2026-09-21.md` (top banner: "Answered 2026-09-22 — see CORO_REPLY_2026-09-22.md for adoption + follow-ups")

- [ ] **Step 1:** Write + run the script: `npx tsx scripts/columnHReport.mts` → verify row count (~279 discrepant + compliant rows marked) and spot-check 3 rows by hand against the CSV.
- [ ] **Step 2:** Write the reply doc; every number cross-checked against the e2e pins (held 0, credit 891.29, L 13778.40).
- [ ] **Step 3: Commit** — `docs: Coro reply 2026-09-22 — column-H report, new-sheet issues, credit quantification, call agenda`

### Task 8: Final verification (no deploy)

- [ ] **Step 1:** `pnpm test` (full), `pnpm typecheck`, `pnpm --dir web build` — all clean.
- [ ] **Step 2:** Adversarial review workflow over `git diff a2ddcf8..HEAD` (multi-agent: correctness of Money math on credits, override guard, pinned-number provenance, web copy accuracy, nothing partner-facing leaks credits).
- [ ] **Step 3:** Fix anything real it finds; re-run the suite.
- [ ] **Step 4:** Update memory file `project_coro_billing_state.md` (+MEMORY.md hook) — local-only status, awaiting-Lita note, deploy checklist for later.
- [ ] **Step 5:** Confirm `git log origin/main..HEAD` shows only this round's commits and `git status` clean. **DO NOT push. DO NOT run vercel.**

## Self-review notes
- Spec §1-§3 coverage: T1 (D1), T2 (D2, answers 1a/1b/3-MDR/3-XTB, hazards 1-3), T3+T4 (D3, answer 2), T5 (D5), T6 (D4), T7 (§6), T8 (verification). Answer 3-H/3-I → T7 report. Answer 5/NFR → reason-text only (T2 covers the productMap comment update).
- Types used consistently: `creditExpected`/`totalCreditExpected` (T4→T5→T6), `mislabel-override`/`add-module` (T2→T5→T6), `CLASSIC_RATE_RULE_DISAGREES`/`SHEET_MISLABEL_OVERRIDE`/`CREDIT_EXPECTED` (T3→T5→T6).
- Known measure-then-pin values (probe-verified before pinning, identities in T5 Step 1): SHEET_MATH count, INVOICE_RATE_UNEXPECTED count, CLIENT_PRICE_DIFFERS count, CLASSIC_RATE_RULE_DISAGREES count, ratedLines count, totalHExpected, totalMargin.
