# MSP Hub — Coro billing automation

This repository is the working home for **MSP Hub accounting** on the Coro program.

Coro is a new vendor. Hub is a **two-tier distributor**: Coro sells consumption-based cybersecurity licenses to Hub; Hub bills the MSPs on the platform; those MSPs extend Coro to *their* customers.

The spec below is not a generic product brief. It is grounded in a **September 11, 2026** working call with **Dane Gaston** (transcript speaker label: Danny Gaston — Luke’s boss), **Luke Barhoumeh**, and **Lisa Paradis** (Coro accounting). Dane’s wording is the build instruction. The full transcript is in [`data/Call with Luke Barhoumeh (2).docx`](data/Call%20with%20Luke%20Barhoumeh%20(2).docx). Off-topic conversation from the end of that call is not part of this spec.

**What we are replacing:** Lindita’s (Lita’s) manual month-end spreadsheet — the pain that keeps this from scaling.

**What “done” looks like, in Dane’s words:** *we get a usage report from Coro, we plug it into this, it plugs the output into QuickBooks. And Lindita has her invoices.*

---

## Who this is for

Primary operator: **Lindita / MSP Hub accounting**. Dane’s goal is that she does not have to sit in a workbook and look up rates by hand so Hub can scale.

They are not asking for an MSP-facing portal. They need a trustworthy month-end close for one vendor, then invoices in **QuickBooks**.

If a number cannot be traced to a file in `data/` or to a written rate from Coro’s special pricing, it does not belong in the close.

---

## The call that defines the build

**When:** September 11, 2026, 4:12 PM (28m 24s)  
**Who:** Dane Gaston, Luke Barhoumeh, Lisa Paradis (joined mid-call when Dane pinged her for the missing rate export)

Speech-to-text in the transcript says “Quora / Cora” for **Coro**, “NCP” for **MCP**, “Lead / Lita” for **Lindita**, “Schlak” for **Slack**. This README uses the intended names.

Dane opened it as a discovery conversation. The rest of this file is that conversation turned into a build spec — **his terms kept**.

---

## The problem (Dane’s wording)

> The problem with Coro is around billing and the noise and inconsistencies between the **legacy SKUs**, **current SKUs**, **what our rates are**, and **what we’re supposed to / expected to charge the customers**.

We have a lot of data. That is a good thing. Most of it Dane is aggregating into a **SharePoint** file. SharePoint is the dump, not the close.

The known missing monthly habit: **Coro sends a usage report on about the 1st of every month** for all partners underneath Hub. Dane had a follow-up with Coro on the next Monday; he said we can start building without that piece if we have to. Luke’s later files include `MSP Hub_August 2026 Usage.xlsx` — use it. Do not pretend later months are August.

Partners in that usage file are Hub’s MSPs (Dane walked **Meeting Tree**, **Amplivity**, and others). Customers sit under the partner: you can tell a row is a customer of Amplivity because it is a **child account / workspace**.

On the usage tab Dane called out:

| Field he pointed at | Why it matters |
| --- | --- |
| Partner | Who Hub bills (the MSP) |
| SKU, including **legacy** | “That’s an important thing to know.” |
| Workspace / child account | End customer under the MSP |
| Subtype | “Doesn’t really matter, they’re all subscriptions” |
| Billing / legacy flags | Part of SKU class |
| U and D | Dane: *I don’t really know what U and D mean.* Do not invent. Flag unknown. |
| Product | What was actually consumed |

**Partners are not on one rate card.** Dane: *the problem is all these partners are on different stuff.* Flower-X-style exceptions are real. Do not assume one Hub-wide price per SKU.

---

## The thing to replace

Lindita already has a **manual August billing workbook**. That file is *hers* — it is not the file Coro delivers. Dane: *this one is all Lindita* vs *this is the one that gets delivered to us.*

Luke needs **both**:

1. **Original / delivered files** (usage, invoices, MSRP, agreement, Coro pricing exports)
2. **Lindita’s workbook** — the internal output to **mimic**. It is not sent to the customer. It is how Hub figures the bill, then invoices go out.

Dane, on August:

