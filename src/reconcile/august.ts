/**
 * reconcileAgainstLindita — THE ACCEPTANCE TEST.
 *
 * Spec anchor (README §3 "Recreate August against Lindita"):
 *   Dane, verbatim: "Once we get that information from Jack, we should try to
 *   recreate the August invoice and see any discrepancies we have against Lita's
 *   manual one, and we'll be able to make corrections there."
 *   And: "the acceptance test. Not a demo UI. Not a green unit test that never
 *   saw August."
 *
 * We join our recreation (RatedLine[]) to Lindita's manual workbook (LinditaLine[])
 * on normalized partner + customer + sku, then compare the two prices Dane cares
 * about — column H (our price) and column L (what we're charging) — plus quantity
 * and margin, all cent-exact via Money.equalsCents within cfg.reconToleratedCents.
 *
 * The comparison is UNIT-level (H and L are unit prices): RatedLine.hubCost vs
 * LinditaLine.ourPrice (H), RatedLine.mspPrice vs LinditaLine.charge (L). This is
 * the pairing Dane described ("here's our price, here's the price"). Totals, by
 * contrast, are extended (charge * qty on each side) so the report also shows the
 * dollar impact Dane framed as "billing 16,000, 3,000 in profit."
 *
 * matched === true iff there are NO discrepancies AND NO only-in-one rows.
 *
 * When a mismatch is on a line carrying a relevant Exception (a legacy /
 * partner-special-deal), we attach an `explanation` so accounting sees WHY —
 * Dane's "$6 vs $9" landmine — instead of a bare number diff. We NEVER invent a
 * rate to close the gap; we only explain it (README: the system flags, it never
 * silently "fixes").
 */
import type {
  RatedLine,
  LinditaLine,
  Discrepancy,
  DiscrepancyReport,
  Exception,
} from "../domain/types.js";
import type { PipelineConfig } from "../config/pipeline.config.js";
import { normalizeHeader } from "../config/pipeline.config.js";
import { Money, sum } from "../lib/money.js";

/** Case/space-insensitive join key: partner + customer + sku (customer null -> ""). */
function joinKey(partner: string, customer: string | null, sku: string): string {
  const p = normalizeHeader(partner);
  const c = customer == null ? "" : normalizeHeader(customer);
  const s = normalizeHeader(sku);
  return `${p}||${c}||${s}`;
}

/**
 * Exception kinds that explain a *price* mismatch (the "$6 vs $9" story). Legacy
 * and partner-special-deal lines are exactly the "partners are on different stuff"
 * cases Dane warned about, so a mismatch there is likely an explained exception,
 * not a bug.
 */
const PRICE_EXPLAINING_KINDS = new Set<Exception["kind"]>([
  "PARTNER_SPECIAL_DEAL",
  "LEGACY_RATE_UNCONFIRMED",
]);

/**
 * Build an explanation string for a price discrepancy, if the rated line carries a
 * relevant exception OR is a legacy line. Returns undefined when nothing explains it
 * (that mismatch is then treated as an unexplained discrepancy → the bug to fix).
 *
 * @param field   which price field mismatched ("ourPrice" = H, "charge" = L)
 * @param ours    our unit value, formatted
 * @param lindita Lindita's unit value, formatted
 */
function explainPriceMismatch(
  line: RatedLine,
  field: "ourPrice" | "charge",
  ours: string,
  lindita: string
): string | undefined {
  const relevant = line.exceptions.find((e) => PRICE_EXPLAINING_KINDS.has(e.kind));
  const isLegacy = line.sku.isLegacy || line.sku.class === "legacy";
  const label = field === "charge" ? "what we charge (L)" : "our cost (H)";

  // A real supporting exception (partner special deal / legacy rate unconfirmed) is
  // the only thing that turns a mismatch into an *explained* deal.
  if (relevant) {
    const tag = isLegacy ? "legacy special deal" : "special deal";
    // e.g. "legacy special deal: what we charge (L) $6.00 vs $9.00 — <exception msg>"
    return `${tag}: ${label} $${ours} vs $${lindita} — ${relevant.message}`;
  }

  // A legacy mismatch with NO supporting exception is NOT an accepted deal — it is an
  // unexplained legacy discrepancy to investigate. We keep the "legacy" framing (so it
  // is grouped/searchable) but explicitly mark it as unexplained rather than dressing
  // it up as a special deal (the system flags; it never waves a real bug through).
  if (isLegacy) {
    return `legacy line — ${label} $${ours} vs $${lindita}; mismatch not yet explained, review (NOT an accepted deal)`;
  }

  // Non-legacy mismatch with no supporting exception: no explanation — it is the bug to fix.
  return undefined;
}

