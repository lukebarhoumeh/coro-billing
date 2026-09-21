# Data contracts & traceability

What each real file must contain for the pipeline to price it, and where every rule
comes from in the Sep 11 2026 call (`data/Call with Luke Barhoumeh (2).docx`).

> **Real-file addendum (2026-09-15):** the actual August packet landed and its layouts
> are now encoded as column aliases in `pipeline.config.ts` and documented in
> `docs/AUGUST_CLOSE_PLAN.md`. Two headline facts: the usage file is a **two-rows-per-SKU
> metric model** (`Metric` = Users | Devices, billed qty stated in the row's own `Audit`
> string — reduced by `ingest/usageReduce.ts`), and invoice 2193's **`Subtotal` is the
> authoritative H total** (`Rate` is display-rounded; never bill `Rate × Qty`). Usage
> partners are workspace slugs mapped to invoice names by the curated table in
> `src/config/partners.ts`.

## Expected columns (edit aliases in `src/config/pipeline.config.ts`, not code)

### Coro monthly usage (`MSP Hub_August 2026 Usage.xlsx`, usage tab)
| Canonical | Meaning | Required |
| --- | --- | --- |
| partner | The MSP Hub bills (Meeting Tree, Amplivity, …) | ✅ |
| customer / workspace | End customer = child account under the partner | — (may be blank) |
| sku | Vendor SKU | ✅ |
| legacyFlag | Marks legacy SKUs — "that's an important thing to know" | — |
| product | What was consumed | — |
| subtype | "they're all subscriptions" — carried, not priced | — |
| quantity | The bill driver | ✅ |
| u, d | "I don't really know what U and D mean" — carried, never interpreted | — |

### Brandon/Jack special pricing (current + legacy tabs, "same format")
| Canonical | = column | Meaning |
| --- | --- | --- |
| partner | | per-partner (rates are NOT house-wide) |
| sku | | per-SKU |
| mspPrice | **L** | "net price to MSP" / their price — what Hub charges the MSP |
| hubCost | **H** | "our price" — what Coro bills Hub |
| discountPct | | nice-to-have; "I just need their price and our price" |

Legacy tab: cost + **45% discount** ("straight across the board for anyone on Legacy"),
kept **separate** because Coro is still changing legacy rows.

### Lindita's August workbook (the recreation target)
| Canonical | = column | Meaning |
| --- | --- | --- |
| ourPrice | **H** | our price |
| charge | **L** | what we're charging |
| margin | | "automatically calculated" once H and L exist |

Plus partner, customer, sku, quantity.

### MSRP (`Copy of 2607-MSRP Pricing.xlsx`) — reference only, never Hub cost
`sku`, `listPrice`.

### Coro → Hub invoices (`…1914`, `…2193`) — stay two invoices
`sku`, `quantity`, `unitPrice`, `amount` (+ `invoiceNumber` from filename if absent).

## Business constants (the only hardcoded rates)

| Constant | Value | Source (verbatim) |
| --- | --- | --- |
| `hubBufferPct` | 0.05 | Dane: "we should have a 5% buffer on anything … 60% … we automatically should get a 65." |
| `legacyCoroDiscountPct` | 0.45 | Lisa: "the legacy SKU cost in that tab and 45% … This is what we bill you guys, the list price with the 45% discount." |

## Rule → source map

| Rule | Source |
| --- | --- |
| Attach H and L per partner×SKU; margin follows | Dane: "these two columns are H, our price, and what we're charging L … That is the key." |
| Break the partner bill down by customer | Dane (Amplivity): "We break it down by customer." |
| No house-average rate | Dane: "all these ******* partners are on different stuff." |
| Recreate August, diff vs Lindita, correct | Dane: "recreate the August invoice and see any discrepancies … against Lita's manual one." |
| QuickBooks is the invoice system of record | Dane: "have QuickBooks ingest this and … create invoices … Lindita has her invoices." |
| Internal workbook, not emailed to partner | Luke/Dane: "not sending this out to the customer. This is for our own internal use." |
| Legacy separate & still changing | Lisa: "I would keep it separate … they are changing a lot of them." |
| The $6-vs-$9 landmine | Dane: "Brandon said you guys get this for $6, but you guys are charging us $9." |
| Structure now, plug rates when Jack delivers | Luke: "I can at least get it structured now … it's just a plug and play." |
| Use V2 agreement, not the old one | Dane: "delete this one … an old agreement that'll just confuse it." |
| U/D unknown | Dane: "I don't really know what U and D mean." |

Off-topic call content (post ~17:47: 9/11 chat, face laser, crypto bot, AI musings) is
**not** part of the spec and must not influence the build.
