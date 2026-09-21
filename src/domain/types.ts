/**
 * Domain model for the Coro billing close.
 *
 * Every entity maps to the README "Data model (so H and L can attach)" table
 * and to Dane/Lisa's wording in data/Call with Luke Barhoumeh (2).docx.
 * These types are the FIXED CONTRACT: parsers produce them, rating/invoicing/
 * reconciliation consume them. Do not widen types to paper over dirty data —
 * surface it as an Exception instead (accounting "accepts, reclass, or holds").
 */
import type { Money } from "../lib/money.js";

/** Accounting period, always "YYYY-MM" (e.g. "2026-08"). The first target is August 2026. */
export type Period = string;

/**
 * SKU class. Dane: "legacy, that's an important thing to know." Coro is migrating
 * legacy -> AI, but August still has legacy. "noise" is for rows that are neither
 * a clean current nor legacy SKU and must be reviewed, not silently priced.
 */
export type SkuClass = "current" | "legacy" | "noise";

/**
 * A value Dane explicitly said he does not understand ("I don't really know what
 * U and D mean"). We NEVER invent meaning. We carry the raw value and flag it.
 */
export type UnknownField = {
  readonly raw: string | number | null;
  readonly known: false;
};

/** A vendor SKU as understood from usage + MSRP + invoices. */
export interface Sku {
  readonly vendorSku: string;
  readonly class: SkuClass;
  /** True when the usage/invoice row is flagged legacy. Kept visible per spec. */
  readonly isLegacy: boolean;
  readonly product?: string;
  readonly description?: string;
}

/**
 * One line of Coro's monthly usage report (the ~1st-of-month delivered file).
 * Grain: month + partner + child customer/workspace + SKU.
 * "Partner" = Hub's MSP (Meeting Tree, Amplivity...). "customer" = child workspace.
 */
export interface UsageLine {
  readonly period: Period;
  /** The MSP Hub bills (Meeting Tree, Amplivity, ...). */
  readonly partner: string;
  /** End customer = child account / workspace under the partner. May be blank for partner-level rows. */
  readonly customer: string | null;
  readonly sku: Sku;
  /** The driver of the bill. Never optional (README: "usage quantity ... is the driver"). */
  readonly quantity: number;
  /** "Doesn't really matter, they're all subscriptions" — carried, not used to price. */
  readonly subtype?: string;
  /** What was actually consumed. */
  readonly product?: string;
  /**
   * Real Coro usage metric row label ("Users" | "Devices"). The August 2026 file
   * carries each (workspace, SKU) TWICE, once per metric; the billed quantity is
   * derived per the row's own `audit` rule (ingest/usageReduce.ts). Absent on
   * synthetic/legacy-format files.
   */
  readonly metric?: string;
  /**
   * Coro's own audit string, e.g. "LEGACY | u=13 d=14 | CORO_ESSENTIALS=14
   * [math.max(users, devices)]". States the billed quantity AND the reduction rule
   * per product — the closest thing to Coro's rating spec we have. Carried verbatim.
   */
  readonly audit?: string;
  /** Workspace row type ("CHANNEL" = the partner's own workspace, "CHILD" = end customer). */
  readonly wsType?: string;
  /** Dane: "I don't really know what U and D mean." Carried, never interpreted. */
  readonly u: UnknownField;
  readonly d: UnknownField;
  /** Original row for traceability back to the source file. */
  readonly raw: Record<string, unknown>;
  /** 1-based row number in the source sheet, for error messages / audit. */
  readonly sourceRow: number;
}

/** Coro MSRP / list pricing. Reference only — NEVER treated as Hub cost. */
export interface MsrpEntry {
  readonly sku: string;
  readonly listPrice: Money;
  readonly raw: Record<string, unknown>;
}

/**
 * A single line on a Coro -> Hub invoice (1914, 2193).
 *
 * Real-file semantics (docs/AUGUST_CLOSE_PLAN.md, facts 1–2):
 *   - `amount` (the "Subtotal" column) is the AUTHORITATIVE H total — Coro computes
 *     it on the unrounded net rate, so `unitPrice * quantity` may differ by cents.
 *   - `clientPrice` is the exact L unit (what Hub bills the MSP); `chargeAmount` is
 *     the sheet's L total. `clientPrice === null` means the cell was blank (L
 *     unresolved — held, never fabricated); `undefined` means the column is absent
 *     entirely (e.g. invoice 1914's simpler layout).
 */
