# MSP Hub → Coro Billing: open items & clarifications

**From:** MSP Hub, LLC (Disti/MSP) — accounting
**Date:** September 21, 2026
**References:** Coro Special MSP Pricing (Special Pricing) sheet; Coro invoices INVCUS2026-0001914 (Jul service) and INVCUS2026-0002193 (Aug service); MSP Hub monthly usage reports (August all-partner export; July per-partner "by product" export)

We've automated our monthly Coro close (usage × special pricing × your invoice, reconciled line by line). The automation reproduces your Aug invoice 2193 and our own outbound partner invoices to the cent, which is how the items below were found. Everything here is specific and evidence-cited — most items need only a yes/no or a corrected sheet.

---

## 1. Missing rates on the Special MSP Pricing sheet (blocking us from billing partners)

These SKUs are consuming in usage but have **no row on the named partner's block** of the pricing sheet. We hold the lines rather than guess a price. Please add rows (list price, partner net price, MSPHUB discount):

| Partner | Product / SKU | Aug 2026 usage | Impact |
| --- | --- | --- | --- |
| **Net-Tech** | Email Protection — `EMAIL_PROTECTION` / `BUEMAILflex` | **100 units** | ~$300–640/mo we currently cannot bill |
| **Cyber Construction** | Managed Coro Classic — `MANAGED_CORO_CLASSIC` / `BUCOCLASSMNflex` | **10 units** | ~$85/mo held |

## 2. Which discount applies to legacy flex SKUs? (the big one — please confirm)

The pricing sheet gives **partner-specific** discounts on legacy flex products, but your invoices 1914/2193 bill every legacy flex SKU at the **flat legacy rate: 45% off the legacy list price**, regardless of partner. Examples from invoice 2193 (Aug):

| SKU | Coro billed/unit | = legacy list × 55% | Sheet's partner-specific cost says |
| --- | --- | --- | --- |
| `MOD*flex` (modules, all partners) | $2.20 | $4.00 × 0.55 | e.g. Net-Tech $1.82–2.63 |
| `BUCOROflex` (Essentials Flex) | $4.12–4.13 | $7.50 × 0.55 | e.g. TechLead $2.63 |
| `BUCOMflex` (Complete Flex) | $8.25 | $15.00 × 0.55 | e.g. Evolve/XTB $7.13 |
| `BUCOMMNGflex` (Managed Complete Flex) | $11.00 | $20.00 × 0.55 | TechLead $9.00 |
| `BUCOCLASSMNflex` (Managed Classic Flex) | $9.34 | $16.99 × 0.55 | TechLead $7.65 |
| `BUENDflex` (Endpoint Protection Flex) | $4.12 | $7.50 × 0.55 | Teledata $2.75 |

**24 August invoice lines** are billed above the sheet's partner-specific cost this way. The consequence is real: at the sheet's partner sell prices, **four of our partners are margin-negative for us in August** — TechLead **−$359.70** (e.g. Managed Complete Flex: we bill $10.00/unit per your sheet, you charge us $11.00/unit), Evolve −$67.70, XTB Solutions −$37.76, Teledata −$3.50.

**Please confirm one of:**
(a) legacy flex SKUs are always flat 45% (then the sheet's legacy rows/discounts need correcting, and we need to revisit the partner sell prices you set on the same sheet so we're not underwater), **or**
(b) partner-specific discounts do apply to legacy SKUs (then invoices 1914/2193 over-billed us on those 24 lines and we'd like credits).

## 3. Sheet internal inconsistencies (please correct or explain)

- **Column H "Net Price to MSPHUB (5%)"** — 39 rows don't equal `Net Price to MSP × 0.95`; and per item 2, no interpretation of column H matches what you actually invoice. What is column H meant to represent?
- **Column I "Total Discount From List"** — 7 rows don't equal MSP Discount + MSPHUB Discount (e.g. Seven Star Systems shows 61% but 58% + 5% = 63%; same on DK Systems).
- **MDR (`ADDMDRflex`) and Secured Web Gateway (`ADDSECUREWEBflex`)** have no rows anywhere on the sheet. Your invoices appear to bill them at module rates ($2.20). Please confirm they price as Modules Flex, or add explicit rows.
- Cosmetic: a stray name-only row "XTB" sits above "XTB Solutions".

## 4. Invoice INVCUS2026-0002193 (Aug) specifics

- **Rocker, two lines (Jul 1–31 service)** are on 2193 *and* were billed on 1914 ($153.31 total) — your own line note says "Jul period billed again — already on INV-0001914." Please confirm the credit/adjustment.
- **Ideal Tech Help, Coro AI Lite: 38 → 371 seats** July→August (2193's note says "confirm"). Is 371 correct?
- Partner naming: the same partner appears as **"Avox"** on the pricing sheet, **"AVOX LLC"** on invoice 2193, and workspace `vaimancom_QVJ8_b` in usage. We reconcile these, but consistent naming (or a workspace-ID column on invoices) would remove a failure mode for everyone.

## 5. Usage report format & data quality

- **Two export formats are in circulation**: the all-partner monthly file (`MSP Hub_<Month> Usage.xlsx`, Users/Devices metric rows + Audit strings, parent column "Parent Workspace") and the per-partner file (`…Usage_<Month>_by_product.xlsx`, single billed-quantity rows, parent column "MSP Parent"). We support both — please confirm the all-partner monthly file remains the canonical ~1st-of-month delivery, and keep column names stable.
- A re-export of the August file zeroed the per-row Quantity column on the Usage tab (the Audit strings still carry the quantities, which we use). Was that intentional?
- **8 rows in August have self-contradictory Audit strings** — the stated rule doesn't produce the stated quantity (e.g. Meeting Tree `MANAGED_CORO=2 [users]` on a workspace with users=0, devices=2; similar on IT Network `CORO_AI_ENDPOINT=9 [devices]` with devices=15). We bill the stated quantity. Please confirm the stated quantity always governs.
- **NFR**: `COR-COMP-NFR` (Hurricane IT) — confirm NFR workspaces are never billable.

---

### Summary of asks

1. Add the two missing partner rate rows (Net-Tech Email Protection; Cyber Construction Managed Classic).
2. Rule on legacy flex pricing: flat 45% vs partner-specific (and credits or sheet corrections accordingly).
3. Fix/explain sheet columns H and I; add MDR + Secured Web Gateway rows or confirm Modules Flex pricing.
4. Confirm the Rocker July double-bill credit and the Ideal Tech 371-seat jump.
5. Confirm the canonical usage export format, the audit-quantity rule, and NFR non-billing.
