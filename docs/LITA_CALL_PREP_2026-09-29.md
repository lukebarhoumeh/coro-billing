# Call prep — Lita, Sept 29 2026: August reconciliation + QuickBooks integration

Source: Lita's 2026-09-28 email ("Please see the details below… I've also attached the
QuickBooks transactions") — her QB P&L Detail export (Coro class, July + August) plus
screenshots of her own July and August runs on the live workbench. Full line-by-line diff:
`out/lita-reconcile-2026-09-28/REPORT.md`, regenerable via
`pnpm tsx scripts/qbLedgerReconcile.mts`.

## TL;DR

- Her August run on prod v2 reproduced our close exactly: **$13,778.40 / $12,070.82 / GP
  $1,707.58, 16 drafts** — the headless rerun ties her screenshot on all 16 partners.
- Against her actual QB invoices, **7 partners tie cent-exact** (TechLead $3,515.00, VienerX
  $1,811.20, Ideal Tech $1,521.75, BeNe $1,032.00, Meeting Tree $750.00, IT Network $174.50,
  Hurricane $0) — that's every AI-SKU partner. **All divergence is on legacy Flex SKUs**, and
  every dollar of it decomposes into a handful of rate-card cells plus one Rocker question.
- August totals: our close $13,778.40 vs her QB $14,418.11 → Δ $639.71, fully itemized below.
- "TDI Technologies, Inc." in her books **is** our "Teledata Cloud Services" (identical lines
  both months). Not a missing partner — a naming difference we must map before any QBO push.

## Bucket A — sheet col E is stale/below cost; her rates look right (confirm + we adopt)

The pricing CSV's "Net Price to MSP" (col E) is *below Coro's own cost* on three of these.
Her invoice rates are coherent (cost pass-through or sensible margin). Ask her to confirm
each is the current agreed rate; then they become card overrides in the workbench.

| SKU family | sheet E (partners) | she bills | Coro cost/unit | Aug impact (ours − hers) |
|---|---|---|---|---|
| CORO ESSENTIALS Flex | 5.00 Avox · 4.50 Cyber · 3.75 XTB · 3.75 TDI | **6.00** | ≈4.13 | −193.25 |
| CORO COMPLETE Flex | 7.50 Evolve · 7.50 XTB | **8.90** | 8.25 | −60.20 |
| ENDPOINT PROTECTION Flex | 4.00 TDI · 3.50 XTB | **4.12 / 4.13** | 4.125 | −6.33 |
| EMAIL PROTECTION Flex | 3.00 Net-Tech | **4.12** | 4.125 | −112.00 |
| MANAGED CORO COMPLETE Flex (Evolve) | *no row — priced as plain Complete 7.50* | **14.50** | 11.00 | −112.00 |

(Amplivity Essentials 5.00 and Techlead Essentials 3.00 tie on both sides — genuinely
per-partner rates, so these are per-card fixes, not one global number.)

## Bucket B — sheet col E is HIGHER than what she bills (Danny decision: reprice or keep)

Her rates here are essentially cost pass-through (0 margin); the sheet carries a marked-up
rate. If the sheet is Danny's intended repricing, September invoices go up ~$304/mo across
these partners; if not, we adopt her rates and tie her books exactly.

| SKU family | sheet E | she bills | Coro cost/unit | Aug impact (ours − hers) |
|---|---|---|---|---|
| CORO CLASSIC Flex (Net-Tech 207u, Cyber 41u, GOA 14u) | 7.20 | **6.59** | 6.5945 (flat-45) | +159.82 |
| Modules Flex, all MOD*/SWG (Net-Tech 232u, Cyber 23u, Amplivity 13u) | 3.00 | **2.50** | 1.40 | +134.00 |
| MANAGED CORO CLASSIC Flex (Cyber 10u) | 10.20 | **9.35** | 9.345 | +8.50 |
| SECURITY AWARENESS TRAINING Flex (Evolve 6u) | 1.40 | **1.10** | 1.10 | +1.80 |
| CORO COMPLETE Flex (Cyber 3u) | 9.00 | **8.90** | 8.25 | +0.30 |

## Bucket C — structural questions for the call

1. **Rocker ($460.35).** Coro's August audit shows Rocker fully on CORO AI Complete (46
   units — our $294.40 ties her AI line cent-exact) and **contains zero legacy rows**; Coro's
   August bill to Hub doesn't charge for Rocker legacy either. Her invoice 10601 still bills
   the legacy stack (Complete Flex 11×8.25 + Classic Flex 56×6.60 = $460.35) on top.
   Question: did Rocker migrate (→ her invoice double-bills, next month drop the legacy
   lines) or do those licenses still bill contractually (→ we need them as card lines +
   flag the audit gap to Coro)? Also Rocker-specific: KY sales tax 6% on their invoice.
