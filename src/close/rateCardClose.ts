/**
 * rateCardClose — the rate-card-driven monthly close.
 *
 * This is the close Danny described on Sep 18, 2026, now that the special
 * pricing CSV exists (the piece missing on Sep 11): per partner workspace,
 * price the month's audit-derived usage from the partner's own rate card and
 * draft the invoice Hub sends the MSP. The Coro invoice, when supplied, is a
 * CROSS-CHECK — its Subtotal is the authoritative actual cost (never Rate×qty,
 * per docs/AUGUST_CLOSE_PLAN.md fact 1) — it validates, it does not price.
 *
 * Money semantics (spec 2026-09-21-coro-billing-ui-revamp-design.md):
 *   - L (unitL) = pricing col E "Net Price to MSP" — what the MSP pays Hub.
 *     Read, never derived. Null ⇒ the line is HELD (MISSING_RATE, block).
 *   - Cost is computed under BOTH rules and both are carried:
 *       sheet:    col H as stated (fallback E×0.95 when blank);
 *       additive: list × (1 − (F+G)/100) — what Coro's real invoices follow
 *                 (Seven Star 58%+5% ⇒ 15×0.37 = 5.55, not 6.08).
 *     When an invoice is loaded, its Subtotal is ACTUAL and drives margin;
 *     disagreements become findings, never silent picks.
 *   - Never invent: unknown codes, missing rates, unmatched workspaces are all
 *     Exceptions. NFR SKUs are listed and never billed.
 *
 * Deterministic: partners sorted by cardName, lines by vendorSku, customers
 * null-first then ascending; findings in a fixed phase order. No clock, no
 * randomness.
 */
import { Money, sum } from "../lib/money.js";
import { reduceUsage } from "../ingest/usageReduce.js";
import { resolvePricingRow } from "../config/productMap.js";
import { validateListPrices } from "../ingest/specialPricing.js";
import { PARTNER_SLUG_MAP, stripWorkspaceSuffix } from "../config/partners.js";
import { classifyInvoiceSku } from "./invoiceClose.js";
import type {
  CloseModel,
  CoroInvoiceLine,
  DraftCustomerShare,
  DraftLine,
  Exception,
  PartnerDraft,
  Period,
  PricingPartner,
  RatedLine,
  SpecialPricingResult,
  UsageLine,
} from "../domain/types.js";

export interface RateCardCloseArgs {
  readonly pricing: SpecialPricingResult;
  /** parseUsage output — reduction (audit-derived quantities) happens in here. */
  readonly usage: readonly UsageLine[];
  /** Optional Coro→Hub invoice detail lines for the cost cross-check. */
  readonly coroInvoiceLines?: readonly CoroInvoiceLine[];
  readonly period: Period;
}

/** One cent — the tolerance for "the billed unit rate matches an expected rule". */
const UNIT_TOLERANCE_CENTS = 1;

/**
 * Coro 2026-09-22 answer (c): Coro Classic & Managed Classic cost MSP Hub a flat
 * 45% off list "regardless" — the one legacy family where partner-specific F/G
 * do NOT apply. Forced below so cost, credits and the invoice cross-check all
 * follow the confirmed rule; card drift surfaces as CLASSIC_RATE_RULE_DISAGREES
 * instead of skewing cost.
 */
const CLASSIC_FLAT_SKUS: ReadonlySet<string> = new Set(["bucoclassflex", "bucoclassmnflex"]);

function exception(
  kind: Exception["kind"],
  severity: Exception["severity"],
  partner: string,
  sku: string,
  period: Period,
  message: string,
  sourceRow?: number
): Exception {
  return { kind, severity, partner, customer: null, sku, period, message, sourceRow };
}

