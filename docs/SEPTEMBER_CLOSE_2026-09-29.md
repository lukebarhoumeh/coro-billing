# September 2026 close — packet adoption (2026-09-29)

Inputs: Lisa's (Coro AR) email via Lita, Jack's revised special pricing CSV, the
September usage report, invoice INVCUS2026-0002512 (PDF) + credit memo
CMCUS2026-0000106, and the Luke/Lindita call (15m42s, transcript in `data/`).
Files staged per `data/README.md` § 2026-09-29. Pinned end-to-end in
`tests/e2e.septemberClose.real.test.ts`.

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
