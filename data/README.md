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

Status of this clone: **catalog only until the binaries are copied in.** If a filename above is missing from `data/`, it did not transfer with the chat attachments and still needs to be dropped in.

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
