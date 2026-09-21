/**
 * Pipeline configuration.
 *
 * Business constants here are the ONLY hardcoded rates in the system, and BOTH
 * are quoted directly from the Sep 11, 2026 call. Every per-partner H/L comes
 * from rate-card files at run time (never hardcoded), because Dane was explicit:
 * "all these partners are on different stuff."
 *
 * Column maps make ingestion "plug and play" (Luke: "once I get that information,
 * it's just a plug and play"): when a real Coro/Lindita/Jack file lands with
 * slightly different headers, edit the aliases here — not the parser code.
 */
import type { Period } from "../domain/types.js";

export interface BusinessConstants {
  /**
   * Hub's buffer on top of partner discounts.
   * Dane: "we should have a 5% buffer on anything ... a legacy one where they're
   * getting like a 60% discount ... we automatically should get a 65."
   */
  readonly hubBufferPct: number;
  /**
   * Coro's legacy discount off list when billing Hub.
   * Lisa: "the legacy SKU cost in that tab and 45% ... straight across the board
   * for anyone on Legacy ... This is what we bill you guys, the list price with
   * the 45% discount. And that's yours."
   */
  readonly legacyCoroDiscountPct: number;
}

export const BUSINESS: BusinessConstants = {
  hubBufferPct: 0.05,
  legacyCoroDiscountPct: 0.45,
};

/**
 * Header alias map. Each canonical field lists case-insensitive header candidates.
 * Matching is normalized (lowercased, punctuation/space-collapsed). If a real file
 * introduces a new header, add it here.
 */
export interface ColumnMap {
  readonly [canonicalField: string]: readonly string[];
}

/**
 * Coro monthly usage report (usage tab).
 *
 * Real-file headers (verified against `MSP Hub_August 2026 Usage.xlsx`, "Usage" tab):
 * `# | Parent Workspace | Workspace | Type | Sub Type | Billing Mode | Region | Audit |
 *  Product | Product Code | Metric | Quantity`. Notably:
 *   - the partner is "Parent Workspace" (a slug like `amplivitycom_NE7N_b` — see
 *     src/config/partners.ts for the slug→invoice-name map);
 *   - "Billing Mode" (LEGACY | NEW) is the legacy signal — bool() already treats the
 *     literal "legacy" as truthy, so it doubles as the legacyFlag;
 *   - each (workspace, SKU) appears TWICE (Metric = Users | Devices); the billed
 *     quantity is derived per the row's own "Audit" rule — see ingest/usageReduce.ts.
 */
export const USAGE_COLUMN_MAP: ColumnMap = {
  // "msp parent": the per-partner "…by_product" export (first seen July 2026,
  // TechLead) names the parent column "MSP Parent" instead of "Parent Workspace".
  partner: ["partner", "partner name", "reseller", "msp", "parent workspace", "msp parent"],
  customer: ["workspace", "child account", "customer", "account", "tenant"],
  sku: ["sku", "sku code", "item", "product code"],
  product: ["product", "product name"],
  quantity: ["quantity", "qty", "units", "seats", "count"],
  subtype: ["subtype", "sub type", "sub-type"],
  legacyFlag: ["legacy", "is legacy", "legacy flag", "billing mode"],
  billingFlag: ["billing", "billing flag"],
  metric: ["metric"],
  audit: ["audit"],
  wsType: ["type", "workspace type"],
  u: ["u"],
  d: ["d"],
};

/** Brandon/Jack special pricing (current + legacy tabs, "same format"). */
export const RATE_CARD_COLUMN_MAP: ColumnMap = {
  partner: ["partner", "partner name", "msp", "reseller"],
  sku: ["sku", "sku code", "item", "product code"],
  // L — what we charge the MSP:
  mspPrice: ["net price to msp", "msp price", "partner price", "their price", "price"],
  // H — our price / Hub cost:
  hubCost: ["our price", "our cost", "hub cost", "hub price", "cost"],
  discountPct: ["discount", "discount %", "discount percent", "msp hub discount"],
};

/** Lindita's manual August workbook — the recreation target (columns H and L). */
export const LINDITA_COLUMN_MAP: ColumnMap = {
  partner: ["partner", "partner name", "msp"],
  customer: ["customer", "workspace", "child account", "account"],
  sku: ["sku", "item", "product code"],
  quantity: ["quantity", "qty", "units"],
  ourPrice: ["our price", "h", "our rate", "cost"], // column H
  charge: ["what we're charging", "l", "charge", "sell", "price"], // column L
  margin: ["margin", "profit"],
};

export const MSRP_COLUMN_MAP: ColumnMap = {
  sku: ["sku", "item", "product code"],
  listPrice: ["msrp", "list price", "list", "price"],
};

/**
 * Coro → Hub invoice line items.
 *
 * Real-file headers (verified against `Coro_Invoice_INVCUS2026-0002193.xlsx`,
 * "Invoice Detail" tab; the table sits below ~14 metadata rows and readSheet's
 * header-row scoring finds it):
 * `# | MSP Parent | Start Date | End Date | Item ID | Product Name | Quantity | Rate |
 *  Discount | Subtotal | | Client Price | charge | margin | | Jul Qty | … | Note`.
 *
 * ⚠ Money semantics learned from the real 2193 file (docs/AUGUST_CLOSE_PLAN.md):
 *   - "Rate" is DISPLAY-ROUNDED; "Subtotal" is computed on the unrounded net rate.
 *     Subtotal (→ canonical `amount`) is the authoritative H total. Never bill Rate×Qty.
 *   - "Client Price" (→ `clientPrice`) is the exact L unit; charge = Client Price × Qty.
 */
export const CORO_INVOICE_COLUMN_MAP: ColumnMap = {
  sku: ["sku", "item", "product code", "item id", "description"],
  partner: ["partner", "customer", "bill to", "msp parent"],
  quantity: ["quantity", "qty", "units"],
  unitPrice: ["unit price", "rate", "price"],
  amount: ["amount", "total", "line total", "ext price", "subtotal"],
  clientPrice: ["client price"],
  chargeAmount: ["charge"],
  productName: ["product name"],
  startDate: ["start date"],
  endDate: ["end date"],
  note: ["note", "notes"],
};

export interface PipelineConfig {
  readonly period: Period;
  readonly business: BusinessConstants;
  readonly usageColumns: ColumnMap;
  readonly rateCardColumns: ColumnMap;
  readonly linditaColumns: ColumnMap;
  readonly msrpColumns: ColumnMap;
  readonly coroInvoiceColumns: ColumnMap;
  /** Cent tolerance when comparing our recreation to Lindita (0 = exact). */
  readonly reconToleratedCents?: number;
}

export function defaultConfig(period: Period): PipelineConfig {
  return {
    period,
    business: BUSINESS,
    usageColumns: USAGE_COLUMN_MAP,
    rateCardColumns: RATE_CARD_COLUMN_MAP,
    linditaColumns: LINDITA_COLUMN_MAP,
    msrpColumns: MSRP_COLUMN_MAP,
    coroInvoiceColumns: CORO_INVOICE_COLUMN_MAP,
    reconToleratedCents: 0,
  };
}

/** Normalize a header/string for tolerant matching. */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Resolve a canonical field to the actual header present in a sheet.
 * Returns the matched header string, or null if none of the aliases are present.
 */
export function resolveColumn(
  headers: readonly string[],
  aliases: readonly string[]
): string | null {
  const norm = new Map(headers.map((h) => [normalizeHeader(h), h] as const));
  for (const alias of aliases) {
    const hit = norm.get(normalizeHeader(alias));
    if (hit !== undefined) return hit;
  }
  return null;
}
