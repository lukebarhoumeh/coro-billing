# MSP Hub — Coro billing automation

This repository is the working home for **MSP Hub accounting** on the Coro program.

Coro is a new vendor. Hub is acting as a **two-tier distributor**: Coro sells consumption-based cybersecurity licenses to Hub; Hub sells those licenses to MSPs on the MSP Hub platform; those MSPs extend the product to *their* customers. The commercial chain is simple. The monthly paper is not.

The near-term deliverable in this repo is documentation plus a `data/` folder of the actual monthly files. The later deliverable is a small web app the accounting team can log into and use at month-end to reconcile and bill. That app is **not** in this commit.

---

## Who this is for

Primary users: **MSP Hub accounting**.

They are not asking for another sales dashboard. They need a trustworthy month-end close for one vendor:

1. What did Coro bill Hub?
2. What usage actually happened?
3. What are we allowed and supposed to bill each MSP?
4. How does that compare to what MSPs should bill their end customers?
5. Where are the SKU, price, and quantity mismatches?

If a number cannot be traced to a file in `data/` or to a written contract term, it does not belong in the close.

---

## Commercial model

```text
Coro  --(licenses + invoices to Hub)-->  MSP Hub (distributor)
                                              |
                                              |  Hub bills MSPs
                                              v
                                         MSP on the platform
                                              |
                                              |  MSP bills their customer
                                              v
                                         End customer (consumption)
```

**Coro** sells consumption-based cybersecurity for MSPs. Usage (seats, endpoints, modules — the exact unit of measure lives in the usage file and the invoice lines, not in this paragraph) drives cost.

**MSP Hub** is the distributor. The governing document is the *MSP Hub – Coro Hybrid Distributor Agreement (2 tier)* (Word + PDF in `data/`). “Hybrid” and “2 tier” matter: Hub is not the MSP of record for the end customer. Hub’s customer is the MSP. The MSP’s customer is the business that actually consumes Coro.

**MSPs** buy through Hub and extend Coro to end customers. They have their own billing relationship downstream. Hub still needs to know that downstream picture because:

- usage is often recorded at customer or tenant grain
- SKU names on Coro invoices, MSRP, usage, and MSP quotes do not always match
- “what we charged” and “what we were supposed to charge” have already drifted

**Costs from Coro to Hub are not disclosed in this repo yet.** That is intentional. The invoice files tell Hub what Coro *invoiced*. They do not automatically tell accounting Hub’s true unit cost, margin, or the MSP sell price. Until a cost schedule is added (under access control), the system must treat cost as a separate, missing input — not something to reverse-engineer from MSRP.

---

## The problem

Billing on this program is noisy. Accounting is being asked to close a month from a pile of spreadsheets and a contract, while four different “truths” disagree.

### 1. SKU noise

The same commercial thing shows up under different codes, descriptions, and bundles:

- **Current SKUs** — what Coro sells now, and what new MSP deals should use
- **Legacy SKUs** — older codes still on invoices, usage, or customer records
- **Noise** — credits, one-time lines, tax, rounding, internal/test tenants, duplicate invoice attachments (`(1)` on a filename), rows that look like products but are not billable

Until those three buckets are explicit, every pivot table is an argument.

### 2. Price noise

There are at least four price layers, and they are not interchangeable:

| Layer | Who it is for | What we have today |
| --- | --- | --- |
| MSRP / list | Catalog reference | `Copy of 2607-MSRP Pricing.xlsx` |
| Coro → Hub cost | Distributor cost | **Not disclosed yet** |
| Hub → MSP bill-out | What accounting must invoice MSPs | Not systematized; this is the gap |
| MSP → end customer | What the MSP should charge their customer | Implied by usage + contract + MSP practice; not a clean Hub file |

Closing the month off MSRP alone will be wrong. Closing only off the Coro invoice will also be wrong if usage and billable quantities diverge.

### 3. Quantity / usage noise

Hub expects a **usage report** every month. That file is the missing piece of the operating rhythm — “they send us every month” the invoices, MSRP, agreement copies, and (when it arrives) usage.

We already have **`MSP Hub_August 2026 Usage.xlsx`**. That is the starting usage baseline. Later months still need a dedicated ingest slot so August does not get overwritten and so “no usage file yet” is a visible exception, not a silent zero.

### 4. Document noise

The first packet is typical of how this will keep arriving:

- Two Coro invoices in one cycle: `INVCUS2026-0001914` and `INVCUS2026-0002193`
- MSRP saved as “Copy of …”
- The distributor agreement in **both** `.docx` (with comments) and `.pdf`
- Duplicate or near-duplicate names

