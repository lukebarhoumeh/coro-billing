# Call prep — Lita, Sept 29 2026: August reconciliation + QuickBooks integration

Source: Lita's 2026-09-28 email — her QB P&L Detail export (Coro class, July + August)
plus screenshots of her July and August runs on the live workbench. Full line-by-line
diff: `out/lita-reconcile-2026-09-28/REPORT.md`, regenerable via
`pnpm tsx scripts/qbLedgerReconcile.mts`.

## TL;DR — the platform now ties her books to the cent

Luke's direction (2026-09-28): **whatever Lida sends is the truth — her pricing is
correct.** Done and LIVE ON PROD same day:

- Her rates were adopted for every diverging line as curated overrides
  (`src/config/confirmedRates.ts`, 30 lines across 9 partners, each carrying the QB
  invoice it came from and surfacing a RATE_OVERRIDE_APPLIED finding in the workbench —
  the sheet's col E stays visible, nothing silent).
- **August drafted total is now $13,957.76 and matches her QB per partner, per line,
  Δ $0.00 everywhere — except Rocker (−$460.35), the one genuine open question below.**
- Margin story improved: 3 of the 4 margin-negative partners (Evolve, TDI/Teledata, XTB)
  flipped positive at her rates; only TechLead's team-price deal stays cash-negative
  until Coro's $695 credit memo lands.
- Her QB customer names are now mapped for the QBO push (our "Teledata Cloud Services" →
  her "TDI Technologies, Inc.", "Techlead…LLC." punctuation, etc.) so pushing will never
  duplicate her customer list.
- Her saved August approvals reset on next visit (review state is keyed on the rates
  revision) — expected: she re-approves against the corrected numbers.

Rates adopted (was sheet col E → now her rate): Essentials Flex 6.00 (Avox, Cyber, XTB,
TDI; was 3.75–5.00, below Coro's own ~4.13 cost in two cases) · Complete Flex 8.90
(Evolve, XTB, Cyber; was 7.50/9.00) · Evolve Managed Complete 14.50 (card had no rate —
line used to misprice as plain Complete) · Endpoint Protection 4.12/4.13 · Email
Protection 4.12 (was 3.00, below cost) · Classic Flex 6.59 (Net-Tech, Cyber, GOA) and
6.60 (Rocker) · modules 2.50 everywhere · Cyber Managed Classic 9.35 · SAT 1.10 ·
Rocker legacy Complete 8.25 (encoded so September prices instead of holding).

Note for Danny (separate conversation, not this call): the sheet carried HIGHER rates
than she bills on Classic (7.20), modules (3.00), SAT (1.40), Cyber Managed Classic
(10.20) — ~$304/mo if that repricing was intentional. We adopted her rates; repricing
partners upward is a business decision for later.

## LATE ADD — Coro's SEPTEMBER bill landed (INVCUS2026-0002512, 2026-09-28)

$20,594.49, Sep 1–30 service, NET 45 due Nov 8. PDF at `data/2026-09/`. Line-sum ties
to the cent. What it changes for this call:

- **Coro fixed their billing.** September rates follow the correct partner-specific
  additive discounts everywhere spot-checked (Techlead 65%→5.25, Rocker 63%→5.55,
  Classic flat-45→6.59, SAT→1.10). Credits stop accruing; **August's $1,041.38 is
  still owed** — now a cleanly bounded, one-month claim.
- **Rocker double-bill, two months confirmed.** September again bills ONLY 46 AI
  Complete for Rocker — no legacy — matching the August audit. Her invoice 10601's
  legacy $460.35 now looks like a genuine double-bill of Rocker.
- **Mass migration to AI SKUs.** Cyber's whole legacy stack is gone (now AI Complete
  47 + AI Essentials 26); Evolve folded to 34 AI Complete; XTB, Amplivity, and
  Teledata's Essentials migrated; Techlead moved to AI Complete 337 + CORO MANAGED
  337 (+7 residual Managed-Complete-Flex). Her September invoices will look
  structurally different — need her AI sell rates for migrated partners.
- **$10,194.54 of the bill is NEW parents:** ICT $5,295.95 (1,266 Essentials Flex!),
  S3 $1,415.43 (new SKUs: MDR Flex, three SOC Flex, Managed Essentials Flex),
  Live-Tech, Copperband, Auditlytics (new COR-USERD-C SKU), Computer Central,
  Forcetech, Albany IT, Techshield. None have sell rates on the pricing sheet —
  the September close will hold them until rates exist. Ask who prices these.
- **Challenge line:** Coro billed "MSP Hub - Disti/MSP" itself $602.25 (73 AI
  Complete) — our own workspace. Should Hub be paying for Hub?
- **BeNe International is MISSING from the September bill entirely** (a $1,032/mo
  billed partner in August) — churn or a Coro miss? Ask.
- Logistics: we need the **XLSX** version of 2512 for the workbench's invoice slot
  (PDF only so far).

## The call (30 min)

1. **(5) Show the tie-out.** Her August line-by-line now matches QB exactly. Ask her to
   re-run August on the site when convenient — drafts will show her numbers, and the
   overridden lines each carry an info note naming her invoice as the source.
2. **(10) Rocker — the one open item ($460.35).** Coro's August audit shows Rocker fully
   on CORO AI Complete (46 units — ties her AI line to the cent) and has **zero legacy
   rows**; Coro's August bill to Hub doesn't charge Rocker legacy either. Her invoice
   10601 still bills the legacy stack (Complete Flex 11×8.25 + Classic 56×6.60).
   Question: did Rocker migrate (→ drop those lines going forward) or do the legacy
   licenses still bill contractually (→ we flag the audit gap to Coro; rates are already
   encoded on our side)? Also Rocker-specific: KY sales tax 6%.
3. **(5) Invoice extras.** Which partners carry sales tax (Rocker KY — others?) and
   card fees (Cyber's $21.00 appears on July 10548 but not August 10597 — card-payment
   conditional?). We'll model both on drafts/pushes once she confirms the rules.
4. **(5) Her Coro-bill booking + the credit.** She booked INVCUS2026-0002193 at
   $12,130.10 vs the invoice's $12,998.33 subtotal — within $59.28 of our corrected
   additive cost ($12,070.82). Compare notes: did she re-key at corrected rates? Ties
   into the **$1,041.38 credit** we computed Coro owes on legacy lines
   (docs/CORO_REPLY_2026-09-22.md — undelivered; Dane-or-drop pending).
5. **(5) QuickBooks go-live plan.** Connection is built, tested, and deliberately OFF on
   prod today. Sequence: we arm production keys → she connects via the QuickBooks card →
   one sandbox push test together → September close pushes drafts as QB invoices under
   her exact customer names, after her approvals. **July and August are never pushed** —
   they live in QB exactly as she made them; September is the first pushed month.

## After the call (implementation queue)

- Rocker resolution (drop legacy vs bill it + flag audit gap to Coro).
- Sales tax + card-fee lines on drafts/pushes per her rules.
- Arm prod QBO env (keys ready) → sandbox push test → September close.
- Danny: optional repricing conversation (sheet's higher Classic/modules/SAT rates).

## Draft reply to Lita (copy-paste; M365 connector is read-only so no Outlook draft)

> Hi Lida,
>
> This is exactly what I needed — thank you. I went through your QuickBooks transactions
> line by line against the platform, and I've already updated it to your pricing: if you
> re-run August, every partner now matches your invoices to the cent. Where the Coro
> pricing sheet disagreed with your rates, your rate is now the one the platform drafts
> (each of those lines shows a small note naming which of your invoices it came from).
>
> Yes to a call tomorrow — what time works? Should only take about 30 minutes:
>
> - **Rocker** — the one item I couldn't resolve from the files. Coro's August usage
>   shows them fully on AI Complete (that line ties your invoice 10601 to the cent), but
>   their legacy Complete/Classic lines no longer appear in Coro's usage or on Coro's
>   bill to us. Do those still bill contractually, or did Rocker migrate?
> - **Tax and fees** — which partners get sales tax (I see Rocker's KY 6%) and how you
>   apply the card fee (it's on Cyber's July invoice but not August), so the platform
>   can add those lines for you.
> - Quick question on Coro bill INVCUS2026-0002193 — you booked $12,130.10 vs the
>   invoice's $12,998.33 subtotal, which lines up almost exactly with the overcharge we
>   found on their legacy lines. Want to compare notes on that credit.
> - **QuickBooks** — the integration is ready; I'd like to walk you through how
>   September will work (you approve drafts, it creates the invoices in QB under your
>   exact customer names — and July/August stay untouched, exactly as you invoiced them).
>
> Send me a couple of times that work and I'll set it up.
>
> Thanks again — this was a huge help.
>
> Luke
