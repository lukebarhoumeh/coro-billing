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

/** Coro monthly usage report (usage tab). */
export const USAGE_COLUMN_MAP: ColumnMap = {
  partner: ["partner", "partner name", "reseller", "msp"],
  customer: ["workspace", "child account", "customer", "account", "tenant"],
  sku: ["sku", "sku code", "item", "product code"],
  product: ["product", "product name"],
  quantity: ["quantity", "qty", "units", "seats", "count"],
  subtype: ["subtype", "sub type", "sub-type"],
  legacyFlag: ["legacy", "is legacy", "legacy flag"],
  billingFlag: ["billing", "billing flag"],
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

export const CORO_INVOICE_COLUMN_MAP: ColumnMap = {
  sku: ["sku", "item", "product code", "description"],
  partner: ["partner", "customer", "bill to"],
  quantity: ["quantity", "qty", "units"],
  unitPrice: ["unit price", "rate", "price"],
  amount: ["amount", "total", "line total", "ext price"],
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