SharePoint is the planned **human** aggregation point for “all the files in one place.” That does not solve matching, SKU mapping, or calculating the bill. It only solves finding the files.

### 5. What we were supposed to charge

This is the actual accounting failure mode:

> We know something got invoiced. We do not reliably know whether the SKU, the MSP, the quantity, and the rate match the agreement and the usage.

So the system cannot be “import the Coro invoice and rebill it.” It has to be **reconcile, then bill**:

- Coro invoice lines vs usage
- usage vs entitled / contracted SKUs
- Hub bill-out vs both of the above
- optional check: MSP-to-customer charges vs what the program says they should charge

Anything that does not match becomes an exception for a human. Anything that matches becomes the month’s bill.

---

## Goal

**Month-end, accounting logs into a simple web app and finishes Coro.**

Concretely, for a given month (example: August 2026):

1. See which source files were ingested (invoices, MSRP, usage, agreement version).
2. See Hub’s Coro spend as invoiced, by SKU and by MSP where the invoice supports it.
3. See usage vs invoice vs proposed Hub bill-out.
4. Map legacy / current / noise SKUs instead of pretending they are one list.
5. Produce the MSP invoices (or an export accounting can post) for what Hub should charge.
6. Flag the rest: missing usage, unknown SKU, rate mismatch, quantity mismatch, MSP with usage and no invoice, invoice with no usage.

Login is required because this is accounting data, even when Coro cost is still unpublished. Do not build a public site.

**Out of scope for this repo right now:** the app itself, identity provider, SharePoint automation, and any guessed cost sheet. This commit is the problem statement and the `data/` drop zone.

---

## Source files (what Coro / the program actually sends)

Planned location: [`data/`](data/README.md).

| File | Month / version | What accounting uses it for |
| --- | --- | --- |
| `Copy of 2607-MSRP Pricing.xlsx` | Price list (filename `2607` — treat as a dated catalog, confirm inside the sheet) | Map SKU → list price; detect unknown SKUs; never treat as Hub cost |
| `Coro_Invoice_INVCUS2026-0001914 (1).xlsx` | Coro invoice `INVCUS2026-0001914` | Money Coro billed Hub; line-level SKUs, quantities, amounts |
| `Coro_Invoice_INVCUS2026-0002193.xlsx` | Coro invoice `INVCUS2026-0002193` | Same, second invoice. Must not be double-counted or dropped |
| `MSP Hub - Coro Hybrid Distributor Agreement (2 tier) V2 after cmnts.docx` | Agreement V2, after comments | Billing rights, tiers, definitions, SKU/program rules |
| Same title `.pdf` | Rendering of the above | Read-only companion for reviewers without Word |
| `MSP Hub_August 2026 Usage.xlsx` | August 2026 usage | Who used what. The report accounting said we were missing as a monthly habit |

When more invoices, usage extracts, or a cost schedule arrive, they go in `data/` (see the folder README). They do not go in Slack as the system of record.

**SharePoint:** the team will aggregate a lot of this into a SharePoint file. That is fine as a shared drive. The app should still ingest from a canonical `data/` (or an export from SharePoint), not scrape the SharePoint UI.

---

## A practical way to solve it

Do not start with a platform. Start with a **month-end pipeline** that a later UI can sit on.

### Phase 0 — this repository (now)

- Problem, goal, and method written down (this file)
- Raw monthly packet in `data/`
- A written SKU and file convention so the next drop does not start from zero

### Phase 1 — normalize, do not bill yet

Ingest each file type into boring tables. Spreadsheets stay in `data/`; parsed output is separate (database, warehouse, or even versioned CSV — the important part is that parsers are deterministic).

Suggested grains:

| Entity | Grain | Source |
| --- | --- | --- |
| `sku_catalog` | vendor SKU code | MSRP + invoice + usage + agreement notes |
| `sku_map` | from_code → canonical_code, class = `current` \| `legacy` \| `noise` | Maintained by accounting, not inferred once and forgotten |
| `coro_invoice_line` | invoice number + line | The two `.xlsx` invoices |
| `usage_line` | month + MSP + customer/tenant + SKU | Usage workbook |
| `msp` | Hub MSP account | Usage, invoices, Hub’s own MSP list (when attached) |
| `end_customer` | MSP’s customer | Usage, if present |
| `contract_term` | agreement version + effective date | The 2-tier hybrid agreement |

Rules:

- Never collapse the two Coro invoices until you have proven they are not overlapping.
- Never assume MSRP is cost.
- Never assume usage quantity equals invoice quantity.
- Unknown SKU is an exception, not a dropped row.

