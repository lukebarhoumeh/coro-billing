# Runbook — Coro billing month-end close

Operator: **Lindita / MSP Hub accounting**. This is the concrete month-end
cadence for the Coro program. It turns the README section *"Operating cadence
(month-end)"* into steps you can follow at a desk, with the exact CLI commands.

The whole point (Dane's words): *"we get a usage report from Coro, we plug it into
this, it plugs the output into QuickBooks. And Lindita has her invoices."* You
should **not** be looking up rates by hand in a workbook anymore. The pipeline
attaches **H (our cost)** and **L (what we charge the MSP)** per partner × SKU,
breaks the partner bill down **by customer**, and hands you invoices to post in
QuickBooks. Margin follows automatically once H and L exist.

This document does not invent any step. Everything here traces to `README.md`
and `docs/ARCHITECTURE.md`.

---

## What the tool does and does not do

- **Does:** ingest Coro usage + special pricing + Lindita's file, attach H and L,
  break the bill down by customer, run reconciliation checks, recreate August
  against Lindita's manual workbook, and export QuickBooks invoices.
- **Does not:** invent a rate, average across partners, interpret U/D, silently
  drop a usage row, or treat MSRP as Hub cost. When it cannot price a line, it
  **flags an exception** — it never quietly "fixes" a rate. You (accounting)
  **accept, reclass, or hold** each exception.

If a number cannot be traced to a file in `data/` or to a written rate from
Coro's special pricing, it does not belong in the close.

---

## Prerequisites (once)

- Node.js 22+ installed.
- Dependencies installed in the repo (`pnpm install`). The CLI entry point is
  `coro-billing` (wired in `src/cli/index.ts`), invoked in this repo via the
  package's `bin`/script. If the `coro-billing` alias is not on your PATH, run it
  through the project runner (e.g. `pnpm coro-billing …` or `npx tsx src/cli/index.ts …`).
- You know the accounting **month** you are closing, written as `YYYY-MM`
  (the first target is `2026-08`, August 2026).

---

## Step 1 — Drop the Coro packet into `data/YYYY-MM/`

Coro sends a **usage report on about the 1st of every month** for all partners
underneath Hub. Put that month's files in a per-month folder so prior months are
never touched (originals only; do not edit in place — see `data/README.md`):

```text
data/
  2026-08/
    MSP Hub_August 2026 Usage.xlsx          ← the monthly 1st-of-month usage report
    Coro_Invoice_INVCUS2026-0001914.xlsx    ← Coro → Hub invoice 1914
    Coro_Invoice_INVCUS2026-0002193.xlsx    ← Coro → Hub invoice 2193 (do not drop or double-count)
    Copy of 2607-MSRP Pricing.xlsx          ← MSRP / list (reference only, NOT Hub cost)
```

Notes faithful to the spec:

- **The two Coro invoices stay two invoices** (1914 and 2193) until proven
  otherwise. Do not merge or double-count them.
- **MSRP is reference only.** It is never Hub's cost (column H).
- SharePoint remains where humans drop files; the pipeline reads the canonical
  copies from `data/`. Do not point the tool at a stale download.

**If usage is late:** do **not** bill as if usage were zero. Dane's whole machine
starts from that file — wait for the usage report or hold the close.

---

## Step 2 — Confirm the special pricing (current + legacy)

The special pricing (Brandon/Jack) carries the per-partner, per-SKU **their price
(L)** and **our price (H)**. Before running:

1. Confirm the current-SKU pricing did not change since last month, **or** ingest
   Jack's edits. Dane wanted Jack's **live edits** reflected (a dynamic SharePoint
   copy), not a frozen download.
2. Legacy SKUs live in a **separate tab/export** because Coro is still migrating
   people off legacy onto AI and those rows keep changing. Keep legacy separate;
   the pipeline classifies a sheet whose name includes "legacy" as the legacy
   class (`src/ingest/rateCard.ts`).

Until Jack's legacy export lands in `data/`, legacy partner rates are treated as
**exceptions**, not guesses. That is expected and correct — the tool will flag
those lines rather than invent a legacy rate.

Place the special-pricing workbook alongside the month's packet (or wherever the
`--data <dir>` you pass in Step 3 can reach it).

---

## Step 3 (AUGUST 2026 PATH) — The invoice-driven close

**August 2026 changed the design** (see `docs/AUGUST_CLOSE_PLAN.md`): Coro invoice
2193 arrived already carrying H (Rate/Subtotal) AND L (Client Price/charge) per
partner×SKU — it IS the pricing authority and the recreation target. The special
pricing file (Step 2) has not landed (only a SharePoint shortcut came through), and
for this close it is not needed. Run:

