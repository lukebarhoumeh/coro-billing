# QuickBooks export & connection

How the pipeline hands invoices to QuickBooks, and the status of the live QBO API
connection. QuickBooks is the **invoice system of record** Dane asked for:
*"we get a usage report from Coro, we plug it into this, it plugs the output into
QuickBooks. And Lindita has her invoices."*

The invoice to the partner comes **from QuickBooks** — the internal export file is
**not** emailed to the partner (Luke/Dane: *"not sending this out to the customer.
This is for our own internal use."*).

All export code lives in **`src/export/quickbooks.ts`** (the module contract is in
`docs/ARCHITECTURE.md`). This document describes what that module produces and how
you use it.

---

## Two export formats

The pipeline emits invoices in two forms so you can use whichever QuickBooks
edition Hub runs:

| Format | For | Function (`src/export/quickbooks.ts`) |
| --- | --- | --- |
| **CSV** | QuickBooks **Online** (QBO) invoice import | `toQuickBooksCsv(invoices, opts?)` → `string` |
| **IIF** | QuickBooks **Desktop** | `toIif(invoices, opts?)` → `string` |

Both are produced from the same `QbInvoice[]` — one invoice **per partner (MSP)**
for the period, with lines broken down **by customer** (the Amplivity example
Dane gave). You choose the format at the CLI:

```bash
coro-billing export --data data/2026-08 --month 2026-08 --format csv
coro-billing export --data data/2026-08 --month 2026-08 --format iif
```

Optional export options (`opts`): `invoiceDate` (YYYY-MM-DD), `dueDate`
(YYYY-MM-DD), and `termsDays`. Dates are injected at the export boundary, never
inside the pure pipeline (determinism: same inputs → same output).

---

## CSV format (QuickBooks Online import)

The CSV follows the common QBO **3-line invoice import** layout: one CSV row per
**invoice line**, and QBO groups rows into invoices by the shared `InvoiceNo` +
`Customer`.

### Exact columns (in order)

| # | Column | Value |
| --- | --- | --- |
| 1 | `InvoiceNo` | Invoice number for this partner's monthly invoice |
| 2 | `Customer` | **The MSP** (the partner Hub bills) — QBO groups lines by this |
| 3 | `InvoiceDate` | YYYY-MM-DD (from `opts.invoiceDate`) |
| 4 | `DueDate` | YYYY-MM-DD (from `opts.dueDate` / `opts.termsDays`) |
| 5 | `Item(Product/Service)` | The SKU / product-service item |
| 6 | `ItemDescription` | **The end customer / workspace** — the by-customer breakdown Dane wants |
| 7 | `ItemQuantity` | Quantity (the bill driver) |
| 8 | `ItemRate` | **L** — what we're charging the MSP, per unit |
| 9 | `ItemAmount` | L × quantity for the line |

Key mapping to remember:

- **`Customer` = the MSP** (Amplivity, Meeting Tree, …). Hub's customer is the
  partner, not the end customer.
- **The end customer/workspace goes in `ItemDescription`** so each partner invoice
  is still broken down by customer, exactly as Dane described.
- **`ItemRate` = L** (what Hub charges the MSP). Hub's cost (H) is internal and is
  **not** placed on the outbound invoice — it stays in the pipeline for margin and
  reconciliation only.

### How to import into QuickBooks Online

1. In QuickBooks Online, go to **Settings (gear) → Import Data → Invoices**
   (or **New → Import invoices**, depending on the QBO edition).
2. Upload the CSV produced by `coro-billing export … --format csv`
   (written under `out/` by default).
3. On the **field-mapping** screen, map QBO's fields to the CSV columns above.
   Because the headers use the standard 3-line names (`InvoiceNo`, `Customer`,
   `InvoiceDate`, `DueDate`, `Item(Product/Service)`, `ItemDescription`,
   `ItemQuantity`, `ItemRate`, `ItemAmount`), most map automatically.
4. Ensure the **partner (MSP)** exists as a Customer in QBO and each **SKU** exists
   as a Product/Service item, or let the import create them per your QBO settings.
5. Review the import preview — QBO groups the rows into one invoice per
   `InvoiceNo` + `Customer` — then confirm the import.

Result: Lindita has the month's partner invoices in QuickBooks, each broken down
by customer in the line descriptions.

---

## IIF format (QuickBooks Desktop)

`toIif(invoices, opts?)` produces a QuickBooks **Desktop** `.iif` file. IIF is the
tab-delimited transaction format QuickBooks Desktop imports via
**File → Utilities → Import → IIF Files**. Use `--format iif` when Hub runs
QuickBooks Desktop rather than Online. The same one-invoice-per-partner,
lines-by-customer breakdown applies.

---

## The QuickBooks adapter (programmatic export)

`src/export/quickbooks.ts` also defines an adapter interface so a `run`/`export`
flow can push invoices without a manual file upload:

```ts
export interface QuickBooksAdapter {
  createInvoices(invoices: QbInvoice[]): Promise<{ created: number; ids: string[] }>;
}
```

Two implementations:

- **`CsvQuickBooksAdapter`** — writes the CSV above to `out/`. This is the
  supported path today: run the pipeline, get a CSV, import it into QuickBooks.
- **`ApiQuickBooksAdapter`** — the live QBO API path. **NOT YET WIRED** (see below).

---

## Live QuickBooks Online API connection — NOT YET WIRED

> **Status: NOT YET WIRED.** `ApiQuickBooksAdapter` is a **documented stub**. It
> throws `NotConfigured` until the QBO connection is implemented. Do not rely on it
> in production, and it must never run in tests.

The plan for the live connection, when it is built:

1. **OAuth2** — QuickBooks Online uses OAuth 2.0. Hub registers an app in the
   Intuit developer portal, obtains a client id/secret, and completes the
   authorization-code flow to get an access token + refresh token. **Secrets are
   never hardcoded** and never committed — they come from environment/config at
   runtime.
2. **`realmId`** — the QBO company (Hub's books) is identified by its `realmId`,
   captured during the OAuth grant and sent with every API call.
3. **`Invoice` entity** — invoices are created via the QBO **Invoice** entity.
   Each `QbInvoice` maps to one Invoice: `Customer` = the MSP, one `Line` per
   customer-broken-down usage line with the SKU as the item and **L** as the rate.
4. **Verify before wiring** — the exact QBO Invoice request shape must be verified
   against **live docs** (Context7 `intuit/quickbooks` or developer.intuit.com)
   before implementation, per the architecture note. A clear `TODO(verify)` with
   the doc link is left in `src/export/quickbooks.ts` where the adapter is stubbed.

Until this is wired, the operating path is: **export CSV (or IIF) → import into
QuickBooks** (see the RUNBOOK, Step 5). Dane's stated sequencing is to start with a
clean export Lindita can post, then add the actual QuickBooks connection — and to
**not** skip the August recreation just because the QBO API is more interesting.

---

## Cross-references

- **`src/export/quickbooks.ts`** — the export module (CSV / IIF / adapters).
- **`docs/ARCHITECTURE.md`** — the exact function signatures and CSV column
  contract this document describes.
- **`docs/RUNBOOK.md`** — the month-end steps, including when to export and how
  exceptions are reviewed.
