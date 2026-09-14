/**
 * applyRates — the "magic sauce".
 *
 * For every usage line, attach H (our cost) and L (what we charge the MSP) from
 * the rate card, then compute amounts and margin:
 *
 *   amountCost   = H * qty
 *   amountCharge = L * qty
 *   margin       = amountCharge - amountCost   ("the margin stuff's automatically
 *                                                calculated" — Dane)
 *
 * Rules encoded here (README + ARCHITECTURE.md non-negotiables):
 *   - NEVER invent a rate. H/L come only from the rate card. On a miss we emit a
 *     blocking MISSING_RATE_CARD_ROW exception — never a house/average guess.
 *   - NEVER re-apply the buffer. The rate card's H/L are used AS-IS. Buffer
 *     semantics live only in the documented legacy-from-list utility (buffer.ts).
 *   - NEVER silently drop a usage row. A line with a blocking exception still
 *     appears in `rated` with zero/available values and the exception attached.
 *   - U/D are carried, never interpreted (info exception when present).
 *   - Quantity is the driver; zero/negative qty is a warning, not a drop.
 *   - Legacy stays visible; a missing legacy rate also flags LEGACY_RATE_UNCONFIRMED.
 *   - A "noise" SKU (couldn't be classified) blocks with SKU_CLASS_NOISE.
 *
 * Deterministic: no wall-clock/random. Exceptions are emitted in input order.
 */
import type {
  RateCard,
  RateCardEntry,
  RatingResult,
  RatedLine,
  UsageLine,
  Exception,
  ExceptionKind,
} from "../domain/types.js";
import type { PipelineConfig } from "../config/pipeline.config.js";
import { Money } from "../lib/money.js";

/** Small helper to construct an Exception tied to a usage line. */
function makeException(
  kind: ExceptionKind,
  severity: Exception["severity"],
  usage: UsageLine,
  message: string
): Exception {
  return {
    kind,
    severity,
    partner: usage.partner,
    customer: usage.customer,
    sku: usage.sku.vendorSku,
    period: usage.period,
    message,
    sourceRow: usage.sourceRow,
  };
}

/**
 * A synthetic zero rate row used when there is no rate-card match, so a RatedLine
 * still has a (traceable) `rate` object instead of null. It carries zero H/L and
 * a `source` that marks it as a miss — it is never treated as a real price.
 */
function missingRate(usage: UsageLine): RateCardEntry {
  return {
    partner: usage.partner,
    sku: usage.sku.vendorSku,
    period: usage.period,
    class: usage.sku.class,
    hubCost: Money.zero(),
    mspPrice: Money.zero(),
    source: "MISSING",
    raw: {},
  };
}

export function applyRates(
  usage: UsageLine[],
  rateCard: RateCard,
  cfg: PipelineConfig
): RatingResult {
  const rated: RatedLine[] = [];
  const aggregate: Exception[] = [];

  for (const line of usage) {
    const lineExceptions: Exception[] = [];

    // --- U/D: carried, never interpreted (Dane: "I don't really know what U and
    // D mean"). Informational only. ---
    if (line.u.raw !== null || line.d.raw !== null) {
      lineExceptions.push(
        makeException(
          "UNKNOWN_UD_FIELD",
          "info",
          line,
          `U/D present but meaning unknown (carried, not interpreted): ` +
            `u=${JSON.stringify(line.u.raw)}, d=${JSON.stringify(line.d.raw)}`
        )
      );
    }

    // --- Quantity is the driver; zero/negative is a warning (never a drop). ---
    if (line.quantity <= 0) {
      lineExceptions.push(
        makeException(
          "NEGATIVE_OR_ZERO_QTY",
          "warn",
          line,
          `quantity is ${line.quantity} (<= 0); usage is the bill driver — review`
        )
      );
    }

    // --- SKU classification noise: cannot be priced as current or legacy. ---
    if (line.sku.class === "noise") {
      lineExceptions.push(
        makeException(
          "SKU_CLASS_NOISE",
          "block",
          line,
          `SKU could not be classified as current or legacy (class="noise") — review`
        )
      );
    }

    // --- Rate lookup: per-partner + per-SKU + period + CLASS. NEVER an average. ---
    // Passing the usage line's class makes lookup prefer a same-class rate row when
    // the partner+SKU appears on both the current and legacy tabs, so a legacy line
    // is never silently priced from a current row (the "$6 vs $9" landmine). A genuine
    // cross-class fallback is still surfaced by the "legacy priced as current" check.
    const found = rateCard.lookup(line.partner, line.sku.vendorSku, line.period, line.sku.class);

    let hubCost: Money;
    let mspPrice: Money;
    let rate: RateCardEntry;

    if (found === null) {
      // Miss: retain the line with zero values + a blocking exception.
      rate = missingRate(line);
      hubCost = Money.zero();
      mspPrice = Money.zero();
      lineExceptions.push(
        makeException(
          "MISSING_RATE_CARD_ROW",
          "block",
          line,
          `no rate-card row for partner="${line.partner}" sku="${line.sku.vendorSku}" ` +
            `period="${line.period}" (rates are per-partner — no house/average fallback)`
        )
      );
      // Legacy is the landmine (Dane: "$6 vs $9"; Lisa: legacy rows still changing).
      // When a *legacy* usage line has no rate yet, additionally flag it so
      // accounting knows this is the "Jack's legacy export not landed" case.
      if (line.sku.class === "legacy" || line.sku.isLegacy) {
        lineExceptions.push(
          makeException(
            "LEGACY_RATE_UNCONFIRMED",
            "warn",
            line,
            `legacy SKU has no confirmed rate-card row yet — treat as an exception, ` +
              `not a guess (legacy rows are still changing per Coro)`
          )
        );
      }
    } else {
      rate = found;
      hubCost = found.hubCost;
      mspPrice = found.mspPrice;

      // H present? Dane's column H must exist or we can't state our cost.
      if (found.hubCost.isZero()) {
        lineExceptions.push(
          makeException(
            "MISSING_HUB_COST",
            "block",
            line,
            `rate-card row found but H (our price / hubCost) is zero`
          )
        );
      }
      // L present? Column L is what we charge the MSP.
      if (found.mspPrice.isZero()) {
        lineExceptions.push(
          makeException(
            "MISSING_MSP_PRICE",
            "block",
            line,
            `rate-card row found but L (what we're charging / mspPrice) is zero`
          )
        );
      }
    }

    // --- Amounts + margin. Quantity multiplies exact-decimal money. ---
    // Negative qty flows through arithmetically (already flagged), but the ledger
    // stays honest: amountCost = H*qty, amountCharge = L*qty, margin = charge-cost.
    const amountCost = hubCost.mul(line.quantity);
    const amountCharge = mspPrice.mul(line.quantity);
    const margin = amountCharge.sub(amountCost);

    rated.push({
      period: line.period,
      partner: line.partner,
      customer: line.customer,
      sku: line.sku,
      quantity: line.quantity,
      hubCost,
      mspPrice,
      amountCost,
      amountCharge,
      margin,
      rate,
      exceptions: lineExceptions,
      sourceRow: line.sourceRow,
    });

    // Aggregate list mirrors per-line exceptions, in input order (deterministic).
    for (const ex of lineExceptions) aggregate.push(ex);
  }

  return { rated, exceptions: aggregate };
}
