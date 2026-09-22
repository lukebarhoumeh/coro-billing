# MSP Hub → Coro: reply to your 2026-09-22 answers

**From:** MSP Hub, LLC — accounting
**Date:** September 22, 2026
**References:** your email answers to our 2026-09-21 letter; the corrected Coro Special MSP
Pricing CSV and re-exported August usage you sent with it; invoices INVCUS2026-0001914 / -0002193.
**Attachment:** `column-h-discrepancies.csv` (all 299 priced sheet rows classified — the
inconsistency list you asked for).

Thank you — the answers were exactly what we needed. We've adopted them into our automated close
the same day. This reply has three parts: **(1)** what we adopted, **(2)** the credit we now
expect on invoice 2193 per your answer (c), and **(3)** issues we found in the corrected sheet +
the short list for the call with Lisa.

---

## 1. Adopted as confirmed

- **Cost model:** total discount from list = partner % + MSP Hub's additional % where the
  additional % = 45 − partner (floored at 5 when the partner exceeds 40) — applied additively off
  list. This matches how your invoices actually bill and is now our canonical cost everywhere.
- **The two new rate rows** (Net-Tech "BUEmail Flex", Cyber Construction "Managed Coro Classic")
  are live — both formerly-held lines now bill. Net-Tech August email protection drafts at
  100 × $3.00; Cyber Construction Managed Classic at 10 × $10.20.
- **Classic exception:** Coro Classic / Managed Classic cost us a flat 45% off list regardless of
  partner. Adopted — including on cards whose rows still say otherwise (see §3.4).
- **MDR + Secured Web Gateway = Modules Flex rates:** adopted, "assumed" caveat removed.
- **NFR never billable:** confirmed on our side too; stray "XTB" row: gone in your revision. The
  Seven Star / DK Systems column-I corrections all check out.

## 2. Credit expected on invoice 2193 (August) — $1,041.38

