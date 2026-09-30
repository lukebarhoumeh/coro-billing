/**
 * Off-card confirmed rates — Coro (or the accounting team) has supplied a
 * bill-out rate AND a cost for a product that has NO row on the partner's
 * special-pricing card, so productMap resolves it to "none" and the line would
 * otherwise HOLD.
 *
 * This is the deliberate, curated exception to confirmedRates.ts's rule that an
 * override "corrects a price, never invents a product": an entry here is a rate
 * Coro confirmed IN WRITING for a product their own card omits. Same discipline
 * — reviewed in git, never guessed at run time — but it makes an otherwise-held
 * line billable, at the confirmed sell rate, with the confirmed additive cost
 * feeding the invoice credit cross-check exactly like a card row would.
 *
 * Kept SEPARATE from confirmedRates.ts (and its CONFIRMED_RATES_REVISION) on
 * purpose: a held line was never approvable in the web review, so adding one
 * here cannot silently attach a stale approval to a changed number — there is
 * nothing to invalidate, and every already-priced line is untouched.
 *
 *   sellRate     → drafted unit L (what the MSP pays Hub).
 *   expectedCost → the additive cost to MSP Hub; drives the credit cross-check
 *                  (actualHAmount − expectedCost × qty) on the loaded invoice.
 */
import { Money } from "../lib/money.js";

export interface OffCardRate {
  readonly sellRate: Money;
  readonly expectedCost: Money;
  /** Human label — there is no card row to name the product. */
  readonly productLabel: string;
  /** Provenance — the Coro correspondence that established the rate. */
  readonly source: string;
}

interface Entry {
  readonly sell: string;
  readonly cost: string;
  readonly label: string;
  readonly source: string;
}

/** Keyed `${card name, lowercased}|${vendor SKU, lowercased}`. */
const TABLE: Readonly<Record<string, Entry>> = {
  // S-3 (s3svccom) — MANAGED CORO ESSENTIALS Flex. S-3's 2026-09 card carries
  // no managed-essentials row; Coro invoice 2512 bills 94 × ~$5.78 = $542.85.
  // Brandon Udischas (Coro), 2026-09-30 email: $5.50 to the partner ($3.00
  // Essentials + $2.50 Managed), $4.88 to MSP Hub.
  "s-3|bucormngflex": {
    sell: "5.50",
    cost: "4.88",
    label: "Managed Coro Essentials Flex",
    source: "Coro (Brandon Udischas) 2026-09-30 email",
  },
};

/** The off-card confirmed rate for a partner×SKU, or null when none exists. */
export function resolveOffCardRate(cardName: string, vendorSku: string): OffCardRate | null {
  const entry = TABLE[`${cardName.trim().toLowerCase()}|${vendorSku.trim().toLowerCase()}`];
  if (entry === undefined) return null;
  return {
    sellRate: Money.of(entry.sell),
    expectedCost: Money.of(entry.cost),
    productLabel: entry.label,
    source: entry.source,
  };
}