> This is August billing, essentially. We’re billing 16,000, 3,000 in profit. This is like a no-brainer if we can automate it. It’s just money that comes in if we can automate this. Otherwise, Lindita has to sit here and go find, okay, here’s the partner rate. Here’s our price.

Then he corrected the column names:

> Here’s **our rate**, here’s **the price**, and then the margin stuff’s automatically calculated. But these two columns are **H, our price**, and **what we’re charging, L**. If we can automate those. **That is the key.**

| Column in Lindita’s August file | Meaning (Dane) |
| --- | --- |
| **H — our price** | Hub’s cost / our rate |
| **L — what we’re charging** | What Hub charges the partner (the MSP) |
| Margin columns | Already calculated once H and L exist — do not make margin the hard part |

Luke: *And this is what you want to be replaced.*  
Dane: **Yes, this is what I want to replace.**

---

## The magic sauce

Dane, on pairing usage with rates:

> What I would love to see is like **what our rate is** and **what is the rate that we’re charging**. Amplivity is going to get a bill from us for all of this stuff. We break it down **by customer**. … We need to know like **what our cost is** and **what we’re charging the customer**. If we can get that information **paired with this**, that’s the **magic sauce** and **put that into QuickBooks**, we can automate this whole thing.

So the product is not “another SharePoint.” It is:

```text
Coro usage report (1st of month, all partners under Hub)
        +
Hub cost (our price / column H)
        +
Partner sell price (what we’re charging / column L)
        =
per-MSP, broken down by customer
        →
QuickBooks invoices for Lindita
```

Luke asked if we connect this to QuickBooks. Dane: **Ideally, yes.**

Perfect-world pipeline, Dane’s words:

> We get a usage report from Coro, we plug it into this, it plugs the output into QuickBooks. And Lindita has her invoices.

“This” is the automated version of Lindita’s workbook (columns H and L filled, margin following). It is **internal**. Invoices to partners come from QuickBooks, not from emailing that spreadsheet.

Dane also said we already have almost everything **except those two prices**:

> We have all of the data except for our price and their price here. This is everything we need minus those two things.

Luke: structure the pipeline now; when Jack’s rates land, it is plug-and-play. Dane agreed.

---

## Commercial model

```text
Coro  --(usage + invoices + special pricing)-->  MSP Hub (distributor)
                                                    |
                                                    |  Hub bills the MSP (QuickBooks)
                                                    |  break down by customer
                                                    v
                                               MSP on the platform
                                               (Amplivity, Meeting Tree, …)
                                                    |
                                                    |  MSP bills their customer
                                                    v
                                               End customer (child workspace)
```

Hub is not the MSP of record for the end customer. Hub’s customer is the partner. Usage is still at customer/workspace grain because that is how the bill is explained.

**5% buffer (from the agreement, Dane):** *we should have a 5% buffer on anything.* Example he gave: if a legacy deal is a **60%** discount, Hub should automatically get **65%**.

**Lisa (Coro) on legacy cost:**

- Cost lives on **Brandon and Jack’s special pricing spreadsheet**.
- *The legacy SKUs, that’s their pricing now. … What legacy says in there is the cost, and then your **45% discount**. … It’s straight across the board for anyone on Legacy.*
- *Anything with legacy, it’s the legacy SKU cost in that tab and 45%. And that’s what it is.*
- *This is what we bill you guys, the list price with the 45% discount. And that’s yours.*

Dane then had to separate **our price** vs **net price to MSP**:

> Wait, these are our price. Net price to MSP. … That’s not us. I get confused because so this is **their, the partner price**. This is **our price** with the note of like the **5% buffer** if they’re these guys.

**Current SKUs:** Dane said they may already have what each partner should be charged for the new SKUs. **Legacy SKUs** are the landmine:

> What we don’t have is like what rates are these guys on the legacy SKUs. Because we’re going to run into problems where we’re like, Brandon said you guys get this for **$6**, but you guys are charging us **$9**.

Lisa: Coro has been moving people **off Legacy onto AI**; keep legacy in a **separate tab/export** because those rows are still changing. Dane’s ask to Jack (via Lisa): **the exact same format as current — per partner, per SKU, their price and our price.** Discount percent is nice-to-have; *I just need their price and our price.*

