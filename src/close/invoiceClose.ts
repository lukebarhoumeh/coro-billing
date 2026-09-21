/**
 * invoiceClose — the invoice-driven monthly close (docs/AUGUST_CLOSE_PLAN.md).
 *
 * The real August packet inverted the original design: Coro invoice 2193 arrived
 * already carrying H (Rate/Subtotal) AND L (Client Price/charge) per partner×SKU,
 * so the invoice IS the pricing authority and the reconciliation target. Usage's
 * job is to break each invoice line down BY CUSTOMER (Dane's Amplivity requirement)
 * and to flag where consumption disagrees with what Coro billed.
 *
 * Money rules (facts 1–2, non-negotiable):
 *   - `line.amount` (the Subtotal column) is the authoritative H total. Coro
 *     computes it on the UNROUNDED net rate, so Rate × Qty may differ by cents.
 *     We allocate Subtotal's cents by largest remainder — per-customer H amounts
 *     ALWAYS sum exactly to the invoice line, and the close ALWAYS foots to the
 *     invoice grand total.
 *   - L unit (`clientPrice`) is exact; per-customer charge = L × allocated qty, so
 *     the partner's L total is exactly L × invoice qty.
 *   - Blank L → the line is HELD (MISSING_MSP_PRICE, block). Never fabricated.
 *
 * Consequence of Subtotal-authority worth stating loudly: on a rated line from this
 * close, `amountCost` is the allocated share of the invoice Subtotal, and
 * `hubCost` (the unit) is `amountCost / qty` for DISPLAY — `hubCost.mul(qty)` may
 * differ from `amountCost` by a cent. Margin is computed from the exact amounts.
 *
 * Output is standard RatedLine[] (decision D7) so buildInvoices → QuickBooks
 * export is reused unchanged, plus a CloseReport for the operator.
 *
 * Deterministic: report lines sorted (partner, sku); allocation order sorted by
 * customer name; no clock, no randomness.
 */
import { Money, sum } from "../lib/money.js";
import { allocateCents, allocateInteger } from "../lib/allocate.js";
import type {
  CoroInvoiceLine,
  Exception,
  Period,
  RateCardEntry,
  RatedLine,
  Sku,
  SkuClass,
  UsageLine,
} from "../domain/types.js";

export interface CloseOptions {
  /** The close month, "YYYY-MM". Invoice lines outside it are excluded + flagged. */
  readonly period: Period;
  /** The target invoice number (e.g. "2193"). Lines from other invoices are ignored. */
  readonly invoiceNumber: string;
}

/** One partner×SKU row of the close report (the recreate-vs-invoice tie-out). */
export interface CloseReportLine {
  readonly partner: string;
  readonly sku: string;
  readonly productName?: string;
  readonly skuClass: SkuClass;
  /** What Coro billed (authoritative). */
  readonly invoiceQty: number;
  /** What usage says was consumed (null = no usage detail for this partner×SKU). */
  readonly usageQty: number | null;
  readonly qtyTies: boolean;
  /** H total = the invoice Subtotal (allocated cent-exact across customers). */
  readonly hTotal: Money;
  /** L unit (Client Price); null = unresolved → line held. */
  readonly lUnit: Money | null;
  /** L total = lUnit × invoiceQty (null when held). */
  readonly lTotal: Money | null;
  /** lTotal − hTotal (null when held). */
  readonly margin: Money | null;
  readonly held: boolean;
  /** How many customer lines this invoice line was broken into (0 = partner-level). */
  readonly customerCount: number;
  /** Human-readable findings for this row (negative margin, class mismatch, …). */
  readonly flags: readonly string[];
}