```bash
npx tsx src/cli/index.ts close --data data/2026-08 --month 2026-08 --invoice 2193 --invoice-date 2026-09-15
```

What `close` does: parses usage (reducing Coro's Users/Devices metric rows to billed
quantities per the file's own Audit rules, mapping workspace slugs to invoice names
via `src/config/partners.ts`) → takes H and L from the invoice per partner×SKU →
allocates each invoice line down to customers by usage weights (largest remainder —
per-customer cents ALWAYS sum to the invoice Subtotal) → prints the tie-out report →
exports the QuickBooks CSV.

The acceptance gate is printed on the first line: **allocated H + out-of-period H
must equal the invoice's Total Before Tax cent-exact** ($13,151.64 for August).
Verified 2026-09-15: ties cent-exact; 48/48 usage-covered lines tie quantity; 0 held.

Findings the August close surfaces (review, then decide):
- **Two July Rocker lines on invoice 2193** ("Jul period billed again — already on
  INV-0001914") — excluded from the August allocation, still in the invoice total.
  Raise the double-billing with Coro.
- **Vaiman: 50 seats consumed, no Coro invoice line** — Coro billed nothing; we bill
  nothing (never invent revenue); ask Coro whether the cutover missed them.
- **5 negative-margin lines** (Cyber Construction/GOA-TECH/Net-Tech BUCOCLASSflex,
  Net-Tech BUEMAILflex, Teledata BUENDflex) — L ≤ H; repricing conversation.

The legacy usage → rate-card path below (`run`/`reconcile`/`export`) remains for
when Jack's special pricing lands — it then becomes the H/L *validation* path.

---

## Step 3 (RATE-CARD PATH) — Run the pipeline (usage → H/L → proposed invoices, by customer)

```bash
coro-billing run --data data/2026-08 --month 2026-08 --out out/
```

What `run` does (per `docs/ARCHITECTURE.md`, the `src/cli/index.ts` contract):
ingest → rating (attach H and L, apply the **5% buffer** and **45% legacy
discount** only where the sheet/agreement says so) → invoicing (one invoice per
partner/MSP, lines broken down **by customer**) → reconcile checks → export. It
prints an **exception / discrepancy summary** at the end.

- `--data <dir>` — the folder holding this month's files (Step 1).
- `--month YYYY-MM` — the accounting period being closed.
- `--out out/` — where CSV/IIF exports are written (optional; defaults to `out/`).

Read the exception summary before doing anything else. Every exception is one of
the `ExceptionKind` reasons (missing H, missing L, missing rate-card row, legacy
rate unconfirmed, unknown U/D as info, zero/negative quantity, partner special
deal, cost-disagrees-with-invoice, SKU-class noise). A line with a **blocking**
exception still appears in the output with H/L = 0 and the exception attached —
**nothing is dropped silently.**

**Held lines and exit codes (important):** a line carrying a **blocking** exception
is **never posted to QuickBooks** — the tool would otherwise emit a $0 invoice line
for unpriced usage and understate the bill (README: *"do not bill as if usage were
zero"*). Instead those lines are **held**: excluded from the export and written to a
separate `coro-held-YYYY-MM.csv` next to the export, with the blocking reason. When
any line is held **or** any reconciliation check fails, `run`/`export` exit with a
**non-zero status** (so an automated close or CI notices). Resolve the held lines
(add the missing rate → reclass → re-run) before treating the export as final.

**Reproducible dates:** `run` and `export` stamp today's date (UTC) as the invoice
date by default. To reproduce a prior close byte-for-byte (or to pin a specific
date), pass `--invoice-date YYYY-MM-DD` (and optionally `--due-date YYYY-MM-DD`);
otherwise the due date is the invoice date + 30-day terms.

---

## Step 4 (FIRST MONTH ONLY) — Recreate August vs Lindita, then correct

**This gate comes before you trust any automated output.** Dane, verbatim:
*"Once we get that information from Jack, we should try to recreate the August
invoice and see any discrepancies we have against Lita's manual one, and we'll be
able to make corrections there."*

Run the recreation and read the discrepancy report:

```bash
coro-billing reconcile --data data/2026-08 --month 2026-08
```

This joins our recreation to **Lindita's manual August workbook** on
partner + customer + SKU and compares **our price (H)**, **charge (L)**, quantity,
and margin cent-exact (`Money.equalsCents`, never float `===`). The report shows:

- `matched: true` only when every row ties (within the configured cent tolerance,
  default 0) with no unexplained discrepancies and no only-in-one rows.
- `discrepancies` — each field-level mismatch, with an `explanation` where one is
  known (e.g. the legacy **$6 vs $9** landmine).
- `onlyInOurs` / `onlyInLindita` — rows present on only one side.

**"Recreate August vs Lindita first" is the acceptance test — not a demo UI, not a
green unit test that never saw August.** Do not proceed to trusting the automation
until the recreation matches, **or** every mismatch has an explained exception:

- legacy **$6 vs $9** (a partner special deal we had not captured),
- unknown **U/D**,
- a partner who is *"on different stuff"* (a special deal not yet on the rate card).

When it matches (or each mismatch is explained and accepted), the automation is
trusted for that month. From the second month on, this recreation step is not
repeated — you review exceptions only (Step 6).

---

## Step 5 — Export invoices for QuickBooks

Once the run is clean (or exceptions are resolved) and — for the first month — the
August recreation is accepted, export the invoices:

```bash
coro-billing export --data data/2026-08 --month 2026-08 --format csv
# QuickBooks Desktop instead of QBO import:
coro-billing export --data data/2026-08 --month 2026-08 --format iif
```

- `--format csv` — a QuickBooks Online import file (one row per invoice line,
  end customer/workspace in the item description — the by-customer breakdown).
- `--format iif` — a QuickBooks **Desktop** IIF file.

See **`docs/QUICKBOOKS.md`** for the exact CSV columns, how to import them into
QuickBooks Online, and the status of the live QBO API connection (not yet wired).
The invoice to the partner comes **from QuickBooks** — the internal workbook /
export is not emailed to the partner.

---

## Step 6 — Review exceptions; QuickBooks gets the invoices

Thereafter, every month:

1. Coro drops usage ~the 1st into `data/YYYY-MM/` (Step 1).
2. Confirm special pricing (current + legacy) did not change, or ingest Jack's
   edits (Step 2).
3. Run the pipeline → proposed H/L → QuickBooks invoices (Step 3, Step 5).
4. **Lindita reviews exceptions only** — not every SKU.

**Do not reuse August usage for September.** Each month reads its own usage file.

---

## How exceptions are reviewed — accept / reclass / hold

The system flags; it never silently fixes. For each exception the pipeline
surfaces, accounting takes one of three actions (README "Reconciliation checks"):

| Action | When | What it means |
| --- | --- | --- |
| **Accept** | The flag is understood and the number is right as-is | The line stands; the exception is acknowledged (e.g. an informational unknown-U/D note). |
| **Reclass** | The line was priced/classified wrong | Correct the input — add the missing partner×SKU rate to Jack's export, fix a legacy row priced as current, or fix a SKU class — then re-run. |
| **Hold** | We cannot price it yet (e.g. legacy rate unconfirmed, partner on a deal not on the rate card) | Keep the line out of the posted invoice until the rate lands; do **not** guess a rate to clear the flag. |

Reconciliation checks that can fail (README table), and what a fail means:

| Check | Fail means |
| --- | --- |
| Usage row with no H or L | Rate-card gap (especially legacy) → get the rate, then reclass. |
| Recreation ≠ Lindita August | The bug, or Lindita used a special deal we missed ($6 vs $9). |
| Partner on a deal not on the rate card | *"Partners are on different stuff"* → add the partner's row, do not house-average. |
| Child workspace not rolled into the parent MSP invoice | We would bill the wrong party → fix the roll-up. |
| Invoice from Coro vs our H × qty | Cost disagreement with the vendor → reconcile against invoice 1914/2193. |
| Legacy priced as current | Mapping error → reclass to legacy. |

Never resolve a flag by inventing a rate, averaging across partners, or
interpreting U/D. If the rate is not written down, **hold**.

---

## Quick command reference

```bash
# Invoice-driven close (August 2026 path): the Coro invoice IS the pricing authority.
# Non-zero exit if the H tie breaks or any line is held.
coro-billing close     --data data/YYYY-MM --month YYYY-MM --invoice <number> [--format csv|iif] [--invoice-date YYYY-MM-DD]

# Full month-end run via the rate card (when Jack's special pricing is present)
# Non-zero exit if any line is held (blocking exception) or any check fails.
coro-billing run       --data data/YYYY-MM --month YYYY-MM [--out out/] [--invoice-date YYYY-MM-DD] [--due-date YYYY-MM-DD]

# First month only: recreate vs Lindita and print the discrepancy report
coro-billing reconcile --data data/YYYY-MM --month YYYY-MM

# Emit QuickBooks invoices (QBO CSV import, or Desktop IIF)
coro-billing export    --data data/YYYY-MM --month YYYY-MM --format csv|iif [--invoice-date YYYY-MM-DD]
```

Files in → rates applied → QuickBooks invoices out. Margin follows. That is the
whole job.