/**
 * Reconcile our recreation against Lindita's manual August workbook.
 *
 * Deterministic: discrepancies and only-in-one lists preserve input order (rated
 * order first, then lindita order for onlyInLindita). No wall-clock, no randomness.
 */
export function reconcileAgainstLindita(
  rated: RatedLine[],
  lindita: LinditaLine[],
  cfg: PipelineConfig
): DiscrepancyReport {
  const tol = cfg.reconToleratedCents ?? 0;

  // Index Lindita rows by join key. If duplicate keys exist, keep the first and
  // leave the rest to surface as onlyInLindita (we do not silently merge).
  const linditaByKey = new Map<string, LinditaLine>();
  const linditaMatched = new Set<string>();
  for (const l of lindita) {
    const key = joinKey(l.partner, l.customer, l.sku);
    if (!linditaByKey.has(key)) linditaByKey.set(key, l);
  }

  const discrepancies: Discrepancy[] = [];
  const onlyInOurs: RatedLine[] = [];

  // Aggregate rated rows to the SAME grain buildInvoices uses (partner+customer+sku)
  // BEFORE comparing to Lindita. Rating emits one RatedLine per usage row and never
  // rolls up, but the invoice — and Lindita's manual file — carry one row per
  // partner+customer+sku. Without this, real usage with >1 row per key (mid-month
  // adds, per-product rows) would raise false discrepancies against a correct invoice
  // and break the acceptance gate. (See the aggregateByJoinKey helper below.)
  for (const r of aggregateByJoinKey(rated)) {
    const key = joinKey(r.partner, r.customer, r.sku.vendorSku);
    const l = linditaByKey.get(key);
    if (!l) {
      onlyInOurs.push(r);
      continue;
    }
    linditaMatched.add(key);

    // --- Compare UNIT ourPrice (H): RatedLine.hubCost vs LinditaLine.ourPrice ---
    if (!withinTolerance(r.hubCost, l.ourPrice, tol)) {
      const ours = r.hubCost.toFixed2();
      const other = l.ourPrice.toFixed2();
      discrepancies.push(
        withExplanation(
          {
            partner: r.partner,
            customer: r.customer,
            sku: r.sku.vendorSku,
            field: "ourPrice",
            ours,
            lindita: other,
            centsDiff: r.hubCost.centsDiff(l.ourPrice).toCents(),
          },
          explainPriceMismatch(r, "ourPrice", ours, other)
        )
      );
    }

    // --- Compare UNIT charge (L): RatedLine.mspPrice vs LinditaLine.charge ---
    if (!withinTolerance(r.mspPrice, l.charge, tol)) {
      const ours = r.mspPrice.toFixed2();
      const other = l.charge.toFixed2();
      discrepancies.push(
        withExplanation(
          {
            partner: r.partner,
            customer: r.customer,
            sku: r.sku.vendorSku,
            field: "charge",
            ours,
            lindita: other,
            centsDiff: r.mspPrice.centsDiff(l.charge).toCents(),
          },
          explainPriceMismatch(r, "charge", ours, other)
        )
      );
    }

    // --- Compare quantity (the driver — never optional) ---
    if (r.quantity !== l.quantity) {
      discrepancies.push({
        partner: r.partner,
        customer: r.customer,
        sku: r.sku.vendorSku,
        field: "quantity",
        ours: String(r.quantity),
        lindita: String(l.quantity),
      });
    }

    // --- Compare margin (it "follows" H and L; we recompute and cross-check) ---
    // Our margin is the unit margin (L - H) so it compares to Lindita's unit-level
    // ourPrice/charge world. If Lindita carries a margin, cross-check it; otherwise
    // derive hers as charge - ourPrice.
    const ourUnitMargin = r.mspPrice.sub(r.hubCost);
    const linditaMargin = l.margin ?? l.charge.sub(l.ourPrice);
    if (!withinTolerance(ourUnitMargin, linditaMargin, tol)) {
      discrepancies.push({
        partner: r.partner,
        customer: r.customer,
        sku: r.sku.vendorSku,
        field: "margin",
        ours: ourUnitMargin.toFixed2(),
        lindita: linditaMargin.toFixed2(),
        centsDiff: ourUnitMargin.centsDiff(linditaMargin).toCents(),
      });
    }
  }

  // Any Lindita row we never matched is only in Lindita (preserve her file order).
  const onlyInLindita: LinditaLine[] = lindita.filter(
    (l) => !linditaMatched.has(joinKey(l.partner, l.customer, l.sku))
  );

  // Totals = sum of extended charge (L * qty) on each side (the dollar picture).
  const totalOurs = sum(rated.map((r) => r.amountCharge));
  const totalLindita = sum(lindita.map((l) => l.charge.mul(l.quantity)));

  const matched =
    discrepancies.length === 0 && onlyInOurs.length === 0 && onlyInLindita.length === 0;

  return {
    period: cfg.period,
    matched,
    totalOurs,
    totalLindita,
    discrepancies,
    onlyInOurs,
    onlyInLindita,
  };
}