2. **Her August Coro-bill booking.** She booked INVCUS2026-0002193 at **$12,130.10**; the
   invoice's own subtotal is **$12,998.33**. Her booking is within $59.28 of our
   additive-rule expected cost ($12,070.82) — did she re-key the bill at corrected rates?
   Ties directly into the **$1,041.38 credit** we computed Coro owes on legacy lines
   (docs/CORO_REPLY_2026-09-22.md — still undelivered; Dane-or-drop).
3. **QBO customer names.** Push matches/creates QB customers by name. Hers vs ours:
   TDI Technologies, Inc. ≠ Teledata Cloud Services · Net-Tech ≠ Net-Tech Consulting ·
   VienerX ≠ VienerX Consulting · Techlead Professional Services, LLC. ≠ TechLead
   Professional Services LLC · IT Network Solutions Group, LLC. ≠ IT Network Solutions ·
   Cyber Construction, Inc. ≠ Cyber Construction. We need her exact QB display names as a
   mapping before the first push or we create duplicate customers.
4. **Invoice extras we don't model yet:** sales tax (Rocker KY 6%) and the Cyber $21.00
   credit-card fee line. Confirm which partners carry tax/fees so we can encode them.
5. **Never-push July/August.** Both months are already invoiced manually in her QB. The
   workbench will only ever push **September forward** (dedup guards our own HUB- numbers,
   not hers). State this explicitly on the call.
6. **September go-live sequence** (after rates confirmed): we arm production QuickBooks
   (keys are granted and ready; connection is deliberately off today) → she connects via
   the QuickBooks card → we do one sandbox push test together → September close pushes
   drafts as QB invoices with her approving in the workbench.

## Suggested call agenda (30 min)

1. (5) August walkthrough: 7 partners cent-exact; every delta is legacy-Flex rates.
2. (10) Rate confirmations — Bucket A one by one ("is 6.00 the current Essentials rate for
   Avox/Cyber/XTB/TDI?" etc.), then Bucket B ("sheet says 7.20 Classic / 3.00 modules —
   intended increase, or do we keep your rates?"). Loop Danny on Bucket B if he's not on.
3. (5) Rocker: migrated or dual-stack? Tax + card-fee list.
4. (5) Her 0002193 booking + the $1,041.38 Coro credit — what she wants to do.
5. (5) QBO: name mapping, never-push-July/Aug, September push plan + test.

## After the call (implementation queue)

- Rate-card overrides for every confirmed rate (Bucket A + B outcomes) + Evolve
  Managed-Complete row + Rocker resolution.
- Partner → QB-customer-name map in the push path.
- Tax + card-fee lines on drafts/pushes where confirmed.
- Then: arm prod QBO env, sandbox push test, September close.

## Draft reply to Lita (copy-paste; M365 connector is read-only so no Outlook draft)

> Hi Lida,
>
> This is exactly what I needed — thank you. I ran your QuickBooks transactions against the
> platform line by line, and it's in great shape: seven partners tie to the cent (Techlead,
> VienerX, Ideal Tech, BeNe, Meeting Tree, IT Network Solutions, plus Hurricane at zero),
> and every remaining difference comes down to a short list of legacy Flex rates I'd like
> to confirm with you.
>
> Yes to a call tomorrow — what time works for you? Should only take about 30 minutes.
> What I'd like to cover:
>
> - **Rate confirmations** — the pricing sheet disagrees with your invoices on a few legacy
>   items (Essentials Flex, Complete Flex, Classic Flex, the module add-ons, Endpoint/Email
>   Protection, and Evolve's Managed Complete). Your rates look right on most of them; I
>   just want to lock in the current number for each partner so the platform matches your
>   books exactly going forward.
> - **Rocker** — Coro's August usage shows them fully on AI Complete (that line ties your
>   invoice to the cent), but their legacy Complete/Classic lines don't appear in the usage
>   or on Coro's bill to us anymore. Want to check whether those still bill or whether they
>   migrated.
> - **QuickBooks integration** — the connection is built and tested; before we turn it on I
>   want to match our partner names to your exact QB customer names (e.g. your TDI
>   Technologies is our Teledata) so nothing duplicates. And to be clear on process: July
>   and August stay exactly as you invoiced them — the platform will only ever push
>   September forward, after you approve each draft.
> - Quick question on Coro bill INVCUS2026-0002193 — I noticed it's booked at $12,130.10 vs
>   the invoice's $12,998.33 subtotal, which lines up with the overcharge we found on their
>   legacy lines. Want to compare notes on that credit.
>
> Send me a couple of times that work and I'll set it up.
>
> Thanks again — this was a huge help.
>
> Luke
