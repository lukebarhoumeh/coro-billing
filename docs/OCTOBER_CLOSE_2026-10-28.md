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

- **L $32,239.44** billed across **41 partner drafts** (16 card-only, 0 unmapped)
- **Actual H $27,484.89** joined from invoice 2995; **margin $4,144.05**
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

## Carried from September (verify status)

- Sept credit memos (Net-Tech + S3 per line on 2512) — Lida asked Lisa by
  **Oct 7**; Lida's 2026-10-28 "this is everything we need" suggests resolved —
  confirm memos actually posted.
- Rocker's QB 10601 legacy $460.35 (partner-side double-bill question) — open.
- August $1,041.38 credit — Dane-or-drop, still undecided.
- QBO arming + joint test push with Lita (was "mid-Oct") — now due; keys in
  `~\.coro-qbo-PRODUCTION-keys-2026-09-24.env`; prod QBO still dark.
- KY sales tax + card-fee lines (Rocker/Cyber invoices) — still unmodeled.
