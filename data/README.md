# `data/` — monthly Coro source packet

This folder is the raw evidence for MSP Hub accounting. Files here are **inputs**, not outputs. Do not edit originals in place. Drop new months alongside (or in a `YYYY-MM/` subfolder) and leave prior months untouched.

## Expected packet (first drop)

These are the documents Luke listed for the current cycle. Binaries belong in this folder with the original filenames.

| File | Role in reconciliation |
| --- | --- |
| `Copy of 2607-MSRP Pricing.xlsx` | Coro MSRP / list pricing. Reference for what a SKU *should* cost at list, not Hub’s confidential distributor cost. |
| `Coro_Invoice_INVCUS2026-0001914 (1).xlsx` | Coro invoice to MSP Hub. What Coro billed Hub. |
| `Coro_Invoice_INVCUS2026-0002193.xlsx` | Second Coro invoice to MSP Hub for the same operating window. Must be tied (or split) by period, SKU, and MSP. |
| `MSP Hub - Coro Hybrid Distributor Agreement (2 tier) V2 after cmnts.docx` | Contract: 2-tier hybrid distributor terms, comments included. Source of truth for who may be billed, how, and at what construct. |
| `MSP Hub - Coro Hybrid Distributor Agreement (2 tier) V2 after cmnts.docx.pdf` | Same agreement as PDF for people who cannot open `.docx`. Treat as a rendering of the Word file unless a later version supersedes both. |
| `MSP Hub_August 2026 Usage.xlsx` | August 2026 usage. The usage report is the known gap in the monthly rhythm; this file is the first usage drop we actually have. |

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

- Hub’s unpublished Coro cost sheet (when it arrives, it needs a restricted location, not this folder by default)
- MSP invoices Hub sends *out* (those are outputs of billing, not Coro source)
- SharePoint working files, unless they are a canonical monthly export