export interface CloseReport {
  readonly period: Period;
  readonly invoiceNumber: string;
  /** Grand total H of the target invoice (in-period + out-of-period lines). */
  readonly invoiceTotalH: Money;
  readonly inPeriodH: Money;
  readonly outOfPeriodH: Money;
  /** Sum of amountCost across all rated lines — must equal inPeriodH cent-exact. */
  readonly allocatedH: Money;
  /** allocatedH + outOfPeriodH === invoiceTotalH (the acceptance gate). */
  readonly grandTieOk: boolean;
  /** H total sitting on held (unresolved-L) lines — "on hold" in the sheet's terms. */
  readonly heldH: Money;
  /** L total across billable lines — what actually goes out to MSPs. */
  readonly billableL: Money;
  readonly lines: readonly CloseReportLine[];
  /** Consumed per usage but not billed by Coro (e.g. Hurricane IT, Vaiman). */
  readonly usageOnly: readonly { partner: string; sku: string; usageQty: number }[];
  /** Invoice lines excluded from this close because their service window is another month. */
  readonly outOfPeriod: readonly {
    partner: string;
    sku: string;
    quantity: number;
    amount: Money;
    servicePeriod: string;
    note?: string;
  }[];
}

export interface CloseResult {
  readonly rated: RatedLine[];
  readonly exceptions: Exception[];
  readonly report: CloseReport;
}

/** SKU class per decision D5: `…flex` = legacy Flex, everything else current (AI). */
export function classifyInvoiceSku(sku: string): SkuClass {
  return /flex$/i.test(sku.trim()) ? "legacy" : "current";
}

function exception(
  kind: Exception["kind"],
  severity: Exception["severity"],
  partner: string,
  customer: string | null,
  sku: string,
  period: Period,
  message: string,
  sourceRow?: number
): Exception {
  return {
    kind,
    severity,
    partner,
    customer,
    sku,
    period,
    message,
    ...(sourceRow !== undefined ? { sourceRow } : {}),
  };
}

interface UsageEntry {
  readonly customer: string | null;
  readonly qty: number;
  readonly line: UsageLine;
}

/**
 * Run the invoice-driven close. `billedUsage` must already be reduced + partner-mapped
 * (ingest/usageReduce.ts); `invoiceLines` are parsed Coro invoice lines (any invoice —
 * filtered to opts.invoiceNumber here).
 */
