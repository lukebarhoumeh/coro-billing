# `data/` — monthly Coro source packet

This folder is the raw evidence for MSP Hub accounting. Files here are **inputs**, not outputs. Do not edit originals in place. Drop new months alongside (or in a `YYYY-MM/` subfolder) and leave prior months untouched.

## Build brief (in this folder)

| File | Role |
| --- | --- |
| `Call with Luke Barhoumeh (2).docx` | Sep 11, 2026 transcript. Dane Gaston’s wording is the how-to-build. Lisa Paradis (Coro) on special pricing. Not a monthly Coro drop — do not treat it as usage. |

## Expected packet (first drop)

These are the documents Luke listed for the current cycle. Binaries belong in this folder with the original filenames.

| File | Role in reconciliation |
| --- | --- |
| `Copy of 2607-MSRP Pricing.xlsx` | Coro MSRP / list pricing. Reference for what a SKU *should* cost at list, not Hub’s cost (column H). |
| `Coro_Invoice_INVCUS2026-0001914 (1).xlsx` | Coro invoice to MSP Hub. What Coro billed Hub. |
| `Coro_Invoice_INVCUS2026-0002193.xlsx` | Second Coro invoice to MSP Hub for the same operating window. Must be tied (or split) by period, SKU, and MSP. |
| `MSP Hub - Coro Hybrid Distributor Agreement (2 tier) V2 after cmnts.docx` | Contract: 2-tier hybrid distributor terms, including the 5% buffer Dane cited. |
| `MSP Hub - Coro Hybrid Distributor Agreement (2 tier) V2 after cmnts.docx.pdf` | Same agreement as PDF. Treat as a rendering of the Word file unless a later version supersedes both. |
| `MSP Hub_August 2026 Usage.xlsx` | August 2026 usage. Coro sends this ~1st of each month for all partners under Hub. |
| Lindita’s August billing workbook | **Needed.** The mimic target: column H = our price, column L = what we’re charging. Internal only. |
| Brandon/Jack special pricing | **Needed.** Current SKUs now; legacy in the same format (per partner, per SKU, their price + our price). |

Status of this clone (2026-09-15): the **call transcript is in this folder**, and the
**real August packet is in `2026-08/`** (usage, invoices 1914 + 2193, MSRP; the agreement
PDF is in `agreement/`). All of these are **git-ignored** — proprietary Coro financial
data never leaves this machine via the repo. Still missing: **Jack's special pricing**
(`Coro Special MSP Pricing.xlsx` — only a SharePoint `.url` shortcut came through; open it
and download the real workbook) and Lindita's manual workbook (no longer blocking:
invoice 2193's Invoice Detail tab carries H and L — see `docs/AUGUST_CLOSE_PLAN.md`).

## 2026-09-22 revision (Coro's answers to the clarification letter)

Coro answered `docs/CORO_CLARIFICATIONS_2026-09-21.md` by email on 2026-09-22 and re-sent a
corrected packet (Luke dropped it in `Desktop\CoroBillingFolder`; adopted here):

- **`2026-08/Coro Special MSP Pricing(Special Pricing).csv` is the corrected sheet and the
  canonical August rate card.** The prior version is kept as
  `…(Special Pricing).superseded-2026-09-21.csv`. What changed: adds Net-Tech "BUEmail Flex"
  and Cyber Construction "Managed Coro Classic" (the two held lines), ForceTech + Rex Black
  flex rows; fixes Seven Star / DK Systems column-I errors; removes the stray "XTB" alias row.
  **Hazard we found (reported back to Coro, see `docs/CORO_REPLY_2026-09-22.md`):** on Cyber
  Construction the old "Coro Classic Flex" row (list $11.99) is now *named* "Modules Flex",
  while the true modules rate moved to "Coro Module Flex" — the engine carries a
  signature-guarded override (`src/config/productMap.ts`) until Coro fixes the labels.
- **The 2026-09-22 usage re-export was REJECTED** and archived as
  `2026-08/MSP Hub_August 2026 Usage.reexport-2026-09-22.corrupt.xlsx`: its Usage-tab Quantity
  column is the original file's values **sorted ascending** (289 cells detached from their
  rows; second broken re-export after the Sep-21 zeroed one). The original
  `MSP Hub_August 2026 Usage.xlsx` stays canonical; billed quantities come from the Audit
  strings, which are identical in both files.
- The signed distributor agreement PDF re-sent in the packet is byte-identical to
  `agreement/MSP Hub - Coro Hybrid Distributor Agreement (2 tier) V2 after cmnts.docx.pdf`
  (DocuSign-executed 7/14/2026); the MSRP workbook is byte-identical to the archived copy.

## Naming convention going forward

Keep vendor filenames when they are unique. If Coro sends another `Copy of …` or `(1)` duplicate, prefix with the invoice month:

```text
data/
  2026-08/
    Copy of 2607-MSRP Pricing.xlsx
    Coro_Invoice_INVCUS2026-0001914.xlsx
    Coro_Invoice_INVCUS2026-0002193.xlsx
    MSP Hub_August 2026 Usage.xlsx
  agreement/
    MSP Hub - Coro Hybrid Distributor Agreement (2 tier) V2 after cmnts.docx
    MSP Hub - Coro Hybrid Distributor Agreement (2 tier) V2 after cmnts.docx.pdf
```

Invoices and usage are monthly. The distributor agreement changes only when Coro or Hub signs a new version — store it once under `agreement/` and note the effective date in git history.

## What does *not* belong here

- QuickBooks invoices Hub sends *out* (outputs of the pipeline, not Coro source)
- The old distributor agreement Dane said would only confuse the build
- Off-topic chat from the call transcript (already excluded from the README spec)