export interface CoroInvoiceLine {
  readonly invoiceNumber: string;
  readonly lineNumber: number;
  readonly sku: string;
  readonly partner?: string;
  readonly customer?: string | null;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly amount: Money;
  readonly period?: Period;
  /** L unit ("Client Price"). null = blank cell (unresolved); undefined = column absent. */
  readonly clientPrice?: Money | null;
  /** The sheet's own L total ("charge"), used to cross-check clientPrice × quantity. */
  readonly chargeAmount?: Money | null;
  /** Product display name ("Product Name"), for invoice-line descriptions. */
  readonly productName?: string;
  /** Line service window as ISO dates (from "Start Date"/"End Date"), when present. */
  readonly startDate?: string;
  readonly endDate?: string;
  /** The month the line's service window falls in ("YYYY-MM"), derived from startDate. */
  readonly servicePeriod?: Period;
  /** Free-text note keyed on the line (e.g. "Jul period billed again"). */
  readonly note?: string;
  readonly raw: Record<string, unknown>;
}

/**
 * One rate-card row from Brandon/Jack's special pricing (current + legacy tabs,
 * "same format"). Dane's key: per partner, per SKU, their price AND our price.
 *
 *   hubCost  = H = "our price" / what Coro bills Hub (list - 45% on legacy; may
 *              include the +5% buffer where the agreement says so)
 *   mspPrice = L = "what we're charging" / net price to the MSP partner
 *
 * discountPct is nice-to-have (Dane: "if you want to put the discount percentage
 * in there, that's cool ... I just need their price and our price").
 */
export interface RateCardEntry {
  readonly partner: string;
  readonly sku: string;
  readonly period: Period;
  readonly class: SkuClass;
  /** H — our price / Hub cost. */
  readonly hubCost: Money;
  /** L — what we're charging the MSP. */
  readonly mspPrice: Money;
  readonly discountPct?: number;
  /** Where this rate came from ("current" tab, "legacy" tab, or a filename). */
  readonly source: string;
  /** True when the +5% Hub buffer was applied to derive hubCost. */
  readonly bufferApplied?: boolean;
  readonly raw: Record<string, unknown>;
}

/**
 * An index over RateCardEntry rows with partner+SKU+period lookup. Implemented in
 * the rating module. Lookups NEVER fall back to a house average — Dane: "all these
 * partners are on different stuff." A miss returns null and becomes an Exception.
 */
export interface RateCard {
  /**
   * Look up the rate for a partner+SKU at a period. When `klass` is supplied and the
   * partner+SKU bucket holds both a current and a legacy row, the class-matching row
   * is preferred (a legacy usage line prices from the legacy tab), so a legacy line
   * can never be silently priced from a current row — Dane's "$6 vs $9" landmine.
   * A miss returns null — NEVER a house/average or cross-partner fallback.
   */
  lookup(partner: string, sku: string, period: Period, klass?: SkuClass): RateCardEntry | null;
  readonly entries: readonly RateCardEntry[];
}

/** A row of Lindita's manual August workbook — the recreation TARGET. */
export interface LinditaLine {
  readonly period: Period;
  readonly partner: string;
  readonly customer: string | null;
  readonly sku: string;
  readonly quantity: number;
  /** Column H — our price. */
  readonly ourPrice: Money;
  /** Column L — what we're charging. */
  readonly charge: Money;
  /** Margin as she has it; recomputed and cross-checked (margin "follows"). */
  readonly margin?: Money;
  readonly raw: Record<string, unknown>;
  readonly sourceRow: number;
}