Until that legacy export is in `data/`, treat legacy partner rates as **exceptions**, not guesses.

---

## Goal

**Final goal:** Lindita does not look up H and L by hand. Usage in → rates applied → QuickBooks invoices out. Margin follows. Hub can scale.

Concretely, for a month (first target: **August 2026**):

1. Ingest Coro’s **delivered** usage (partner, child customer/workspace, SKU, legacy flag, product, quantities).
2. Attach **our price (H)** and **what we’re charging (L)** per partner × SKU (current from special pricing; legacy from Jack’s same-format export).
3. Break the partner bill **down by customer**.
4. Recreate the August bill and **diff it against Lindita’s manual August file**.
5. When the diff is acceptable, push the output into **QuickBooks** so Lindita has invoices.

A later **internal web app** (login for Hub accounting, month picker, exceptions) can sit on this loop. Do not let the UI replace Dane’s pipeline. QuickBooks is the invoice system of record he asked for.

**Out of scope until instructed:** selling this back to Coro / AppDirect / other distributors (Luke and Dane noted the play; it is not this build), Coro MCP as a required source (Luke asked; Dane said it should just have the same usage info — still missing H and L), and emailing Lindita’s workbook to partners.

---

## How to build it (Dane’s order)

This is the method. Do not skip the August proof.

### 1. Use the files we already have

Dane: we can start without the missing piece; Luke wanted enough structure that new rate files are plug-and-play.

Inputs:

- Coro **usage** (1st of month; August is in hand)
- Coro **invoices** to Hub
- **MSRP**
- **2-tier hybrid distributor agreement** (5% buffer)
- **Lindita’s August workbook** — the template to mimic (columns H and L)
- **Brandon/Jack special pricing** — current SKUs now; **legacy in the same format**, per partner per SKU, their price and our price (Lisa asking Jack/Brandon)

Luke: take the **original** delivered file and Lindita’s file and have the automation **say, based on the original file, this is something that we do** — mimic her output, internally.

### 2. Pair usage with the two prices — the key

For every usage line:

- Partner, customer (child workspace), SKU, legacy vs current, quantity
- **H = our price** (what Coro bills Hub / Hub cost)
- **L = what we’re charging** (what Hub bills the MSP)

If a partner has a special deal, use that partner’s row, not a house average. That is why Jack’s export must be **per partner, per SKU**.

Apply the **5% buffer** from the agreement when the special-pricing sheet says to (Dane’s 60% → 65% example). Do not invent a buffer Lisa did not confirm on a given row.

### 3. Recreate August against Lindita

Dane, verbatim on next steps:

> Once we get that information from Jack, we should try to **recreate the August invoice** and see any **discrepancies** we have against **Lita’s manual one**, and we’ll be able to make corrections there.

That is the acceptance test. Not a demo UI. Not a green unit test that never saw August.

When the recreation matches (or every mismatch has an explained exception: legacy $6 vs $9, unknown U/D, partner on “different stuff”), then automate.

### 4. QuickBooks

Dane: *in a perfect world, QuickBooks ingest this and be able to create invoices based off of it.*

Implementation can start with a clean export Lindita can post, then an actual QuickBooks connection. Do not skip the recreation step because the QBO API is more interesting.

### 5. Then month-end, every month

1. Coro drops usage ~1st of month into SharePoint / `data/YYYY-MM/`.
2. Confirm special pricing (current + legacy tabs) did not change, or ingest Jack’s edits (**dynamic copy**, not a stale download — Dane wanted Jack’s live edits in SharePoint).
3. Run the pipeline → proposed H/L → QuickBooks invoices.
4. Lindita reviews exceptions only, not every SKU.

---

## Source files

Location: [`data/`](data/README.md). Originals only. Do not edit in place.