Per your answer (c) (partner-specific discounts apply to legacy flex; your team "had been
crediting/working to credit"), we recomputed every legacy line on 2193 at the partner-specific
additive cost. Ten lines were billed at the flat legacy rate above it:

| Partner | SKU (2193) | Qty billed | Billed /unit | Per answer (c) /unit | Credit |
| --- | --- | --- | --- | --- | --- |
| TechLead | BUCOMMNGflex | 340 | $11.00 | $9.00 | $680.00 |
| TechLead | BUCOROflex | 10 | $4.125 | $2.625 | $15.00 |
| Net-Tech | BUEMAILflex | 100 | $4.125 | $2.625 | $150.00 |
| Evolve | BUCOMMNGflex | 16 | $11.00 | $6.75 | $68.00 |
| Evolve | BUCOMflex | 18 | $8.25 | $6.75 | $27.00 |
| XTB Solutions | BUCOMflex | 25 | $8.25 | $6.75 | $37.50 |
| XTB Solutions | BUCOROflex | 39 | $4.13 | $3.375 | $29.26 |
| XTB Solutions | BUENDflex | 7 | $4.13 | $2.75 | $9.63 |
| Teledata | BUENDflex | 16 | $4.125 | $2.75 | $22.00 |
| Teledata | BUCOROflex | 4 | $4.125 | $3.375 | $3.00 |

**Total: $1,041.38** (computed at full precision; per-line figures above are display-rounded).
Per-partner: TechLead $695.00 · Net-Tech $150.00 · Evolve $95.00 · XTB $76.38 · Teledata $25.00.

Notes:
- **TechLead's Managed Classic (BUCOCLASSMNflex) is correctly NOT in this list** — per your
  Classic exception, the $9.34 you billed is the agreed cost.
- We did **not** claim credits on the MOD\*flex module lines you billed at $2.20/unit. That rate is
  *below* the sheet-additive cost of the $7.50-list modules rows, so we assume it prices off the
  legacy $4.00 modules list — **please confirm on the call which list governs legacy MOD codes**
  (if partner discounts apply against the $4.00 list, those lines would also be over-billed).
- Invoice 1914 (July) presumably has the same pattern — happy to run the same computation once we
  align on the mechanics.

## 3. Issues in the corrected sheet (please fix / confirm)

1. **Cyber Construction label swap.** The old "Coro Classic Flex" row (list $11.99, net $7.20) is
   now *named* "Modules Flex", while the true modules rate (list $7.50, net $3.00) moved to a new
   "Coro Module Flex" row. We detect and price around it, but please restore the names — Cyber
   Construction is the only partner where "Modules Flex" ≠ the modules rate.
2. **Column H, systemically.** You said col H represents our expected license cost (±$0.01
   rounding). Against your own stated model (H = list × (1 − col I)), **280 of 299 priced rows
   don't match**: 276 carry the older `E × 0.95` value instead (deltas +$0.10 to +$3.15/unit — not
   rounding), 3 match neither — **B2B Endpoint Protection Flex $3.30**, **B2B Managed Coro
   Essentials Flex $5.50** (its E of $6.40 also isn't list×(1−F) = $7.25), **Live-Tech Coro AI
   Modules $5.63** (likely a typo for $5.70) — and 1 is blank (**Cyber Construction Essentials
   Flex**). The 17 rows you re-derived in this revision are all correct. Full classification in
   the attached CSV. We don't use col H for pricing (the additive rule governs), so fix at your
   convenience — but as-is it will mislead Lida's audits.
3. **Rex Black** has three arithmetically impossible rows (Coro AI Essentials F=60/G=25/I=45;
   Coro AI Modules and the new Modules Flex F=76/G=25/I=45 — F+G is 85/101 but I says 45).
   Also **Auditlytics** and **Copperband** carry G=9% where your 45−F rule says 5% — intentional
   negotiated rates, or leftovers?
4. **Classic-family rows vs your 40/45 rule:** TechLead's "Managed Classic Flex" row still shows
   50%+5% and a partner net of $8.50 — under your rule the partner discount is 40% ($10.19) and
   our cost $9.34. As written we'd bill TechLead $8.50 against a $9.34 cost (underwater). Please
   re-issue that row (and check other Classic rows) per the rule.
5. **Net-Tech "Coro Managed Flex"** row is entirely blank (no list/net/discounts) — intentional?
6. **August usage re-export (2026-09-22) is corrupt:** the Usage-tab Quantity column contains the
   original file's values **sorted ascending** — detached from their rows (289 of 308 cells
   wrong; the Audit strings are identical and unaffected). This is the second broken re-export
   after the zeroed-Quantity one. We continue billing from the Audit-stated quantities on the
   original file; something in the export pipeline is mangling that column.

## 4. For the call (with Lisa)

1. **Rocker July double-bill on 2193** ($153.31, your own line note says "Jul period billed
   again") — confirm the credit/adjustment.
2. **Ideal Tech Help, Coro AI Lite 38 → 371 seats** — confirm 371 is real.
3. **Usage exports:** confirm the all-partner monthly file stays the canonical ~1st-of-month
   delivery, the Audit-stated quantity governs (incl. the 8 self-contradictory audit strings we
   listed), and the Quantity-column export bug (§3.6).
4. **Legacy MOD\*flex list price** — $4.00 legacy list vs the sheet's $7.50 modules rows (§2 note).
5. **Credit mechanics + timing** for §2 (and July/1914) — the distributor agreement has no
   credit-memo process, so let's agree the vehicle (credit memo vs offset on the next invoice).
6. **Naming:** we'll keep "Avox" as the partner name and map workspace `vaimancom` — adding a
   workspace-ID column to invoice detail would remove this class of issue entirely.
7. **Net-Tech email protection economics** (FYI): at your flat-rate billing ($4.125) and the new
   card's $3.00 partner price, the SKU is underwater for us until the answer-(c) credits apply
   ($2.625 cost → healthy). Just flagging so nobody is surprised by the August draft.
8. **Housekeeping (Lisa):** the signed distributor agreement specifies the 45% tier only
   (Exhibit A) — the additional 5% minimum shows up in practice and in your email but not in the
   contract; we'd like to confirm it's anchored in the Compass program terms.
