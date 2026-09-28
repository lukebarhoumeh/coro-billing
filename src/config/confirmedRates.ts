/**
 * Confirmed bill-out rates — the accounting team's QB invoices are the pricing
 * authority (Luke, 2026-09-28: "whatever Lida sends is the truth — whatever
 * pricing she has on that sheet is correct").
 *
 * Every entry was derived line-by-line from Lita's QB P&L Detail export
 * ("MSP HUB, LLC_Profit and Loss Detail, Coro, July + August.xlsx", sent
 * 2026-09-28) via scripts/qbLedgerReconcile.mts, and is CURATED here — reviewed
 * in git, never guessed at run time (same discipline as PARTNER_SLUG_MAP).
 *
 * Semantics: when a confirmed rate exists for (partner card name, vendor SKU),
 * it IS the drafted unit L. The pricing CSV's col E stays visible — a
 * RATE_OVERRIDE_APPLIED (info) finding names both numbers whenever they
 * disagree, so nothing is silent. A confirmed rate only applies to lines whose
 * product code resolves to a card row (current/legacy/fallback/mislabel); an
 * unknown code still HOLDS — the override corrects a price, it never invents a
 * product.
 *
 * Rocker's legacy rows are included even though Coro's August audit carries no
 * Rocker legacy usage (fully migrated to CORO AI Complete): IF those units
 * reappear (September) they price at her invoiced rates instead of holding.
 * Whether they should bill at all is the open Rocker question from the
 * 2026-09-29 call prep (docs/LITA_CALL_PREP_2026-09-29.md).
 */
import { Money } from "../lib/money.js";

/**
 * Participates in the web review/pushed localStorage keys (loadFiles.ts,
 * qbo.ts) — bump on ANY table change so stale approvals and pushed-state from
 * the previous rates invalidate instead of silently attaching to new numbers.
 */
export const CONFIRMED_RATES_REVISION = 1;

export interface ConfirmedRate {
  readonly rate: Money;
  /** Provenance — which of her QB invoices established the rate. */
  readonly source: string;
}

interface Entry {
  readonly rate: string;
  readonly source: string;
}

/** Keyed `${card name, lowercased}|${vendor SKU, lowercased}`. */
const TABLE: Readonly<Record<string, Entry>> = {
  // --- Avox (her QB customer: AVOX LLC) ---
  "avox|bucoroflex": { rate: "6.00", source: "QB inv 10546, 50×6.00" },

  // --- Cyber Construction (her QB: Cyber Construction, Inc.) ---
  "cyber construction|bucoroflex": { rate: "6.00", source: "QB inv 10597, 31×6.00" },
  "cyber construction|bucomflex": { rate: "8.90", source: "QB inv 10597, 3×8.90" },
  "cyber construction|bucoclassflex": { rate: "6.59", source: "QB inv 10597, 41×6.59" },
  "cyber construction|bucoclassmnflex": { rate: "9.35", source: "QB inv 10597, 10×9.35" },
  "cyber construction|modemailflex": { rate: "2.50", source: "QB inv 10597, modules at 2.50" },
  "cyber construction|modenddataflex": { rate: "2.50", source: "QB inv 10597, modules at 2.50" },
  "cyber construction|modendsecflex": { rate: "2.50", source: "QB inv 10597, modules at 2.50" },
  "cyber construction|modnetwflex": { rate: "2.50", source: "QB inv 10597, modules at 2.50" },
  "cyber construction|modusrdataflex": { rate: "2.50", source: "QB inv 10597, modules at 2.50" },
  "cyber construction|modcloudflex": { rate: "2.50", source: "QB inv 10597, modules at 2.50" },
  "cyber construction|addsecurewebflex": { rate: "2.50", source: "QB inv 10597, modules at 2.50" },

  // --- Net-Tech (her QB: Net-Tech) ---
  "net-tech|bucoclassflex": { rate: "6.59", source: "QB inv 10550, 207×6.59" },
  "net-tech|buemailflex": { rate: "4.12", source: "QB inv 10550, 100×4.12" },
  "net-tech|modcloudflex": { rate: "2.50", source: "QB inv 10550, modules at 2.50" },
  "net-tech|modemailflex": { rate: "2.50", source: "QB inv 10550, modules at 2.50" },
  "net-tech|modenddataflex": { rate: "2.50", source: "QB inv 10550, modules at 2.50" },
  "net-tech|modendsecflex": { rate: "2.50", source: "QB inv 10550, modules at 2.50" },
  "net-tech|modnetwflex": { rate: "2.50", source: "QB inv 10550, modules at 2.50" },
  "net-tech|modusrdataflex": { rate: "2.50", source: "QB inv 10550, modules at 2.50" },

  // --- Amplivity ---
  "amplivity|modnetwflex": { rate: "2.50", source: "QB inv 10603, 13×2.50" },

  // --- Evolve Technologies (her QB: Evolve Technologies, LLC.) ---
  "evolve technologies|bucomflex": { rate: "8.90", source: "QB inv 10600, 18×8.90" },
  "evolve technologies|bucommngflex": { rate: "14.50", source: "QB inv 10600, 16×14.50" },
  "evolve technologies|modsatflex": { rate: "1.10", source: "QB inv 10600, 6×1.10" },

  // --- GOA-Tech ---
  "goa-tech|bucoclassflex": { rate: "6.59", source: "QB inv 10551, 14×6.59" },

  // --- Rocker (her QB: Rocker LLC) — see header note; no Aug usage for these ---
  "rocker|bucomflex": { rate: "8.25", source: "QB inv 10558/10601, 11×8.25" },
  "rocker|bucoclassflex": { rate: "6.60", source: "QB inv 10558/10601, 56×6.60" },

  // --- Teledata Cloud Services (her QB: TDI Technologies, Inc.) ---
  "teledata cloud services|bucoroflex": { rate: "6.00", source: "QB inv 10599 (TDI), 4×6.00" },
  "teledata cloud services|buendflex": { rate: "4.12", source: "QB inv 10599 (TDI), 16×4.12" },

  // --- XTB Solutions (her QB: XTB Solutions, LLC.) ---
  "xtb solutions|bucoroflex": { rate: "6.00", source: "QB inv 10598, 39×6.00" },
  "xtb solutions|bucomflex": { rate: "8.90", source: "QB inv 10598, 25×8.90" },
  "xtb solutions|buendflex": { rate: "4.13", source: "QB inv 10598, 7×4.13" },
};

/** The confirmed bill-out rate for a partner×SKU, or null when the card rules. */
export function resolveConfirmedRate(cardName: string, vendorSku: string): ConfirmedRate | null {
  const entry = TABLE[`${cardName.trim().toLowerCase()}|${vendorSku.trim().toLowerCase()}`];
  if (entry === undefined) return null;
  return { rate: Money.of(entry.rate), source: entry.source };
}
