# October 2026 Close — 2026-10-28

First **generated** month (per the 2026-09-29 call: September was invoiced
manually; October the platform generates for real). Packet landed 2026-10-28:

| File | Source | Read |
| --- | --- | --- |
| `Coro Special MSP Pricing.csv` | Jack's revised card | 437 rows, **57 partner blocks** |
| `MSP Hub_October 2026 Usage.xlsx` | Lisa's reply to Lida, 2026-10-28 11:47 | 484 usage lines, 41 parents |
| `Coro_Invoice_INVCUS2026-0002995_Oct2026.xlsx` | NetSuite mail, 2026-10-28 07:52 | 100 lines, **$28,404.60**, due **Dec 11 2026** |

## The intake rejection (fixed)

Lida's drop of the usage file failed with *"usage row is missing a required
partner"* and the close stuck on 2026-08 (the period only adopts from a
successfully-parsed usage file). Root cause: Coro shipped a NEW workbook format
— three tabs (Monthly Snapshot / Aggregation / Usage) and renamed Usage-tab
headers (`Parent`, `End-User (Child) Workspace`, `Product Quantity`; the Metric
column is gone — quantities arrive pre-billed, the audit rule string stays as
provenance). Fixed by extending `USAGE_COLUMN_MAP` aliases; old formats parse
byte-identically. Pinned in `tests/ingest/usage.test.ts` and
`tests/e2e.octoberClose.real.test.ts`.

## Pinned close (tests/e2e.octoberClose.real.test.ts)

- **L $32,247.98** billed across **41 partner drafts** (16 card-only, 0 unmapped)
  — re-pinned 2026-10-29 from $32,239.44: GOA-Tech's Classic re-drafted
  6.59 → 7.20 (+$8.54), see below
- **Actual H $27,484.89** joined from invoice 2995; **margin $4,152.59**
- Invoice foots to the cent: $28,404.60 − 27,484.89 = **$919.71** = Hub self-bill
  $610.50 + Computer Central Sept catch-up $150.30 + Seven Star held SAT $158.91
