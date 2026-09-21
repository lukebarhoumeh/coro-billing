/** Display helpers. Money is rendered from the pipeline's exact-decimal Money. */
import type { Money } from "@pipeline/lib/money.js";

/** Group the integer part with thousands separators, preserving sign + 2 decimals. */
export function group(fixed: string): string {
  const neg = fixed.startsWith("-");
  const s = neg ? fixed.slice(1) : fixed;
  const [int, dec] = s.split(".");
  const withCommas = (int ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + withCommas + (dec ? "." + dec : "");
}

/** "$1,234.50" from a Money. */
export function money(m: Money): string {
  return "$" + group(m.toFixed2());
}

/** "$1,234.50" from an already-formatted "1234.50" string (e.g. discrepancy fields). */
export function moneyStr(fixed: string): string {
  return "$" + group(fixed);
}

/** A percent from a 0..1 fraction, e.g. 0.45 -> "45%". */
export function pct(fraction: number | undefined): string {
  if (fraction == null) return "—";
  return `${Math.round(fraction * 1000) / 10}%`;
}

/**
 * Gross margin percent for MSP Hub: GM = GP ÷ revenue (billed L).
 * GP is the Money margin the close computed; revenue is the billed amount.
 * "—" when either is missing or revenue is zero (held/NFR-only drafts).
 */
export function gmPct(gp: Money | null, revenue: Money | null): string {
  if (gp === null || revenue === null || revenue.isZero()) return "—";
  return pct(gp.toNumber() / revenue.toNumber());
}