export function closeFromInvoice(
  invoiceLines: readonly CoroInvoiceLine[],
  billedUsage: readonly UsageLine[],
  opts: CloseOptions
): CloseResult {
  const { period, invoiceNumber } = opts;
  const exceptions: Exception[] = [];

  // ---- 1. Select the target invoice; partition by service period. ----
  const target = invoiceLines.filter((l) => l.invoiceNumber === invoiceNumber);
  const inPeriod: CoroInvoiceLine[] = [];
  const outOfPeriodLines: CoroInvoiceLine[] = [];
  for (const l of target) {
    // Lines without a parseable service window (synthetic/1914 layout) are taken as
    // in-period — the caller chose this invoice for this close.
    if (l.servicePeriod !== undefined && l.servicePeriod !== period) outOfPeriodLines.push(l);
    else inPeriod.push(l);
  }

  const outOfPeriod = outOfPeriodLines.map((l) => {
    exceptions.push(
      exception(
        "OUT_OF_PERIOD_LINE",
        "warn",
        l.partner ?? "(unknown)",
        null,
        l.sku,
        period,
        `invoice ${invoiceNumber} line ${l.lineNumber} is ${l.servicePeriod} service ` +
          `(${l.startDate ?? "?"} – ${l.endDate ?? "?"}) on the ${period} close — EXCLUDED ` +
          `from allocation${l.note ? ` (sheet note: "${l.note}")` : ""}`,
        l.lineNumber
      )
    );
    return {
      partner: l.partner ?? "(unknown)",
      sku: l.sku,
      quantity: l.quantity,
      amount: l.amount,
      servicePeriod: l.servicePeriod!,
      ...(l.note !== undefined ? { note: l.note } : {}),
    };
  });

  // ---- 2. Group in-period invoice lines by (partner, sku). ----
  interface InvGroup {
    readonly partner: string;
    readonly sku: string;
    qty: number;
    hTotal: Money;
    /** Each merged line's L unit (blank/absent → null); resolved after grouping. */
    lUnits: (Money | null)[];
    chargeSheet: Money | null;
    productName?: string;
    firstLineNumber: number;
    raw: Record<string, unknown>;
  }
  const invGroups = new Map<string, InvGroup>();
  for (const l of inPeriod) {
    const partner = l.partner ?? "(unknown)";
    const key = JSON.stringify([partner, l.sku]);
    let g = invGroups.get(key);
    if (!g) {
      g = {
        partner,
        sku: l.sku,
        qty: 0,
        hTotal: Money.zero(),
        lUnits: [],
        chargeSheet: null,
        ...(l.productName !== undefined ? { productName: l.productName } : {}),
        firstLineNumber: l.lineNumber,
        raw: l.raw,
      };
      invGroups.set(key, g);
    }
    g.qty += l.quantity;
    g.hTotal = g.hTotal.add(l.amount);
    g.lUnits.push(l.clientPrice ?? null); // column-absent and blank both mean "no L"
    if (l.chargeAmount != null) {
      g.chargeSheet = (g.chargeSheet ?? Money.zero()).add(l.chargeAmount);
    }
  }

  /**
   * Resolve a group's L unit. Any blank ⇒ part of the quantity is unpriceable ⇒ the
   * whole group is unresolved (held). Differing non-blank values ⇒ conflict (held).
   */
  function resolveLUnit(units: readonly (Money | null)[]): { lUnit: Money | null; conflict: boolean } {
    if (units.length === 0 || units.some((u) => u === null)) return { lUnit: null, conflict: false };
    const first = units[0] as Money;
    const conflict = units.some((u) => !(u as Money).equalsCents(first));
    return conflict ? { lUnit: null, conflict: true } : { lUnit: first, conflict: false };
  }

  // ---- 3. Index reduced usage by (partner, sku). ----
  const usageIdx = new Map<string, UsageEntry[]>();
  for (const u of billedUsage) {
    const key = JSON.stringify([u.partner, u.sku.vendorSku]);
    const bucket = usageIdx.get(key);
    const entry: UsageEntry = { customer: u.customer, qty: u.quantity, line: u };
    if (bucket) bucket.push(entry);
    else usageIdx.set(key, [entry]);
  }

  // ---- 4. Allocate each invoice group down to customers. ----
  const rated: RatedLine[] = [];
  const reportLines: CloseReportLine[] = [];

  const sortedGroups = [...invGroups.values()].sort(
    (a, b) => cmp(a.partner, b.partner) || cmp(a.sku, b.sku)
  );

  for (const g of sortedGroups) {
    const flags: string[] = [];
    const skuClass = classifyInvoiceSku(g.sku);
    const key = JSON.stringify([g.partner, g.sku]);
    const usageEntries = (usageIdx.get(key) ?? [])
      .slice()
      .sort((a, b) => cmp(a.customer ?? "", b.customer ?? ""));
    const usageQty = usageEntries.reduce((acc, e) => acc + e.qty, 0);
    const hasBreakdown = usageEntries.length > 0 && usageQty > 0;

    const { lUnit, conflict: lConflict } = resolveLUnit(g.lUnits);
    if (lConflict) {
      flags.push("conflicting Client Price across merged invoice lines — held");
      exceptions.push(
        exception(
          "MISSING_MSP_PRICE",
          "block",
          g.partner,
          null,
          g.sku,
          period,
          `invoice ${invoiceNumber}: merged lines for ${g.partner}/${g.sku} disagree on ` +
            `Client Price — L treated as unresolved; line held`,
          g.firstLineNumber
        )
      );
    }

    const held = lUnit === null;

    // Usage-vs-invoice quantity tie (finding, not a blocker — decision D3).
    if (!hasBreakdown) {
      exceptions.push(
        exception(
          "NO_USAGE_BREAKDOWN",
          "info",
          g.partner,
          null,
          g.sku,
          period,
          `invoice ${invoiceNumber} bills ${g.qty} × ${g.sku} for ${g.partner} but usage has ` +
            `no detail for this partner×SKU — billed as one partner-level line`,
          g.firstLineNumber
        )
      );
      flags.push("no usage breakdown — partner-level line");
    } else if (usageQty !== g.qty) {
      exceptions.push(
        exception(
          "USAGE_QTY_DISAGREES",
          "warn",
          g.partner,
          null,
          g.sku,
          period,
          `usage says ${usageQty} but invoice ${invoiceNumber} bills ${g.qty} ` +
            `(${g.partner}/${g.sku}) — invoice wins for billing; take the gap to Coro`,
          g.firstLineNumber
        )
      );
      flags.push(`usage ${usageQty} ≠ invoice ${g.qty}`);
    }

    // Allocation weights: usage quantities per customer; no breakdown → one
    // partner-level bucket carrying everything.
    const buckets: { customer: string | null; weight: number; usageLine?: UsageLine }[] =
      hasBreakdown
        ? usageEntries.map((e) => ({ customer: e.customer, weight: e.qty, usageLine: e.line }))
        : [{ customer: null, weight: 1 }];

    const qtyAlloc = allocateInteger(
      g.qty,
      buckets.map((b) => b.weight)
    );
    const centsAlloc = allocateCents(g.hTotal, qtyAlloc.some((q) => q !== 0) ? qtyAlloc : buckets.map((b) => b.weight));

    // Cross-check the sheet's own L math (charge = Client Price × Quantity).
    const lTotal = lUnit !== null ? lUnit.mul(g.qty) : null;
    if (lUnit !== null && g.chargeSheet !== null && lTotal !== null && !lTotal.equalsCents(g.chargeSheet)) {
      exceptions.push(
        exception(
          "COST_DISAGREES_WITH_INVOICE",
          "warn",
          g.partner,
          null,
          g.sku,
          period,
          `sheet charge $${g.chargeSheet.toFixed2()} != Client Price × Quantity ` +
            `$${lTotal.toFixed2()} for ${g.partner}/${g.sku} — the sheet's own math; review`,
          g.firstLineNumber
        )
      );
      flags.push(`sheet charge $${g.chargeSheet.toFixed2()} ≠ L×qty $${lTotal.toFixed2()}`);
    }

    const margin = lTotal !== null ? lTotal.sub(g.hTotal) : null;
    if (margin !== null && margin.isNegative()) {
      flags.push(`NEGATIVE margin $${margin.toFixed2()} — selling below Coro cost`);
    }

    // Legacy-class cross-check vs usage Billing Mode (decision D5).
    if (hasBreakdown) {
      const usageSaysLegacy = usageEntries.some((e) => e.line.sku.isLegacy);
      if (usageSaysLegacy !== (skuClass === "legacy")) {
        flags.push(
          `class mismatch: suffix says ${skuClass}, usage Billing Mode says ` +
            `${usageSaysLegacy ? "LEGACY" : "NEW"}`
        );
      }
    }

    // ---- Emit one RatedLine per allocation bucket. ----
    const rateEntry: RateCardEntry = {
      partner: g.partner,
      sku: g.sku,
      period,
      class: skuClass,
      hubCost: g.qty > 0 ? g.hTotal.div(g.qty) : Money.zero(), // display unit (see module doc)
      mspPrice: lUnit ?? Money.zero(),
      source: `INVCUS2026-${invoiceNumber} Invoice Detail`,
      raw: g.raw,
    };

    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i]!;
      const allocQty = qtyAlloc[i]!;
      const allocH = centsAlloc[i]!;
      // Skip zero-qty zero-H buckets (a customer whose share rounded to nothing and
      // carries no cents) — they would bill a 0 × $0 line. The customer still
      // appears in usage; nothing is owed for them this month.
      if (allocQty === 0 && allocH.isZero()) continue;

      const lineExceptions: Exception[] = [];
      if (held) {
        lineExceptions.push(
          exception(
            "MISSING_MSP_PRICE",
            "block",
            g.partner,
            b.customer,
            g.sku,
            period,
            `invoice ${invoiceNumber}: no Client Price (L) for ${g.partner}/${g.sku} — ` +
              `held, never fabricated (docs/AUGUST_CLOSE_PLAN.md D2)`,
            g.firstLineNumber
          )
        );
      }

      const amountCost = allocH; // exact allocated share of the invoice Subtotal
      const amountCharge = lUnit !== null ? lUnit.mul(allocQty) : Money.zero();
      const sku: Sku = {
        vendorSku: g.sku,
        class: skuClass,
        isLegacy: skuClass === "legacy",
        ...(g.productName !== undefined ? { product: g.productName } : {}),
      };

      rated.push({
        period,
        partner: g.partner,
        customer: b.customer,
        sku,
        quantity: allocQty,
        hubCost: allocQty > 0 ? allocH.div(allocQty) : Money.zero(), // display unit
        mspPrice: lUnit ?? Money.zero(),
        amountCost,
        amountCharge,
        margin: amountCharge.sub(amountCost),
        rate: rateEntry,
        exceptions: lineExceptions,
        sourceRow: g.firstLineNumber,
      });
      for (const ex of lineExceptions) exceptions.push(ex);
    }

    reportLines.push({
      partner: g.partner,
      sku: g.sku,
      ...(g.productName !== undefined ? { productName: g.productName } : {}),
      skuClass,
      invoiceQty: g.qty,
      usageQty: hasBreakdown ? usageQty : null,
      qtyTies: hasBreakdown && usageQty === g.qty,
      hTotal: g.hTotal,
      lUnit,
      lTotal,
      margin,
      held,
      customerCount: hasBreakdown ? usageEntries.length : 0,
      flags,
    });
  }

  // ---- 5. Usage with no invoice line: consumed but unbilled (finding; NOT billed). ----
  const usageOnly: { partner: string; sku: string; usageQty: number }[] = [];
  const sortedUsageKeys = [...usageIdx.keys()].sort();
  for (const key of sortedUsageKeys) {
    if (invGroups.has(key)) continue;
    const entries = usageIdx.get(key)!;
    const [partner, sku] = JSON.parse(key) as [string, string];
    const qty = entries.reduce((acc, e) => acc + e.qty, 0);
    usageOnly.push({ partner, sku, usageQty: qty });
    exceptions.push(
      exception(
        "USAGE_NOT_ON_INVOICE",
        "warn",
        partner,
        null,
        sku,
        period,
        `usage shows ${qty} × ${sku} for ${partner} but invoice ${invoiceNumber} has no ` +
          `line for it — Coro billed nothing; NOT billed to the MSP (never invent revenue); ` +
          `raise with Coro`,
        entries[0]!.line.sourceRow
      )
    );
  }

  // ---- 6. Totals + the acceptance tie. ----
  const invoiceTotalH = sum(target.map((l) => l.amount));
  const inPeriodH = sum([...invGroups.values()].map((g) => g.hTotal));
  const outOfPeriodH = sum(outOfPeriodLines.map((l) => l.amount));
  const allocatedH = sum(rated.map((r) => r.amountCost));
  const heldH = sum(reportLines.filter((l) => l.held).map((l) => l.hTotal));
  const billableL = sum(reportLines.filter((l) => !l.held && l.lTotal !== null).map((l) => l.lTotal!));

  // Construction invariant: allocation must never gain or lose a cent. If this ever
  // fires it is a BUG in the close, not a data condition — block the whole close.
  if (!allocatedH.equalsCents(inPeriodH)) {
    exceptions.push(
      exception(
        "COST_DISAGREES_WITH_INVOICE",
        "block",
        "(close)",
        null,
        "(all)",
        period,
        `INTERNAL: allocated H $${allocatedH.toFixed2()} != in-period invoice H ` +
          `$${inPeriodH.toFixed2()} — largest-remainder allocation is broken; do not bill`
      )
    );
  }

  const grandTieOk =
    allocatedH.equalsCents(inPeriodH) && inPeriodH.add(outOfPeriodH).equalsCents(invoiceTotalH);

  const report: CloseReport = {
    period,
    invoiceNumber,
    invoiceTotalH,
    inPeriodH,
    outOfPeriodH,
    allocatedH,
    grandTieOk,
    heldH,
    billableL,
    lines: reportLines,
    usageOnly,
    outOfPeriod,
  };

  return { rated, exceptions, report };
}

/** Stable, locale-independent string comparison (same convention as buildInvoices). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