### Phase 2 — reconcile

For each month, produce three aligned views at SKU + MSP grain (and customer grain when usage has it):

1. **Invoiced by Coro** — from invoice lines
2. **Used** — from the usage report
3. **Billable by Hub** — from contract + current SKU map + (later) Hub’s rate card to MSPs

Then compute variances:

| Check | Fail means |
| --- | --- |
| Usage SKU not in catalog | SKU map gap |
| Invoice SKU not in catalog | Coro billed a code we cannot price downstream |
| Usage quantity ≠ invoice quantity | Consumption vs vendor bill disagreement |
| Invoice amount ≠ qty × expected rate | Rate or discount problem (expected rate may still be unknown if cost/sell are missing) |
| Usage with no invoice | Unbilled by Coro, or wrong month |
| Invoice with no usage | Vendor bill without evidence, or usage file late |
| Legacy SKU still billed as if current | Mapping / commercial cleanup |
| Noise SKU on an MSP bill | We would pass garbage to an MSP |

Accounting’s job in the app is to **accept, reclass, or hold** each exception. The system does not silently “fix” rates.

### Phase 3 — bill the MSPs

Only after Phase 2 is green (or exceptions are explicitly waived):

- Generate Hub → MSP invoice lines: MSP, SKU (current code), quantity, rate, amount, period
- Keep the audit: which Coro invoice lines and usage lines justified each Hub line
- Export: Excel/CSV for the current accounting tool, then (later) post from the app

MSP → end-customer billing stays the MSP’s responsibility. Hub still reports “what they were supposed to charge” as a **compliance / program** view, not as Hub revenue.

### Phase 4 — the accounting web app

A small internal app. One purpose: Coro month-end.

Suggested screens (when we are told to build it):

1. **Sign in** — Hub staff only
2. **Month** — pick `2026-08`, see file checklist (invoice 1914, invoice 2193, MSRP, usage, agreement version)
3. **Reconciliation** — invoiced vs used vs billable, with filters for MSP and SKU class
4. **SKU map** — current / legacy / noise, editable by accounting
5. **Exceptions** — queue with state (open / waived / corrected)
6. **Bill run** — proposed MSP invoices, then export or post

No extra products, no extra vendors, no second component library debate until this loop is real.

### Why not “just SharePoint”?

SharePoint can hold the files. It cannot:

- join two invoices to one usage month without double counting
- remember that a legacy SKU is the same product as a current SKU
- apply a rate we do not have yet without someone typing it
- produce a repeatable bill run next month

The app reads the same files SharePoint holds. SharePoint remains the dump. This repo (and later the app) is the **close**.

---

## Operating cadence (month-end)

1. Drop Coro’s packet into `data/YYYY-MM/` (invoices, MSRP if updated, usage).
2. Confirm agreement version did not change; if it did, store the new V* next to the old one.
3. Ingest → normalize SKUs → reconcile.
4. Accounting works the exception queue.
5. Freeze the bill run.
6. Export Hub → MSP invoices.
7. Archive the month; do not reuse August usage as a stand-in for September.

If usage is late: **do not bill as if usage were zero.** Mark the month `usage_missing` and wait or bill off a written fallback policy (none is defined here until accounting writes one).

---

## Constraints and decisions (so we do not relitigate them)

| Decision | Why |
| --- | --- |
| Accounting-first, not MSP-portal-first | The pain is Hub close, not MSP UX |
| Cost is a separate input | Coro cost is not disclosed yet; MSRP is not a substitute |
| Two invoices in one month are first-class | `1914` and `2193` both exist; dropping one is a close error |
| Usage is required | Called out as the missing monthly report; August 2026 is the first copy |
| SKU classes are explicit | Current vs legacy vs noise |
| App comes after files + README | This commit only |

---

## Repository layout

```text
README.md          ← you are here
data/              ← original Coro / program files only
data/README.md     ← ingest rules and the expected first packet
```

When the app is approved, it should live in this same repository unless accounting asks otherwise. Do not stand up a second repo for “the real app.”

---

## How to run this (today)

There is nothing to run. Clone the repo, put originals in `data/`, and treat this README as the spec.

```bash
git clone <this-repo-url>
cd <repo>
ls data
```

---

## What happens next

Luke will add more documents as they arrive (further invoices, later usage, cost once it can be shared). Next build step, when instructed:

1. Parse the workbooks in `data/` into a SKU inventory and a first August 2026 recon (even if it is a spreadsheet output).
2. Then the accounting web app for login + month-end workflow.

Until those instructions, do not scaffold the app.
