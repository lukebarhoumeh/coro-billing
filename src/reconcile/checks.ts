/**
 * Reconciliation checks — the README "Reconciliation checks" table.
 *
 * These run AFTER H and L are applied and invoices are built, but BEFORE anything
 * goes to QuickBooks. Each check maps 1:1 to a row of that table:
 *
 *   README "Reconciliation checks":
 *   | Check                                              | Fail means                     |
 *   | Usage row with no H or L                           | Rate card gap (esp. legacy)    |
 *   | Partner on a deal not on the rate card             | "Partners are on different..." |
 *   | Child workspace not rolled into the parent invoice | We would bill the wrong party  |
 *   | Invoice from Coro vs our H × qty                   | Cost disagreement with vendor  |
 *   | Legacy priced as current                           | Mapping error                  |
 *
 * README: "Accounting accepts, reclass, or holds exceptions. The system does not
 * silently 'fix' rates." So these checks only *surface* problems — they compute a
 * pass/fail and the offending rows; they never mutate a rate.
 *
 * (The "Recreation != Lindita August" row of that same table is a whole acceptance
 * report and lives in ./august.ts, not here.)
 */
import type {
  RatedLine,
  QbInvoice,
  CoroInvoiceLine,
  UsageLine,
  CheckResult,
} from "../domain/types.js";
import { Money } from "../lib/money.js";
import { normalizeHeader } from "../config/pipeline.config.js";

/** Context for the checks (mirrors the ARCHITECTURE.md signature exactly). */
export interface ChecksContext {
  readonly rated: RatedLine[];
  readonly invoices: QbInvoice[];
  readonly coroInvoices?: CoroInvoiceLine[];
  readonly usage: UsageLine[];
}

/** Stable, case/space-insensitive key for a partner (matches invoicing/rating joins). */
function partnerKey(partner: string): string {
  return normalizeHeader(partner);
}

/** Stable key for a customer/workspace (null-safe — partner-level rows are ""). */
function customerKey(customer: string | null): string {
  return customer == null ? "" : normalizeHeader(customer);
}

/** Stable key for a SKU string. */
function skuKey(sku: string): string {
  return normalizeHeader(sku);
}

/** Build a CheckResult, deriving pass/fail from the offending-row count. */
function result(
  id: string,
  title: string,
  detailPass: string,
  detailFail: (n: number) => string,
  rows: Record<string, unknown>[]
): CheckResult {
  const failCount = rows.length;
  return {
    id,
    title,
    status: failCount === 0 ? "pass" : "fail",
    failCount,
    detail: failCount === 0 ? detailPass : detailFail(failCount),
    rows,
  };
}

/**
 * Run every reconciliation check that applies to the supplied context and return
 * one CheckResult per check. Deterministic: offending rows preserve input order.
 *
 * The Coro-invoice-vs-cost check (#4) only runs when `coroInvoices` is supplied
 * (README: "Invoice from Coro vs our H × qty" — we can only compare against a
 * vendor invoice we actually have; two invoices stay two, never averaged).
 */
export function runChecks(ctx: ChecksContext): CheckResult[] {
  const checks: CheckResult[] = [];

  checks.push(checkUsageNoHorL(ctx.rated));
  checks.push(checkPartnerNotOnRateCard(ctx.rated));
  checks.push(checkChildNotRolledIntoParent(ctx.rated, ctx.invoices));
  if (ctx.coroInvoices !== undefined) {
    checks.push(checkCoroInvoiceVsHubCost(ctx.rated, ctx.coroInvoices));
  }
  checks.push(checkLegacyPricedAsCurrent(ctx.rated));

  return checks;
}

/**
 * Check 1 — "Usage row with no H or L" (rate card gap, especially legacy).
 *
 * A rated line whose H (hubCost) or L (mspPrice) is zero AND carries a
 * MISSING_HUB_COST / MISSING_MSP_PRICE / MISSING_RATE_CARD_ROW /
 * LEGACY_RATE_UNCONFIRMED exception is a genuine gap — the rate simply is not
 * on the card. We key off the exception (not just "amount == 0") so a legitimate
 * $0 rate, if one ever existed, is not falsely flagged.
 */