| File | Role |
| --- | --- |
| `Call with Luke Barhoumeh (2).docx` | This build brief. Dane / Lisa / Luke, Sep 11, 2026. |
| `Copy of 2607-MSRP Pricing.xlsx` | List / MSRP. Not Hub cost. |
| `Coro_Invoice_INVCUS2026-0001914 (1).xlsx` | Coro → Hub invoice `1914` |
| `Coro_Invoice_INVCUS2026-0002193.xlsx` | Coro → Hub invoice `2193` — do not drop or double-count |
| `MSP Hub - Coro Hybrid Distributor Agreement (2 tier) V2 after cmnts.docx` (+ `.pdf`) | 2-tier terms, including the **5% buffer**. Dane flagged an *old agreement* in SharePoint that would only confuse the build — use V2 after comments, not a stale copy. |
| `MSP Hub_August 2026 Usage.xlsx` | August usage for all partners under Hub (the monthly 1st-of-month report) |
| Lindita’s August billing workbook | **Still needed in `data/` if not already here.** The mimic target (columns H and L). |
| Brandon/Jack special pricing | **Still needed.** Current SKU net/MSP/Hub prices; legacy in the **same format** (their price + our price, per partner per SKU). |

SharePoint remains where humans drop files. The app/pipeline reads canonical copies from `data/` (or an export). Dane also wanted the **live** special-pricing workbook linked into SharePoint so Jack’s edits are not frozen.

**Coro MCP:** Luke asked if Coro’s MCP would have billing per tenant / per MSP / per customer. Dane: it should just have *this* (usage) information. It still would not give H and L. Nice-to-have later, not the spine.

---

## Data model (so H and L can attach)

Spreadsheets stay in `data/`. Parsed tables are separate and deterministic.

| Entity | Grain | Source |
| --- | --- | --- |
| `usage_line` | month + partner + child customer/workspace + SKU | Monthly usage (usage tab) |
| `sku` | vendor SKU + class `current` \| `legacy` \| `noise` | Usage + MSRP + invoices; legacy flag Dane highlighted |
| `rate_card` | partner + SKU + period | Brandon/Jack special pricing (current and legacy tabs, same format) |
| `hub_cost` | partner + SKU → column **H** | Special pricing “our price” / what Coro bills Hub (e.g. list minus 45% on legacy, plus 5% buffer when the agreement says so) |
| `msp_price` | partner + SKU → column **L** | Special pricing “their price” / what Hub charges the MSP |
| `lindita_august_line` | partner + customer + SKU | Manual August file — **the recreation target** |
| `coro_invoice_line` | invoice number + line | `1914` and `2193` |
| `qb_invoice` | MSP + month | Output |

Rules Dane implied:

- Never assume one rate for all partners.
- Never treat MSRP as our price.
- Never treat usage quantity as optional — it is the driver.
- Unknown U/D: leave unknown.
- Legacy vs current must stay visible; Coro is migrating legacy → AI, but August still has legacy.
- Two Coro invoices in one cycle stay two invoices until proven otherwise.

---

## Reconciliation checks

After H and L are applied, before QuickBooks:

| Check | Fail means |
| --- | --- |
| Usage row with no H or L | Rate card gap (especially legacy) |
| Recreation ≠ Lindita August | The bug, or Lindita used a special deal we missed ($6 vs $9) |
| Partner on a deal not on the rate card | “Partners are on different stuff” |
| Child workspace not rolled into the parent MSP invoice | We would bill the wrong party |
| Invoice from Coro vs our H × qty | Cost disagreement with vendor |
| Legacy priced as current | Mapping error |

Accounting **accepts, reclass, or holds** exceptions. The system does not silently “fix” rates.

---

## Operating cadence (month-end)

1. Drop Coro’s packet into `data/YYYY-MM/` (usage on ~the 1st, invoices, MSRP if updated).
2. Confirm Jack/Brandon pricing (dynamic SharePoint copy).
3. Run usage → H/L → proposed partner invoices, broken down by customer.
4. First month: **recreate August vs Lindita** and correct.
5. Thereafter: Lindita reviews exceptions; QuickBooks gets the invoices.
6. Do not reuse August usage for September.

If usage is late: **do not bill as if usage were zero.** Dane’s whole machine starts from that file.

---

## Constraints (do not relitigate)