- **1 held line**, **$0.16** total credit-expected (Brandon's legacy-discount
  fixes have landed — September's $1,875.66 of monthly accrual is gone)

Sixteen new parents joined (1Wire Fiber, Aspire Technical, Assure MSP,
Avaropoint, BB-Networks/B2B, Cite Technology Solutions, DK Systems, Evans
Consulting, Logic-IT, Rex Black, Seven Star Systems, Sevis Systems,
NPTech/Simplify Tech, Tec-Exchange, The NerdBee, Titanium Computing) — all
mapped in `src/config/partners.ts`. Three new current-gen codes: **COR-NETW-C**
and **COR-ENDDG-C** price like modules (invoice 2995 bills both at each
partner's exact COR-USERD-C module net), **COR-SAT-C** holds unless the card
carries a SAT row (Brandon: SAT is the only module not priced like a module).
`COR-COMP-NFR-C` recognized as NFR (listed, never billed — Hurricane IT).

## GOA-Tech wrong price — RESOLVED 2026-10-29

Lida: *"For client GOA-Tech, the app selected the wrong price; not sure why."*
Draft HUB-202610-019 billed Coro Classic (BUCOCLASSflex) 14 × **$6.59** vs the
sheet's **$7.20**. Root cause: the `confirmedRates.ts` override from her August
QB invoice 10551 had no period gate, so it kept clobbering the card — and 6.59
is the Hub **cost** (Classic flat-45: 11.99 × 55% = 6.5945), i.e. she was
billing GOA-Tech's Classic at zero margin. Same pattern as Net-Tech's September
fix. Fixed by retiring the entry `through: "2026-09"` (Aug stays as billed per
QB 10551; Sept stays as pinned — she invoiced Sept manually and no GOA artifact
exists in repo, worth a one-line verify against her next QB export; the card
rules from October on). The two other cost-equal Classic entries — Cyber
Construction 6.59 and Rocker 6.60, both dormant since their Classic migrations
— were retired the same way so a legacy reappearance prices from the card
instead of recreating this incident. October now carries **zero** rate
overrides — the whole month prices straight off Jack's card.

`CONFIRMED_RATES_REVISION` bumped 2 → 3. For Lida (hard-refresh the site
first): saved approvals reset for **all** months — October numbers changed
(GOA-Tech +$8.54); August/September numbers are unchanged, re-approving them
is just re-clicks. If October was already saved to the archive, **re-save it**
after re-approving — an archived pre-fix October (L 32,239.44) is not
auto-invalidated, so Trends/report pack would keep the stale totals.

## Open items — October (ranked)

1. **Seven Star SAT rate** — 233 × COR-SAT-C HELD; their card has no SAT row.
   Coro's cost is a flat $0.682/unit ($158.91). Ask Jack/Brandon for the sell
   rate (everyone else's SAT row is $1.40 partner / $1.10 Hub — but confirm,
   don't assume; the current-gen cost basis clearly changed). ≈ $326/mo
   unbilled until rated.
2. **Logic-IT over-bill** — Coro billed Coro AI Complete at **$5.85/unit vs the
   sheet's $3.45**; the draft is margin-negative (L $2,198.00 vs actual H
   $2,287.50, −$89.50). Raise with Coro billing; this is the Albany/Net-Tech
   pattern on a brand-new partner.
3. **Hub self-bill recurs** — invoice 2995 charges "MSP Hub - Disti/MSP"
   74 × Complete = **$610.50** with no usage row (Sept: 73/$602.25). The
   challenge stands; it's now ~$1,212.75 over two months.
4. **Computer Central Sept catch-up** — invoice line 27 is 2026-09 service
   (167 × $0.90 = $150.30): Coro under-billed Sept Endpoint at $1.85 vs the
   sheet's $2.75 and is rectifying (Brandon, 2026-10-28). The close excludes it
   from October cost. **Do not pass to the partner** (Brandon: bill them the
   same rate); book it as a September COGS correction. October Endpoint ties
   at 171 = 171.
5. **1Wire SOC-USERD under-bill** — Coro billed $1.00/unit vs additive $1.88
   (Hub's favor, $16.72). Flag for consistency when raising #2.
6. **S-3 current-gen SAT cost** — Coro bills $0.68 vs the card's $1.10 hub
   rate (Hub's favor). Fold into the Seven Star SAT ask: get Coro's
   current-gen SAT partner/hub rates onto the card.
7. **ForceTech $0.16 credit** (MODNETWflex 1.88 vs 1.72) — de minimis; list it.
8. **Card hygiene** — Modules Flex list diverges (Cyber Construction $11.99
   mislabel, known), Endpoint/Email Protection Flex lists split $7.50 vs $5.00
   across partners. Danny's "same in every one" rule still violated.
9. **Archive staleness gap (code)** — `closeStore`'s archive supersede/prompt
   compares file fingerprints only, not `CONFIRMED_RATES_REVISION`: a rates
   change with identical input files (like the GOA-Tech fix) leaves a stale
   archived snapshot in Trends with no nudge. Add the revision to the
   supersede check next engine round.

## Carried from September (verify status)

- Sept credit memos (Net-Tech + S3 per line on 2512) — Lida asked Lisa by
  **Oct 7**; Lida's 2026-10-28 "this is everything we need" suggests resolved —
  confirm memos actually posted.
- Rocker's QB 10601 legacy $460.35 (partner-side double-bill question) — open.
- August $1,041.38 credit — Dane-or-drop, still undecided.
- QBO arming + joint test push with Lita (was "mid-Oct") — now due; keys in
  `~\.coro-qbo-PRODUCTION-keys-2026-09-24.env`; prod QBO still dark.
- KY sales tax + card-fee lines (Rocker/Cyber invoices) — still unmodeled.