function checkUsageNoHorL(rated: RatedLine[]): CheckResult {
  const gapKinds = new Set([
    "MISSING_HUB_COST",
    "MISSING_MSP_PRICE",
    "MISSING_RATE_CARD_ROW",
    "LEGACY_RATE_UNCONFIRMED",
  ]);
  const rows = rated
    .filter((r) => r.exceptions.some((e) => gapKinds.has(e.kind)))
    .map((r) => ({
      partner: r.partner,
      customer: r.customer,
      sku: r.sku.vendorSku,
      hubCost: r.hubCost.toFixed2(),
      mspPrice: r.mspPrice.toFixed2(),
      missing: r.exceptions
        .filter((e) => gapKinds.has(e.kind))
        .map((e) => e.kind)
        .join(","),
      sourceRow: r.sourceRow,
    }));
  return result(
    "usage-no-h-or-l",
    "Usage row with no H or L",
    "Every usage line has both H (our cost) and L (what we charge).",
    (n) => `${n} usage line(s) are missing H and/or L — rate card gap (especially legacy).`,
    rows
  );
}

/**
 * Check 2 — "Partner on a deal not on the rate card."
 *
 * Dane: "all these partners are on different stuff." A partner+SKU that never
 * matched a rate-card row surfaces as MISSING_RATE_CARD_ROW; that is the signal
 * this partner has a deal we do not have priced yet.
 */
function checkPartnerNotOnRateCard(rated: RatedLine[]): CheckResult {
  const rows = rated
    .filter((r) => r.exceptions.some((e) => e.kind === "MISSING_RATE_CARD_ROW"))
    .map((r) => ({
      partner: r.partner,
      customer: r.customer,
      sku: r.sku.vendorSku,
      class: r.sku.class,
      sourceRow: r.sourceRow,
    }));
  return result(
    "partner-not-on-rate-card",
    "Partner on a deal not on the rate card",
    "Every priced partner+SKU has a rate-card row.",
    (n) => `${n} partner+SKU combination(s) have no rate-card row — "partners are on different stuff".`,
    rows
  );
}

/**
 * Check 3 — "Child workspace not rolled into the parent MSP invoice."
 *
 * README: fail means "We would bill the wrong party." Every rated line for a
 * partner must appear as an invoice line under that partner's invoice, matched on
 * customer+SKU. A rated (partner, customer, sku) with no corresponding invoice
 * line means the child workspace was dropped from its parent's bill.
 *
 * We match on the by-customer breakdown Dane asked for (the Amplivity example).
 */
function checkChildNotRolledIntoParent(
  rated: RatedLine[],
  invoices: QbInvoice[]
): CheckResult {
  // Index invoice lines by partner -> set of "customer|sku" keys.
  const covered = new Map<string, Set<string>>();
  for (const inv of invoices) {
    const pk = partnerKey(inv.partner);
    let set = covered.get(pk);
    if (!set) {
      set = new Set<string>();
      covered.set(pk, set);
    }
    for (const line of inv.lines) {
      set.add(`${customerKey(line.customer)}|${skuKey(line.sku)}`);
    }
  }

  const rows = rated
    .filter((r) => {
      const set = covered.get(partnerKey(r.partner));
      const key = `${customerKey(r.customer)}|${skuKey(r.sku.vendorSku)}`;
      return set === undefined || !set.has(key);
    })
    .map((r) => ({
      partner: r.partner,
      customer: r.customer,
      sku: r.sku.vendorSku,
      sourceRow: r.sourceRow,
    }));
  return result(
    "child-not-rolled-into-parent",
    "Child workspace not rolled into the parent MSP invoice",
    "Every rated customer line is rolled into its parent MSP invoice.",
    (n) => `${n} rated line(s) are not on any parent MSP invoice — we would bill the wrong party.`,
    rows
  );
}

/**
 * Check 4 — "Invoice from Coro vs our H × qty" (cost disagreement with vendor).
 *
 * Dane: "Brandon said you guys get this for $6, but you guys are charging us $9."
 * We compare each Coro invoice line's total against our sum of H*qty for the same
 * partner+SKU. Two Coro invoices stay two (README rule 7) — we never average across
 * invoices; we aggregate our cost per (partner, SKU) and compare against the Coro
 * line(s). When a Coro line has no partner, we compare on SKU alone.
 *
 * Only runs when coroInvoices are supplied.
 */