export function closeFromRateCard(args: RateCardCloseArgs): CloseModel {
  const { pricing, period } = args;

  const findings: Exception[] = [...pricing.findings, ...validateListPrices(pricing.partners, period)];

  // ---- usage: audit-derived billed lines, grouped by parent workspace slug ----
  const reduced = reduceUsage(args.usage);
  findings.push(...reduced.exceptions);

  interface SkuGroup {
    readonly vendorSku: string;
    readonly productName: string | undefined;
    customers: DraftCustomerShare[];
    quantity: number;
  }
  interface SlugGroup {
    readonly slug: string; // lowercased
    readonly displayPartner: string; // reduceUsage's mapped name (or cleaned slug)
    readonly skus: Map<string, SkuGroup>; // key: vendorSku lowercased
  }
  const bySlug = new Map<string, SlugGroup>();
  for (const line of reduced.billed) {
    const rawSlug = line.partnerSlug ?? line.partner;
    const slug = rawSlug.trim().toLowerCase();
    let sg = bySlug.get(slug);
    if (!sg) {
      sg = { slug, displayPartner: line.partner, skus: new Map() };
      bySlug.set(slug, sg);
    }
    const skuKey = line.sku.vendorSku.trim().toLowerCase();
    let g = sg.skus.get(skuKey);
    if (!g) {
      g = { vendorSku: line.sku.vendorSku, productName: line.sku.product ?? line.product, customers: [], quantity: 0 };
      sg.skus.set(skuKey, g);
    }
    g.quantity += line.quantity;
    g.customers.push({ customer: line.customer, quantity: line.quantity });
  }

  // ---- pricing: index by workspace slug ----
  const cardBySlug = new Map<string, PricingPartner>();
  for (const p of pricing.partners) {
    if (p.workspaceId !== null && !cardBySlug.has(p.workspaceId)) {
      cardBySlug.set(p.workspaceId, p);
    }
  }

  // ---- invoice: split out-of-period, index in-period by (partner name, sku) ----
  interface InvoiceAgg {
    readonly partnerName: string;
    readonly sku: string;
    quantity: number;
    amount: Money;
    /** Distinct non-null "Client Price" cents seen — the team's keyed bill-out rate. */
    clientPriceCents: Set<number>;
    consumed: boolean;
  }
  const invoiceByKey = new Map<string, InvoiceAgg>();
  const invoiceFindings: Exception[] = [];
  for (const line of args.coroInvoiceLines ?? []) {
    const name = (line.partner ?? "").trim();
    if (line.servicePeriod !== undefined && line.servicePeriod !== period) {
      invoiceFindings.push(
        exception(
          "OUT_OF_PERIOD_LINE",
          "warn",
          name,
          line.sku,
          period,
          `invoice ${line.invoiceNumber} line ${line.lineNumber} is ${line.servicePeriod} ` +
            `service billed on the ${period} close — excluded from actual cost`,
          line.lineNumber
        )
      );
      continue;
    }
    const key = `${name.toLowerCase()}|${line.sku.trim().toLowerCase()}`;
    let agg = invoiceByKey.get(key);
    if (!agg) {
      agg = {
        partnerName: name,
        sku: line.sku,
        quantity: 0,
        amount: Money.zero(),
        clientPriceCents: new Set(),
        consumed: false,
      };
      invoiceByKey.set(key, agg);
    }
    agg.quantity += line.quantity;
    agg.amount = agg.amount.add(line.amount);
    if (line.clientPrice !== null && line.clientPrice !== undefined) {
      agg.clientPriceCents.add(line.clientPrice.toCents());
    }
  }

  // ---- build per-partner drafts ----
  const partners: PartnerDraft[] = [];
  const usageOnly: { slug: string; partner: string }[] = [];
  const lineFindings: Exception[] = [];
  const ratedLines: RatedLine[] = [];

  const sortedSlugs = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const sg of sortedSlugs) {
    const card = cardBySlug.get(sg.slug);
    if (!card) {
      usageOnly.push({ slug: sg.slug, partner: sg.displayPartner });
      continue;
    }

    const invoiceName = PARTNER_SLUG_MAP[stripWorkspaceSuffix(sg.slug)] ?? null;
    const lines: DraftLine[] = [];

    const sortedSkus = [...sg.skus.values()].sort((a, b) => a.vendorSku.localeCompare(b.vendorSku));
    for (const g of sortedSkus) {
      const flist: Exception[] = [];
      const match = resolvePricingRow(card, g.vendorSku);
      const row = match.row;

      const customers = [...g.customers].sort((a, b) => {
        if (a.customer === null) return b.customer === null ? 0 : -1;
        if (b.customer === null) return 1;
        return a.customer.localeCompare(b.customer);
      });

      // --- resolve the invoice aggregate for this partner×sku, if any ---
      // Try the curated invoice name first, then the card's own name — the
      // curated map only covers partners seen on past invoices; new partners
      // usually appear on the invoice under their card name.
      let invoiceAgg: InvoiceAgg | undefined;
      for (const name of [invoiceName, card.name]) {
        if (name === null || invoiceAgg !== undefined) continue;
        invoiceAgg = invoiceByKey.get(`${name.toLowerCase()}|${g.vendorSku.trim().toLowerCase()}`);
      }
      if (invoiceAgg) invoiceAgg.consumed = true;

      // --- match-kind findings ---
      const productLabel = row?.product ?? g.productName ?? g.vendorSku;
      if (match.kind === "none") {
        flist.push(
          exception("UNKNOWN_PRODUCT_CODE", "block", card.name, g.vendorSku, period,
            `${match.reason} — line HELD; nothing invented`)
        );
      } else if (match.kind === "nfr") {
        flist.push(
          exception("NFR_LINE", "info", card.name, g.vendorSku, period,
            `${match.reason} (qty ${g.quantity} listed, not billed)`)
        );
      } else if (match.kind === "mislabel-override") {
        flist.push(
          exception("SHEET_MISLABEL_OVERRIDE", "warn", card.name, g.vendorSku, period, match.reason,
            row?.sourceRow)
        );
      } else if (match.kind === "fallback-current") {
        flist.push(
          exception("PRODUCT_FALLBACK", "info", card.name, g.vendorSku, period, match.reason)
        );
      }

      const billable = match.kind !== "nfr" && match.kind !== "none";
      const unitL = billable ? (row?.netMsp ?? null) : null;
      if (billable && unitL === null) {
        flist.push(
          exception("MISSING_RATE", "block", card.name, g.vendorSku, period,
            `"${productLabel}" on ${card.name}'s card has no Net Price to MSP (col E) — ` +
              `line HELD; nothing invented`, row?.sourceRow)
        );
      }

      // --- both cost rules ---
      const expectedHSheet =
        row === null ? null : (row.netHubStated ?? (row.netMsp !== null ? row.netMsp.mul("0.95") : null));
      let expectedHAdditive =
        row !== null && row.listPrice !== null && row.mspDiscountPct !== null && row.hubDiscountPct !== null
          ? row.listPrice.applyDiscount((row.mspDiscountPct + row.hubDiscountPct) / 100)
          : null;
      if (
        billable &&
        CLASSIC_FLAT_SKUS.has(g.vendorSku.trim().toLowerCase()) &&
        row !== null &&
        row.listPrice !== null
      ) {
        const forced = row.listPrice.applyDiscount(0.45);
        if (
          row.mspDiscountPct !== null &&
          row.hubDiscountPct !== null &&
          row.mspDiscountPct + row.hubDiscountPct !== 45
        ) {
          flist.push(
            exception("CLASSIC_RATE_RULE_DISAGREES", "info", card.name, g.vendorSku, period,
              `card says ${row.mspDiscountPct}%+${row.hubDiscountPct}% but Coro confirmed the ` +
                `Classic family costs MSP Hub a flat 45% off list regardless (2026-09-22 answer c) ` +
                `— using ${forced.toFixed2()}/unit; the card row needs correcting`,
              row.sourceRow)
          );
        }
        expectedHAdditive = forced;
      }

      // --- invoice actuals + cross-check findings ---
      let actualHAmount: Money | null = null;
      let actualHUnit: Money | null = null;
      let invoiceQuantity: number | null = null;
      let creditExpected: Money | null = null;
      if (invoiceAgg !== undefined && billable) {
        actualHAmount = invoiceAgg.amount;
        invoiceQuantity = invoiceAgg.quantity;
        actualHUnit = invoiceAgg.quantity > 0 ? invoiceAgg.amount.div(invoiceAgg.quantity) : null;
        if (invoiceQuantity !== g.quantity) {
          flist.push(
            exception("INVOICE_QTY_DISAGREES", "warn", card.name, g.vendorSku, period,
              `usage (audit) says ${g.quantity} but Coro invoiced ${invoiceQuantity} — ` +
                `drafting L on ${g.quantity}, actual cost from the invoice; review`)
          );
        }
        // Coro 2026-09-22 answer (c): partner-specific discounts DO apply to
        // legacy flex — Coro's flat-legacy-rate invoicing over-billed those
        // lines and credits are due. Quantified here; margin stays cash-true
        // (actual basis) until the credit memo lands.
        if (
          actualHUnit !== null &&
          expectedHAdditive !== null &&
          classifyInvoiceSku(g.vendorSku) === "legacy" &&
          actualHUnit.toCents() - expectedHAdditive.toCents() > UNIT_TOLERANCE_CENTS
        ) {
          creditExpected = actualHAmount.sub(expectedHAdditive.mul(invoiceQuantity));
          flist.push(
            exception("CREDIT_EXPECTED", "warn", card.name, g.vendorSku, period,
              `Coro billed ${actualHUnit.toFixed2()}/unit but the partner-specific additive ` +
                `cost is ${expectedHAdditive.toFixed2()} — per Coro's 2026-09-22 answer (c) this ` +
                `legacy line was over-billed; credit expected ${creditExpected.toFixed2()}`)
          );
        }
        if (actualHUnit !== null && creditExpected === null) {
          const offBy = (expected: Money | null): boolean =>
            expected !== null &&
            Math.abs(actualHUnit!.toCents() - expected.toCents()) > UNIT_TOLERANCE_CENTS;
          const offSheet = offBy(expectedHSheet);
          const offAdditive = offBy(expectedHAdditive);
          if ((expectedHSheet !== null || expectedHAdditive !== null) &&
              (expectedHSheet === null || offSheet) &&
              (expectedHAdditive === null || offAdditive)) {
            flist.push(
              exception("INVOICE_RATE_UNEXPECTED", "warn", card.name, g.vendorSku, period,
                `Coro billed ${actualHUnit.toFixed2()}/unit but the additive rule says ` +
                  `${expectedHAdditive?.toFixed2() ?? "—"} and the sheet says ` +
                  `${expectedHSheet?.toFixed2() ?? "—"} — review with Coro billing`)
            );
          }
        }
      }

      // --- team's keyed bill-out rate (invoice workbook "Client Price") ---
      // Unambiguous only when every keyed line for this partner×sku agrees.
      // NEVER a rate source — a HELD line stays held; this is review context
      // (the manual process's actual bill, e.g. "Coro August Billing.xlsx").
      let teamClientPrice: Money | null = null;
      if (invoiceAgg !== undefined && invoiceAgg.clientPriceCents.size === 1) {
        teamClientPrice = Money.of([...invoiceAgg.clientPriceCents][0]! / 100);
        if (
          unitL !== null &&
          Math.abs(teamClientPrice.toCents() - unitL.toCents()) > UNIT_TOLERANCE_CENTS
        ) {
          flist.push(
            exception("CLIENT_PRICE_DIFFERS", "warn", card.name, g.vendorSku, period,
              `the team's workbook bills this at ${teamClientPrice.toFixed2()}/unit but the ` +
                `rate card (col E) says ${unitL.toFixed2()} — drafting the card rate; ` +
                `if the workbook price is the negotiated one, the card needs updating`)
          );
        }
      }

      // --- margin ---
      const amountL = unitL !== null ? unitL.mul(g.quantity) : null;
      let margin: Money | null = null;
      let marginBasis: DraftLine["marginBasis"] = "none";
      if (amountL !== null) {
        if (actualHAmount !== null) {
          margin = amountL.sub(actualHAmount);
          marginBasis = "actual";
        } else if (expectedHAdditive !== null) {
          margin = amountL.sub(expectedHAdditive.mul(g.quantity));
          marginBasis = "expected-additive";
        }
      }

      lines.push({
        vendorSku: g.vendorSku,
        productLabel,
        quantity: g.quantity,
        customers,
        matchKind: match.kind,
        unitL,
        amountL,
        expectedHSheet,
        expectedHAdditive,
        actualHUnit,
        actualHAmount,
        invoiceQuantity,
        teamClientPrice,
        margin,
        marginBasis,
        creditExpected,
        findings: flist,
      });
      lineFindings.push(...flist);

      // --- rated lines for QuickBooks reuse (billable, priced lines only) ---
      if (billable && unitL !== null && row !== null) {
        // Unit cost basis for the rated view. The CloseModel keeps the
        // authoritative amounts; this unit×qty view is what QB export needs.
        const costUnit = actualHUnit ?? expectedHAdditive ?? expectedHSheet ?? Money.zero();
        for (const share of customers) {
          const amountCharge = unitL.mul(share.quantity);
          const amountCost = costUnit.mul(share.quantity);
          ratedLines.push({
            period,
            partner: card.name,
            customer: share.customer,
            sku: {
              vendorSku: g.vendorSku,
              class: classifyInvoiceSku(g.vendorSku),
              isLegacy: classifyInvoiceSku(g.vendorSku) === "legacy",
              product: productLabel,
            },
            quantity: share.quantity,
            hubCost: costUnit,
            mspPrice: unitL,
            amountCost,
            amountCharge,
            margin: amountCharge.sub(amountCost),
            rate: {
              partner: card.name,
              sku: g.vendorSku,
              period,
              class: classifyInvoiceSku(g.vendorSku),
              hubCost: costUnit,
              mspPrice: unitL,
              discountPct: row.totalDiscountPct ?? undefined,
              source: "special-pricing CSV",
              raw: {},
            },
            exceptions: flist,
            sourceRow: row.sourceRow,
          });
        }
      }
    }

    const billableLines = lines.filter((l) => l.amountL !== null);
    const actuals = billableLines.filter((l) => l.actualHAmount !== null);
    partners.push({
      slug: sg.slug,
      cardName: card.name,
      invoiceName,
      contact: {
        contactName: card.contactName,
        contactPhone: card.contactPhone,
        contactEmail: card.contactEmail,
        address: card.address,
      },
      lines,
      totalL: sum(billableLines.map((l) => l.amountL!)),
      totalHExpected: sum(
        billableLines
          .filter((l) => l.expectedHAdditive !== null)
          .map((l) => l.expectedHAdditive!.mul(l.quantity))
      ),
      totalHActual: actuals.length > 0 ? sum(actuals.map((l) => l.actualHAmount!)) : null,
      totalMargin: sum(lines.filter((l) => l.margin !== null).map((l) => l.margin!)),
      totalCreditExpected: sum(
        lines.filter((l) => l.creditExpected !== null).map((l) => l.creditExpected!)
      ),
      heldLines: lines.filter(
        (l) => l.matchKind === "none" || (l.matchKind !== "nfr" && l.unitL === null)
      ).length,
    });
  }

  partners.sort((a, b) => a.cardName.localeCompare(b.cardName));

  // ---- join gaps ----
  const globalFindings: Exception[] = [];
  for (const u of usageOnly) {
    globalFindings.push(
      exception("USAGE_NOT_ON_CARD", "warn", u.partner, "", period,
        `usage workspace "${u.slug}" has no block on the special-pricing CSV — ` +
          `its consumption cannot be drafted; get the rate card updated`)
    );
  }
  const cardOnly = pricing.partners.filter(
    (p) => p.workspaceId === null || !bySlug.has(p.workspaceId)
  );

  // In-period invoice aggregates nothing consumed → billed with no usage detail.
  for (const agg of invoiceByKey.values()) {
    if (!agg.consumed) {
      globalFindings.push(
        exception("NO_USAGE_BREAKDOWN", "warn", agg.partnerName, agg.sku, period,
          `Coro invoiced ${agg.quantity} × ${agg.sku} for "${agg.partnerName}" but the ` +
            `usage report has no matching consumption this month — review`)
      );
    }
  }

  return {
    period,
    partners,
    cardOnly,
    usageOnly,
    findings: [...findings, ...lineFindings, ...invoiceFindings, ...globalFindings],
    ratedLines,
    totalCreditExpected: sum(partners.map((p) => p.totalCreditExpected)),
  };
}
