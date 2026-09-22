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
  /**
   * Raw Coro parent-workspace slug exactly as the usage file keys it
   * (`amplivitycom_NE7N_b`). The special-pricing CSV joins on THIS (its
   * "Workspace ID" column), not on the mapped display name. Set by reduceUsage;
   * absent on hand-built fixtures and pre-reduction lines.
   */
  readonly partnerSlug?: string;
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
  | "AUDIT_QTY_MISMATCH" // Coro's audit-stated qty != our users/devices reduction
  // --- Rate-card close (docs/superpowers/specs/2026-09-21-coro-billing-ui-revamp-design.md) ---
  | "SHEET_MATH_INCONSISTENT" // pricing CSV cell disagrees with its own inputs (col H vs E×0.95, col I vs F+G)
  | "DUPLICATE_RATE_ROW" // same product twice in one partner block — first kept
  | "MISSING_WORKSPACE_ID" // partner block with no workspace slug — cannot join usage
  | "DUPLICATE_WORKSPACE_ID" // two partner blocks share a workspace slug
  | "EMPTY_PARTNER_BLOCK" // a name-only stray row (e.g. "XTB") with no products
  | "LIST_PRICE_DIVERGES" // Danny: list "should be the same in every single one" — it isn't
  | "MISSING_RATE" // usage maps to a pricing row with no Net Price to MSP — line HELD
  | "UNKNOWN_PRODUCT_CODE" // usage product code resolves to no pricing row at all — line HELD
  | "INVOICE_QTY_DISAGREES" // Coro invoice qty != audit-derived usage qty for partner+sku
  | "INVOICE_RATE_UNEXPECTED" // Coro-billed unit cost matches neither the sheet nor the additive rule
  | "ASSUMED_MAPPING" // ADD*flex priced via the Modules Flex chain — unconfirmed mapping (retired 2026-09-22: Coro confirmed)
  | "PRODUCT_FALLBACK" // priced from a fallback row (e.g. BUCOMflex → "Coro AI Complete")
  | "USAGE_NOT_ON_CARD" // usage parent workspace has no special-pricing block
  | "NFR_LINE" // not-for-resale SKU — listed, never billed (confirmed by Coro 2026-09-22)
  | "CLIENT_PRICE_DIFFERS" // team's keyed bill-out rate ≠ the rate card's col E
  // --- Coro 2026-09-22 answers (docs/superpowers/specs/2026-09-22-coro-answers-adoption.md) ---
  | "CLASSIC_RATE_RULE_DISAGREES" // card F/G on a Classic-family row ≠ the confirmed 40/5 (answer c)
  | "SHEET_MISLABEL_OVERRIDE" // line priced via a curated sheet-mislabel signature — sheet needs fixing
  | "CREDIT_EXPECTED"; // Coro invoiced above the confirmed additive cost on a legacy line — credit due (answer c)

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

/* ------------------------------------------------------------------------- *
 * Rate-card close (Sep 2026): the Coro "Special MSP Pricing" CSV finally
 * landed (Sep 18 call with Danny Gaston). Column E — "Net Price to MSP" — is
 * the partner's cost, i.e. L, what the MSP pays Hub (Luke, 2026-09-21).
 * Spec: docs/superpowers/specs/2026-09-21-coro-billing-ui-revamp-design.md
 * ------------------------------------------------------------------------- */

/** One product row of a partner's special-pricing block (CSV columns C-I). */
export interface PricingRow {
  /** Col C as written ("Coro AI Complete", "Modules Flex", "SAT Flex"…). */
  readonly product: string;
  /** Col D. Null = blank/garbage cell (kept, never invented). */
  readonly listPrice: Money | null;
  /** Col E — L: what the MSP pays Hub. Null ⇒ close HOLDS lines priced by this row. */
  readonly netMsp: Money | null;
  /** Col F, `60` for "60%". */
  readonly mspDiscountPct: number | null;
  /** Col G — the Hub margin discount (usually 5). */
  readonly hubDiscountPct: number | null;
  /** Col H exactly as WRITTEN. Do not trust: validated against E×0.95 and the additive rule. */
  readonly netHubStated: Money | null;
  /** Col I as written. Validated against F+G. */
  readonly totalDiscountPct: number | null;
  /** 1-based CSV source row. */
  readonly sourceRow: number;
}

/** One partner block of the special-pricing CSV (plus folded "Managed" sub-blocks). */
export interface PricingPartner {
  readonly name: string;
  /** Col B, trimmed + lowercased ("sevenstarsystemscom_x8e3_b"). Null = missing (flagged). */
  readonly workspaceId: string | null;
  readonly rows: readonly PricingRow[];
  /** Col J raw — free text ("$1,000.00", "Awaiting sig.", "New Partner (Standard Tier Pricing)"). */
  readonly approxMonthlySpend: string | null;
  readonly activeUsers: string | null;
  readonly totalWorkspaces: string | null;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
  readonly address: string | null;
  readonly sourceRow: number;
}

export interface SpecialPricingResult {
  readonly partners: readonly PricingPartner[];
  /** In-file validation findings (sheet-math, duplicates, missing workspace ids…). */
  readonly findings: readonly Exception[];
}

/**
 * Kind of pricing-row match for a usage product code (resolved by
 * src/config/productMap.ts — the curated code→name bridge).
 */
