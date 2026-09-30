# September 2026 close — packet adoption (2026-09-29)

Inputs: Lisa's (Coro AR) email via Lita, Jack's revised special pricing CSV, the
September usage report, invoice INVCUS2026-0002512 (PDF) + credit memo
CMCUS2026-0000106, and the Luke/Lindita call (15m42s, transcript in `data/`).
Files staged per `data/README.md` § 2026-09-29. Pinned end-to-end in
`tests/e2e.septemberClose.real.test.ts`.

## 2026-09-30 — Coro answered the open rates; Lida escalated the process

Overnight the "Coro MSP September Usage" thread resolved the Net-Tech and S-3
rate questions and turned into a formal process escalation (3 new messages, all
cc Luke + Susan; the 3:09pm now cc's **Sam Barhoumeh**).

**Net-Tech (rates confirmed; Lida rebuilt the invoice).** Brandon: Email
Protection Flex is **65%**, not the invoiced 45% ("a legacy bundle caught in
transition … moved to modern bundles this week, should not see this again in
October" — Lisa to fold into the credit); Classic Flex **$7.20 to the partner /
$6.60 to MSP Hub** (our `confirmedRates` Classic is a stale 6.59 — see reconcile below); Cloud Security Flex (not on the
sheet) = Module Flex, **$3.00 to the partner**. Lida built a revised Net-Tech
invoice (**Invoice 10625.pdf**) and Brandon approved sending it. NOTE: the $3.00
Cloud Security figure diverges from `confirmedRates` `net-tech|modcloudflex 2.50`
(Aug-derived from QB 10550) — the authoritative September Net-Tech rates now live
in her revised 10625; reconcile against it before changing `confirmedRates`.

**S-3 (Brandon's full Flex table — answers open item #1's rate).** Partner price
/ MSP Hub cost: MDR Flex (= Module Flex) $1.92 / $1.58 · SAT Flex $1.40 / $1.10 ·
Essentials Flex $3.00 / $2.63 · **Managed Essentials Flex $5.50 (= $3.00 Essentials
+ $2.50 Managed) / $4.88** · User Data Governance Flex (= Module Flex) $1.92 /
$1.58. Lisa to process the credits back to MSP Hub. The **$5.50 sell** is the
managed-essentials rate the held line was waiting on; the **$4.88 cost** is below
Coro's invoiced ~$5.78 (94 × ($5.78 − $4.88) ≈ **$84** additional credit on that
line, on top of S-3's $288.38).

**The held line — cleared 2026-09-30 via a new off-card override.** `confirmedRates`
cannot do it: `resolveConfirmedRate` is skipped for unmatched (`match.kind === "none"`)
lines — it corrects a price only where a card row exists, and "never invents a
product" (`rateCardClose.ts`, `productMap.ts`). So a NEW, separate config
`src/config/offCardRates.ts` carries the deliberate, Coro-written exception: a rate
for a product absent from the card. **`S-3|BUCORMNGflex` now bills off-card at $5.50
(cost $4.88)** — matchKind `off-card`, ZERO held lines, and the ~$5.78 Coro invoiced
surfaces the **$84.13** credit automatically. Kept OUT of `CONFIRMED_RATES_REVISION`
on purpose: a held line was never approvable, so nothing stale attaches —
**Lida's September web approvals are preserved.** When Coro re-issues the pricing CSV
with the row (Lida's Oct ask), the off-card entry can retire.

**Auditlytics USERD (item #3) validated by Coro.** Brandon: User Data Governance
Flex = Module Flex = **$1.58** to MSP Hub — i.e. Coro's flat-45% $4.13 is the
over-bill, exactly as the close flags. Current-gen, so no auto-credit; raise it
with the item-2 list.

**Net-Tech reconcile — Invoice 10625 vs our draft.** Parsed Lida's revised invoice
(Net 30, due 10/01/2026, total **$2,180.40**): AI Complete 7 × 6.00, AI Endpoint
16 × 3.00, Email Protection Flex 100 × **3.00**, Cloud Security Flex 100 × **3.00**,
Classic Flex 207 × **7.20**. Our close drafts **$2,116.13**; the **$64.27** gap is
three stale `confirmedRates` on the sell (L) side — Classic **6.59 → 7.20** (+$126.27;
our 6.59 was the Aug/QB cost, ≈zero-margin on 207 units), Email Protection
**4.12 → 3.00** (−$112.00), Cloud Security **2.50 → 3.00** (+$50.00). AI Complete &
Endpoint tie. 10625 is the authority (Brandon: $7.20 partner / $6.60 Hub on Classic).
**Applied 2026-09-30:** the Sept pricing card already carries 7.20/3.00/3.00 (that's
why removing the override drops 3 `RATE_OVERRIDE_APPLIED` findings), so the fix was to
**period-gate the stale Aug override to `2026-08`** (new `period` field on
`confirmedRates` entries) — August stays byte-identical (validated to the penny),
September falls through to the correct card. `CONFIRMED_RATES_REVISION` bumped 1→2
(resets Sept approvals — intended, since the numbers changed).

**Credit memo formally requested.** Lida asked Lisa for the credit memo on
**INVCUS2026-0002512** (Net-Tech + S3 adjustments, per line) by **October 7**.

**Process escalation (Lida, 3:09pm, +Sam Barhoumeh).** "The current process is not
working for MSP Hub" — almost every Coro invoice has needed corrections
(Net-Tech, S3, Avox, TechLead). Four asks for the October cycle, **confirm by
Oct 7** + name the Coro owner of a pre-invoice review: (1) review partner pricing
against the agreed list before sending; (2) notify new partners ≥1 week ahead
with billing details + rates; (3) apply adjustments to the invoice itself instead
of bill-full-then-credit; (4) date invoices no earlier than the send date / period
end. Also: September's due date should be **Nov 12** (Net 45 from the Sep 28
receipt), not Nov 8.

**Engine impact this round: two corrections + a September re-pin.** (1) S-3's
managed-essentials now bills off-card (+$517.00 L / +$542.85 H, was held) and (2)
Net-Tech's Sept sell rates match invoice 10625 (+$64.27 L, cost unchanged). The month
now foots to **L $21,732.71 / actual H $19,907.41 / margin $1,223.05 / credits
$1,875.66** (was 21,151.44 / 19,364.56 / 1,184.63 / 1,791.54), **zero held lines**,
246 rated lines. Full suite **359 green**, root typecheck clean, web bundle builds
(`tests/close/offCardRate.test.ts`, the Net-Tech reconcile assertion, and the
re-pinned `e2e.septemberClose.real`). The other confirmations still match numbers the
close already computes and await Coro's memos; items #1 (held-line rate) and #3
(USERD) are answered.

## What the call decided (Lindita, 2026-09-29)

- **This month she invoices manually**; the platform runs alongside as the
  check. Mid-October: generate test invoices through the QBO integration
  together (deletable from QB — "it's not an issue"), so the **October close
  generates on its own**. End-of-month/start-of-month is her crunch — don't
  add work then.
- Her two August QB invoices that wouldn't generate were **Rocker LLC** and
  **Cyber Construction** — "all the old legacy," QB couldn't find the price.
  Rates for both are already encoded (confirmedRates.ts); the Rocker $460.35
  double-bill question is STILL OPEN from the call prep.
- She confirmed our cost is the invoice's **$20,594.49** ("the bill that they
  send us … should be our cost") and that billed-to-partner "**should be
  higher**" — the close now drafts **$21,151.44** over it.
- QBO push mechanics reconfirmed: her customer/product matching is done ahead
  of time; generated invoices are drafts she reviews (tax exemptions, invoice
  email addresses) — never auto-sent.

## The close, with the full packet loaded

| | |
|---|---|
| Drafted L (billed to partners) | **$21,151.44** |
| Actual Coro cost (invoice-matched) | $19,364.56 |
| Expected cost (additive rule) | $18,353.68 |
| Margin (cash-true) | **$1,184.63** |
| Credits expected from Coro | **$1,791.54** |
| Held lines | 1 |

Actual-vs-balance-due bridge: $20,509.66 balance due = $19,364.56 matched
+ $602.25 Hub self-bill (no usage) + $542.85 held S3 managed-essentials line.

## What changed in the engine

- `partners.ts` — nine September parents added to `PARTNER_SLUG_MAP`
  (albanyitcom, auditlyticscom, computercentralbiz, copperbandtechcom,
  forcetechitcom, ictcom, mylive-techcom, s3svccom, techshieldmspus). The
  s3svccom and copperbandtechcom entries are load-bearing for the invoice
  cross-check (Coro invoices them under different names than the card).
- `productMap.ts` — `COR-USERD-C` (User Data Governance, a module) prices from
  the current-gen "Coro AI Modules" row; `BUCORMNGflex` (Managed Essentials
  Flex) resolves ONLY from a managed-essentials row — no unmanaged fallback.
- Invoice 2512 transcription + credit-memo netting: see
  `data/2026-09/_build_2512_xlsx.mjs`.
- `CONFIRMED_RATES_REVISION` intentionally NOT bumped: the confirmed-rates
  table is unchanged and August's numbers are byte-identical (the August e2e
  pins prove it) — bumping would needlessly reset Lita's August approvals.

## Albany IT — the template for the legacy fixes

Coro billed 87 × 4.13 (flat 45%) = $358.88, then processed credit memo
CMCUS2026-0000106 for −$84.83, netting to 87 × 3.15 — exactly the 58%-total
additive rate now on Jack's sheet. The close shows actual = additive = $274.05,
no credit expected. **This is what "fixed" looks like; the five partners below
are still waiting for the same treatment.**

## Open items (ranked)

1. **S-3 sell rate for MANAGED CORO ESSENTIALS Flex** — the one held line.
   Coro bills us $542.85/mo (94 × 5.78) for it; we cannot bill it out until
   Jack/Brandon supply the rate (B2B's card row is $6.40 if they want a
   precedent). Chase this first — it's ~$600/mo of unbilled revenue.
2. **The $1,791.54 credit list = "Brandon's other changes."** ICT $1,329.30
   (1,266 Essentials Flex at flat 4.125 vs 54+5 → 3.075), Net-Tech $150.00
   (email protection, same over-bill as August), S-3 $288.38, Teledata $23.38,
   ForceTech $0.48. Send Coro the list; Albany proves the mechanism works.
3. **Auditlytics COR-USERD-C rate dispute** — Coro billed $4.13 (flat 45%);
   the card's modules rate is $1.58 additive. $284.63 billed vs $132.48 we can
   charge → Auditlytics is margin-negative until resolved. Current-gen SKU, so
   it is NOT in the auto-credit list — raise it alongside item 2.
4. **August's $1,041.38 credit** — still owed, still a cleanly-bounded
   one-month claim (docs/CORO_REPLY_2026-09-22.md undelivered; Dane-or-drop).
5. **Hub self-bill $602.25** — Coro invoiced "MSP Hub - Disti/MSP" 73 AI
   Complete with no usage behind it. Should Hub pay for Hub?
6. **BeNe International** — consumed 73 AI Complete in September, absent from
   invoice 2512 (was ~$1k/mo in August). Churn, migration, or a Coro miss?
   Expect a back-bill if it's a miss.
7. **Rocker $460.35 double-bill** — unresolved on the call; carry to the next
   one (KY sales-tax rule too).
8. **Mid-October QBO test push** with Lita (her explicit ask): arm prod keys →
   she connects → generate test invoices together → delete from QB → October
   closes generate for real.