function checkCoroInvoiceVsHubCost(
  rated: RatedLine[],
  coroInvoices: CoroInvoiceLine[]
): CheckResult {
  // Aggregate OUR cost (H*qty) per partner|sku and per sku-only (for partnerless Coro lines).
  const ourCostByPartnerSku = new Map<string, Money>();
  const ourCostBySku = new Map<string, Money>();
  for (const r of rated) {
    const pk = `${partnerKey(r.partner)}|${skuKey(r.sku.vendorSku)}`;
    ourCostByPartnerSku.set(pk, (ourCostByPartnerSku.get(pk) ?? Money.zero()).add(r.amountCost));
    const sk = skuKey(r.sku.vendorSku);
    ourCostBySku.set(sk, (ourCostBySku.get(sk) ?? Money.zero()).add(r.amountCost));
  }

  // Aggregate the CORO side to the SAME grain BEFORE comparing. Coro can bill the same
  // SKU across BOTH invoices (1914 + 2193) — "two Coro invoices stay two" means we
  // ingest both, NOT that each raw line must independently tie to the full month. If we
  // compared each line to the monthly aggregate, a legitimately-split SKU would always
  // false-fail. So we sum Coro `amount` per partner|sku (and per sku-only for partnerless
  // lines) across all supplied invoices, then compare aggregate-to-aggregate: one result
  // row per key, with the contributing invoice/line numbers listed for traceability.
  interface CoroAgg {
    readonly partner: string | null;
    readonly sku: string;
    amount: Money;
    readonly refs: string[];
  }
  const coroByPartnerSku = new Map<string, CoroAgg>();
  const coroBySkuOnly = new Map<string, CoroAgg>();
  for (const line of coroInvoices) {
    const sk = skuKey(line.sku);
    const ref = `${line.invoiceNumber}#${line.lineNumber}`;
    if (line.partner !== undefined) {
      const key = `${partnerKey(line.partner)}|${sk}`;
      const agg = coroByPartnerSku.get(key);
      if (agg) {
        agg.amount = agg.amount.add(line.amount);
        agg.refs.push(ref);
      } else {
        coroByPartnerSku.set(key, { partner: line.partner, sku: line.sku, amount: line.amount, refs: [ref] });
      }
    } else {
      const agg = coroBySkuOnly.get(sk);
      if (agg) {
        agg.amount = agg.amount.add(line.amount);
        agg.refs.push(ref);
      } else {
        coroBySkuOnly.set(sk, { partner: null, sku: line.sku, amount: line.amount, refs: [ref] });
      }
    }
  }

  const rows: Record<string, unknown>[] = [];
  // Partnered Coro aggregates compare against our partner|sku cost.
  for (const [key, agg] of coroByPartnerSku) {
    const ours = ourCostByPartnerSku.get(key) ?? Money.zero();
    if (!ours.equalsCents(agg.amount)) {
      rows.push({
        partner: agg.partner,
        sku: agg.sku,
        coroLines: agg.refs.join(", "),
        coroAmount: agg.amount.toFixed2(),
        ourHubCost: ours.toFixed2(),
        centsDiff: ours.centsDiff(agg.amount).toCents(),
      });
    }
  }
  // Partnerless Coro aggregates compare against our sku-only cost (all partners for that SKU).
  for (const [sk, agg] of coroBySkuOnly) {
    const ours = ourCostBySku.get(sk) ?? Money.zero();
    if (!ours.equalsCents(agg.amount)) {
      rows.push({
        partner: null,
        sku: agg.sku,
        coroLines: agg.refs.join(", "),
        coroAmount: agg.amount.toFixed2(),
        ourHubCost: ours.toFixed2(),
        centsDiff: ours.centsDiff(agg.amount).toCents(),
      });
    }
  }
  return result(
    "coro-invoice-vs-hub-cost",
    "Coro invoice vs our H × qty",
    "Every Coro partner+SKU total ties to our summed H × qty (across both invoices).",
    (n) => `${n} Coro partner+SKU total(s) disagree with our H × qty — cost disagreement with vendor.`,
    rows
  );
}

/**
 * Check 5 — "Legacy priced as current" (mapping error).
 *
 * README rule 6: "Legacy stays visible as its own class." If a usage line is a
 * legacy SKU (sku.isLegacy or sku.class === "legacy") but the rate-card row it
 * was priced with is class "current", that is a mapping error: legacy rows must
 * be priced from the legacy tab (Lisa kept them separate because they still change).
 */
function checkLegacyPricedAsCurrent(rated: RatedLine[]): CheckResult {
  const rows = rated
    .filter((r) => (r.sku.isLegacy || r.sku.class === "legacy") && r.rate.class === "current")
    .map((r) => ({
      partner: r.partner,
      customer: r.customer,
      sku: r.sku.vendorSku,
      skuClass: r.sku.class,
      rateClass: r.rate.class,
      rateSource: r.rate.source,
      sourceRow: r.sourceRow,
    }));
  return result(
    "legacy-priced-as-current",
    "Legacy priced as current",
    "Every legacy SKU was priced from a legacy rate-card row.",
    (n) => `${n} legacy SKU line(s) were priced with a current rate-card row — mapping error.`,
    rows
  );
}