| Decision | Source |
| --- | --- |
| Replace Lindita’s manual H/L work | Dane: *this is what I want to replace* |
| Magic sauce = usage + our cost + what we charge, then QuickBooks | Dane |
| Recreate August vs Lindita before trusting automation | Dane to Luke |
| Per partner, per SKU, their price and our price | Dane to Lisa/Jack |
| Legacy export same format, separate tab | Lisa + Dane |
| 45% Coro discount on legacy (what they bill Hub) | Lisa |
| 5% buffer for Hub on top of partner discounts | Dane, from the agreement |
| Break Hub bills down by customer | Dane (Amplivity example) |
| Internal workbook; QuickBooks is what the partner gets | Dane + Luke |
| Start with files on hand; plug rates when Jack delivers | Dane / Luke |
| Accounting-first, not MSP portal | Whole call |

---

## Repository layout

```text
README.md          ← spec (this file)
data/              ← original Coro / Hub files + the call transcript
data/README.md     ← ingest rules
```

When the app is built, it lives in this repo. Do not start a second repo for “the real app.”

---

## How to run this (today)

The pipeline is **built and proven end-to-end** — but on **synthetic** fixtures
(`fixtures/synthetic/`, clearly labeled, *not* real rates), because the real Coro/
Jack/Lindita files are not in the repo yet. Per-partner **H/L come only from real
rate-card files**; nothing is hardcoded except the 5% buffer and 45% legacy discount,
both quoted from the call. It is structured for **plug-and-play**: drop the real files
in and it prices them — exactly what Luke committed to on the call.

**Live demo (synthetic data only):** https://lukebarhoumeh.github.io/coro-billing/

That is the internal Hub-accounting dashboard: Overview, Invoices, Reconcile, and
Exceptions. It runs the real pipeline in the browser over loudly-labeled synthetic
fixtures — never a real Coro close. Switch **Clean month** vs **Month with issues**
to show the August-vs-Lindita tie-out and the $6-vs-$9 / missing-rate exceptions.

GitHub Pages is published from the `gh-pages` branch. If that URL 404s, enable it
once under **Settings → Pages**: Source **Deploy from a branch**, branch
`gh-pages`, folder `/ (root)`. After that, pushes to `main` refresh the demo.

```bash
pnpm install                 # Node 20+ (22 recommended)
pnpm test                    # 131 tests, incl. the golden recreate-vs-Lindita test
pnpm typecheck               # strict TypeScript, clean

# Local dashboard (same UI as the live demo):
pnpm --dir web install
pnpm --dir web dev           # http://localhost:5173

# Once the real files land in data/YYYY-MM/ (usage, special pricing, Lindita's workbook):
npx tsx src/cli/index.ts run       --data data/2026-08 --month 2026-08 --out out/
npx tsx src/cli/index.ts reconcile --data data/2026-08 --month 2026-08   # the acceptance gate
npx tsx src/cli/index.ts export    --data data/2026-08 --month 2026-08 --format csv
# (or `pnpm build` then use the packaged `coro-billing` binary)
```

Docs: [`docs/RUNBOOK.md`](docs/RUNBOOK.md) (month-end cadence), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
(module map + contracts), [`docs/DATA_CONTRACTS.md`](docs/DATA_CONTRACTS.md) (expected
columns + rule→transcript traceability), [`docs/QUICKBOOKS.md`](docs/QUICKBOOKS.md).

---

## What happens next

Status of the build (against the spec above):

1. ✅ Parse usage + rate card (current + legacy tabs) + Lindita’s layout (columns H and L) + MSRP + the two Coro invoices — deterministic, plug-and-play column mapping.
2. ✅ Attach **H** and **L** per partner × SKU (class-aware, no house average), break the bill down **by customer**, margin follows.
3. ✅ Recreate the month and diff against Lindita (`reconcile`) — the acceptance gate, proven cent-exact on synthetic fixtures.
4. ✅ QuickBooks **export** (QBO import CSV + Desktop IIF); a documented QBO-API adapter is scaffolded (stub, not wired).
5. ⏳ **Drop the real binaries into `data/`** (Lindita’s August workbook, Jack/Brandon special pricing, the Coro usage/invoice/MSRP files) — then re-run `reconcile` for the real August-vs-Lindita tie-out.
6. ⏳ A small internal web UI for month-end exceptions (sits on top of this pipeline; does not replace it).

Nothing here guesses a rate. Until the real files are in `data/`, the numbers you see
come only from the clearly-labeled synthetic fixtures — never presented as a real close.