export type MatchKind =
  | "exact" // code's own product row (current-gen name or the bundle's flex row)
  | "specific-flex" // MOD code matched its product-specific flex row ("Network Flex")
  | "modules-flex" // MOD/ADD/SAT code matched a generic modules-flex row
  | "sat-flex" // Modsatflex matched the partner's "SAT Flex" row
  | "fallback-current" // legacy/flex code priced from the current-gen row (surfaced)
  | "add-module" // ADD*flex priced via the modules chain — confirmed by Coro 2026-09-22
  | "mislabel-override" // matched via a curated sheet-mislabel signature (see productMap CLASSIC_MISLABEL)
  | "nfr" // not-for-resale — non-billable
  | "none"; // no pricing row at all — the close HOLDS the line

/** Per-customer share of a draft invoice line (child-workspace breakdown). */
export interface DraftCustomerShare {
  /** Child workspace slug; null = the partner's own (CHANNEL) workspace. */
  readonly customer: string | null;
  readonly quantity: number;
}

/**
 * One product line on a per-MSP draft invoice (rate-card close).
 *
 * Money semantics (spec 2026-09-21): unitL is pricing col E — what the MSP pays
 * Hub. Cost is shown under BOTH rules (sheet col H vs the additive rule Coro
 * actually bills); when a Coro invoice is loaded its Subtotal is the
 * authoritative actual cost and drives margin. Null unitL ⇒ the line is HELD.
 */
export interface DraftLine {
  readonly vendorSku: string;
  /** Pricing-row product name, or the usage product name when unpriced. */
  readonly productLabel: string;
  /** Audit-derived billed quantity (sum over customers). */
  readonly quantity: number;
  readonly customers: readonly DraftCustomerShare[];
  readonly matchKind: MatchKind;
  readonly unitL: Money | null;
  readonly amountL: Money | null;
  /** Pricing col H as stated (fallback E×0.95 when the cell is blank). */
  readonly expectedHSheet: Money | null;
  /** list × (1 − (F+G)/100) — the rule Coro's real invoices follow. */
  readonly expectedHAdditive: Money | null;
  /** Coro invoice Subtotal ÷ invoice qty (display), when an invoice is loaded. */
  readonly actualHUnit: Money | null;
  /** Coro invoice Subtotal for this partner×sku — authoritative actual cost. */
  readonly actualHAmount: Money | null;
  readonly invoiceQuantity: number | null;
  /**
   * The accounting team's keyed bill-out rate — the "Client Price" column of
   * their invoice workbook (e.g. "Coro August Billing.xlsx"), when loaded and
   * unambiguous for this partner×SKU. Context for review, NEVER a rate source:
   * a HELD line stays held even when the team billed it manually.
   */
  readonly teamClientPrice: Money | null;
  /** amountL − (actualHAmount ?? expectedHAdditive×qty); null when no basis. */
  readonly margin: Money | null;
  readonly marginBasis: "actual" | "expected-additive" | "none";
  /**
   * Coro billed above the confirmed additive cost on this LEGACY line — credit
   * due per Coro's 2026-09-22 answer (c): actualHAmount − expectedHAdditive ×
   * invoiceQuantity. Null on current-gen, under-billed, in-tolerance, and
   * no-invoice lines. Margin stays cash-true (actual basis) until the credit
   * memo lands; this field is the expected correction.
   */
  readonly creditExpected: Money | null;
  readonly findings: readonly Exception[];
}

/** One MSP's draft invoice for the month. */
export interface PartnerDraft {
  /** Raw workspace slug (lowercased) — the join key across all three sources. */
  readonly slug: string;
  /** Special-pricing CSV partner name ("Seven Star Systems"). */
  readonly cardName: string;
  /** Coro-invoice display name from the curated slug map, when known. */
  readonly invoiceName: string | null;
  readonly contact: Pick<
    PricingPartner,
    "contactName" | "contactPhone" | "contactEmail" | "address"
  >;
  readonly lines: readonly DraftLine[];
  /** Sum of billable amountL (held + NFR lines excluded). */
  readonly totalL: Money;
  /** Sum of expectedHAdditive×qty over billable lines that have it. */
  readonly totalHExpected: Money;
  /** Sum of actualHAmount; null until at least one invoice line matched. */
  readonly totalHActual: Money | null;
  readonly totalMargin: Money;
  /** Sum of creditExpected over lines that carry one (zero when none). */
  readonly totalCreditExpected: Money;
  readonly heldLines: number;
}

/** The rate-card close: everything the dashboard renders. */
export interface CloseModel {
  readonly period: Period;
  /** Sorted by cardName. */
  readonly partners: readonly PartnerDraft[];
  /** Rate-card partners with no usage this month. */
  readonly cardOnly: readonly PricingPartner[];
  /** Usage parents with no special-pricing block. */
  readonly usageOnly: readonly { readonly slug: string; readonly partner: string }[];
  /** Global findings + roll-up of every line finding, deterministic order. */
  readonly findings: readonly Exception[];
  /** For buildInvoices → QuickBooks export reuse (billable lines only). */
  readonly ratedLines: readonly RatedLine[];
  /** Month total of expected Coro credits (2026-09-22 answer c); zero when none. */
  readonly totalCreditExpected: Money;
}