/** Why a usage line could not be cleanly priced / needs human review. */
export type ExceptionKind =
  | "MISSING_HUB_COST" // no H on the rate card for this partner+SKU
  | "MISSING_MSP_PRICE" // no L
  | "MISSING_RATE_CARD_ROW" // partner+SKU not present at all (esp. legacy)
  | "LEGACY_RATE_UNCONFIRMED" // legacy row still changing / not in Jack's export yet
  | "UNKNOWN_UD_FIELD" // U/D present but meaning unknown (informational)
  | "NEGATIVE_OR_ZERO_QTY"
  | "PARTNER_SPECIAL_DEAL" // matched an exception rate, flagged for visibility
  | "COST_DISAGREES_WITH_INVOICE" // H * qty != Coro invoice amount
  | "SKU_CLASS_NOISE" // SKU could not be classified current/legacy
  // --- Invoice-driven close (docs/AUGUST_CLOSE_PLAN.md D3/D4/D6) ---
  | "USAGE_QTY_DISAGREES" // usage-derived billed qty != invoice quantity (finding, still billable)
  | "NO_USAGE_BREAKDOWN" // invoice line has no usage detail — billed partner-level, not by customer
  | "USAGE_NOT_ON_INVOICE" // consumed per usage but Coro billed nothing — NOT billed to the MSP
  | "OUT_OF_PERIOD_LINE" // invoice line whose service window is outside the close month
  | "UNMAPPED_PARTNER" // usage workspace slug not in the curated partner map
  | "AUDIT_QTY_MISMATCH"; // Coro's audit-stated qty != our users/devices reduction

export interface Exception {
  readonly kind: ExceptionKind;
  readonly severity: "block" | "warn" | "info";
  readonly partner: string;
  readonly customer: string | null;
  readonly sku: string;
  readonly period: Period;
  readonly message: string;
  /** Pointer back to the offending source row(s). */
  readonly sourceRow?: number;
}

/**
 * A usage line with H and L attached — the "magic sauce" row.
 * amountCost = hubCost * qty ; amountCharge = mspPrice * qty ; margin follows.
 */
export interface RatedLine {
  readonly period: Period;
  readonly partner: string;
  readonly customer: string | null;
  readonly sku: Sku;
  readonly quantity: number;
  readonly hubCost: Money; // H (unit)
  readonly mspPrice: Money; // L (unit)
  readonly amountCost: Money; // H * qty
  readonly amountCharge: Money; // L * qty
  readonly margin: Money; // amountCharge - amountCost
  /** The rate-card row used, for full traceability. */
  readonly rate: RateCardEntry;
  readonly exceptions: readonly Exception[];
  readonly sourceRow: number;
}

/** One line on an outbound QuickBooks invoice (Hub -> MSP), broken down by customer. */
export interface QbInvoiceLine {
  readonly customer: string | null;
  readonly sku: string;
  readonly description: string;
  readonly quantity: number;
  readonly rate: Money; // L (unit) — what we're charging
  readonly amount: Money; // L * qty
}

/** An outbound invoice: one MSP (partner) for one month, broken down by customer. */
export interface QbInvoice {
  readonly partner: string; // the MSP Hub bills
  readonly period: Period;
  readonly invoiceDate?: string; // YYYY-MM-DD, assigned at export time
  readonly dueDate?: string;
  readonly lines: readonly QbInvoiceLine[];
  readonly subtotalCharge: Money; // sum of L
  readonly subtotalCost: Money; // sum of H (internal, not shown to partner)
  readonly margin: Money;
}

/** Result of the rating stage. */
export interface RatingResult {
  readonly rated: readonly RatedLine[];
  readonly exceptions: readonly Exception[];
}

/** One reconciliation check outcome (the README "Reconciliation checks" table). */
export interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly status: "pass" | "fail" | "warn";
  readonly failCount: number;
  readonly detail: string;
  readonly rows?: readonly Record<string, unknown>[];
}

/** A single mismatch between our recreation and Lindita's manual August file. */
export interface Discrepancy {
  readonly partner: string;
  readonly customer: string | null;
  readonly sku: string;
  readonly field: "ourPrice" | "charge" | "quantity" | "margin" | "presence";
  readonly ours: string;
  readonly lindita: string;
  readonly centsDiff?: number;
  readonly explanation?: string; // e.g. "$6 vs $9 legacy special deal"
}

/** The August acceptance test output. matched === true only when every row ties (or is explained). */
export interface DiscrepancyReport {
  readonly period: Period;
  readonly matched: boolean;
  readonly totalOurs: Money;
  readonly totalLindita: Money;
  readonly discrepancies: readonly Discrepancy[];
  readonly onlyInOurs: readonly RatedLine[];
  readonly onlyInLindita: readonly LinditaLine[];
}
