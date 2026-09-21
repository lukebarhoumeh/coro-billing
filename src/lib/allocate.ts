/**
 * Largest-remainder allocation — split an integer total (units, or cents) across
 * weighted buckets so the parts ALWAYS sum exactly to the total.
 *
 * Used by the invoice-driven close (docs/AUGUST_CLOSE_PLAN.md decision D1): invoice
 * quantity is allocated to customers by usage weights, and the invoice Subtotal's
 * cents are allocated by the resulting quantities. Naive proportional rounding can
 * gain/lose units or cents; largest remainder cannot.
 *
 * Deterministic tie-breaking: larger fractional remainder first, then larger weight,
 * then lower index. No clock, no randomness.
 */
import { Money } from "./money.js";

/**
 * Allocate an integer `total` across `weights.length` buckets proportionally to
 * non-negative `weights`. Guarantees `sum(result) === total` and every part >= 0
 * (when total >= 0).
 *
 * Degenerate cases:
 *  - empty weights → [] (caller decides what a no-bucket allocation means);
 *  - all-zero weights → everything lands in bucket 0 (deterministic, surfaced by
 *    the caller as a partner-level line, never split arbitrarily).
 *
 * Throws on negative weights or a non-integer total — those are programming errors
 * (like Money.div by zero), not data conditions.
 */
export function allocateInteger(total: number, weights: readonly number[]): number[] {
  if (!Number.isInteger(total)) {
    throw new Error(`allocateInteger: total must be an integer, got ${total}`);
  }
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new Error(`allocateInteger: weights must be finite and non-negative`);
  }
  if (weights.length === 0) return [];

  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    const out = new Array<number>(weights.length).fill(0);
    out[0] = total;
    return out;
  }

  // Negative totals (credit lines) allocate on absolute value, sign restored at the end.
  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);

  const floors = new Array<number>(weights.length);
  const remainders = new Array<number>(weights.length);
  let allocated = 0;
  for (let i = 0; i < weights.length; i++) {
    const exact = (absTotal * weights[i]!) / weightSum;
    floors[i] = Math.floor(exact);
    remainders[i] = exact - floors[i]!;
    allocated += floors[i]!;
  }

  let leftover = absTotal - allocated;
  // Order buckets for the leftover units: fractional remainder desc, weight desc, index asc.
  const order = weights
    .map((w, i) => i)
    .sort((a, b) => {
      const r = remainders[b]! - remainders[a]!;
      if (r !== 0) return r;
      const w = weights[b]! - weights[a]!;
      if (w !== 0) return w;
      return a - b;
    });
  for (const i of order) {
    if (leftover === 0) break;
    floors[i]! += 1;
    leftover -= 1;
  }

  return sign === 1 ? floors : floors.map((v) => -v);
}

/**
 * Allocate a Money total's CENTS across buckets proportionally to `weights`.
 * Guarantees the parts sum to the total cent-exact.
 */
export function allocateCents(total: Money, weights: readonly number[]): Money[] {
  const cents = allocateInteger(total.toCents(), weights);
  // Money.of(cents).div(100) stays in exact decimal arithmetic end to end.
  return cents.map((c) => Money.of(c).div(100));
}
