/**
 * Buffer + legacy-from-list utilities.
 *
 * These encode the ONLY two hardcoded rates in the system, both quoted verbatim
 * in the Sep 11 2026 call (see DATA_CONTRACTS.md "Business constants"):
 *
 *   - The +5% Hub buffer. Dane (README "Commercial model"): "we should have a 5%
 *     buffer on anything ... a legacy one where they're getting like a 60%
 *     discount ... we automatically should get a 65." => 0.60 -> 0.65.
 *   - Lisa's straight 45% legacy discount off list: "the legacy SKU cost in that
 *     tab and 45% ... the list price with the 45% discount. And that's yours."
 *
 * IMPORTANT: applyRates() must NOT invent a buffer. It uses the rate card's
 * explicit H and L as-is. `legacyHubCostFromList` is a utility for the DOCUMENTED
 * legacy-from-list path ONLY (when a legacy tab gives a list cost and implies the
 * 45% discount) — it is never auto-invoked inside the rating loop.
 */
import { Money } from "../lib/money.js";
import { BUSINESS } from "../config/pipeline.config.js";

/**
 * Layer the Hub buffer onto a partner's discount fraction.
 *
 * Dane's example: a partner on a 60% discount => Hub should get 65%. So this is
 * a simple additive bump of the discount fraction by `bufferPct` (default 5%).
 * Both inputs/outputs are fractions in the 0..1 space (0.60 => 0.65).
 *
 * Pure and deterministic. No clamping is performed — callers pass sane discounts;
 * clamping would hide a bad input rather than surface it.
 *
 * @param partnerDiscountFraction the partner's discount, 0..1 (e.g. 0.60).
 * @param bufferPct the Hub buffer, 0..1 (default BUSINESS.hubBufferPct = 0.05).
 * @returns the buffered discount fraction (e.g. 0.65).
 */
export function applyHubBuffer(
  partnerDiscountFraction: number,
  bufferPct: number = BUSINESS.hubBufferPct
): number {
  return partnerDiscountFraction + bufferPct;
}

/**
 * Compute Hub cost (H) from a legacy list price using Lisa's 45% legacy discount.
 *
 * Used ONLY on the documented legacy-from-list path — where a legacy pricing tab
 * gives a list/cost figure and implies the straight 45% discount ("straight
 * across the board for anyone on Legacy"). It is never auto-invoked by applyRates:
 * the rating loop always uses explicit rate-card H/L.
 *
 * @param listPrice the legacy list price from the pricing tab.
 * @param cfg.legacyDiscountPct override the 45% discount (default
 *        BUSINESS.legacyCoroDiscountPct).
 * @param cfg.bufferPct the Hub buffer to layer if `applyBuffer` is set (default
 *        BUSINESS.hubBufferPct).
 * @param cfg.applyBuffer when true, the effective discount is
 *        (legacyDiscountPct + bufferPct) per Dane's 60%->65% buffering rule; the
 *        buffer is IGNORED unless this flag is set.
 * @returns list price minus the (possibly buffered) legacy discount.
 */
export function legacyHubCostFromList(
  listPrice: Money,
  cfg?: { legacyDiscountPct?: number; bufferPct?: number; applyBuffer?: boolean }
): Money {
  const legacyDiscountPct = cfg?.legacyDiscountPct ?? BUSINESS.legacyCoroDiscountPct;
  const bufferPct = cfg?.bufferPct ?? BUSINESS.hubBufferPct;
  // Buffer is layered ONLY when explicitly requested (documented legacy path).
  const effectiveDiscount = cfg?.applyBuffer
    ? applyHubBuffer(legacyDiscountPct, bufferPct)
    : legacyDiscountPct;
  return listPrice.applyDiscount(effectiveDiscount);
}