/** Cent-exact comparison with an optional cent tolerance (0 = exact). */
function withinTolerance(a: Money, b: Money, toleratedCents: number): boolean {
  if (toleratedCents <= 0) return a.equalsCents(b);
  return a.centsDiff(b).toCents() <= toleratedCents;
}

/** Attach an explanation to a Discrepancy only when one exists (keeps the shape clean). */
function withExplanation(d: Omit<Discrepancy, "explanation">, explanation?: string): Discrepancy {
  return explanation === undefined ? d : { ...d, explanation };
}

/**
 * Aggregate rated rows by partner+customer+sku (the invoice/Lindita grain), returning
 * one representative RatedLine per key in first-seen order. Single-row groups are
 * returned untouched; multi-row groups are merged (see mergeGroup). This is what keeps
 * the reconciler comparing what is actually invoiced, not raw usage lines.
 */
function aggregateByJoinKey(rated: readonly RatedLine[]): RatedLine[] {
  const groups = new Map<string, RatedLine[]>();
  const order: string[] = [];
  for (const r of rated) {
    const key = joinKey(r.partner, r.customer, r.sku.vendorSku);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(r);
    } else {
      groups.set(key, [r]);
      order.push(key);
    }
  }
  const out: RatedLine[] = [];
  for (const key of order) {
    const rows = groups.get(key)!;
    out.push(rows.length === 1 ? rows[0]! : mergeGroup(rows));
  }
  return out;
}

/**
 * Merge multiple rated rows that share partner+customer+sku into one aggregate:
 * quantity and extended amounts sum; the unit H/L is the shared unit price (rows for
 * the same partner+SKU get the same per-partner rate, so they match) — or, in the
 * pathological mixed-unit case, the extended amount divided by the total quantity.
 * Exceptions are unioned so an explanation can still be derived.
 */
function mergeGroup(rows: readonly RatedLine[]): RatedLine {
  const first = rows[0]!;
  const quantity = rows.reduce((acc, r) => acc + r.quantity, 0);
  const amountCost = sum(rows.map((r) => r.amountCost));
  const amountCharge = sum(rows.map((r) => r.amountCharge));

  const allSameUnit = rows.every(
    (r) => r.hubCost.equalsCents(first.hubCost) && r.mspPrice.equalsCents(first.mspPrice)
  );
  let hubCost: Money;
  let mspPrice: Money;
  if (allSameUnit || quantity === 0) {
    hubCost = first.hubCost;
    mspPrice = first.mspPrice;
  } else {
    // Rows carry differing unit prices for the same key (should not happen with a
    // per-partner rate card, but stay honest): derive the blended unit from extended.
    hubCost = amountCost.div(quantity);
    mspPrice = amountCharge.div(quantity);
  }

  return {
    period: first.period,
    partner: first.partner,
    customer: first.customer,
    sku: first.sku,
    quantity,
    hubCost,
    mspPrice,
    amountCost,
    amountCharge,
    margin: amountCharge.sub(amountCost),
    rate: first.rate,
    exceptions: rows.flatMap((r) => r.exceptions),
    sourceRow: first.sourceRow,
  };
}
