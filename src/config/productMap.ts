/**
 * Usage product-code → special-pricing row resolution.
 *
 * The usage report keys consumption by Coro product CODE (column J: COR-COMP-C,
 * BUCOROflex, MODNETWflex…) while the special-pricing CSV keys rates by product
 * NAME ("Coro AI Complete", "Modules Flex"). This module is the curated bridge —
 * like src/config/partners.ts, it is CODE reviewed in git, never guessed at
 * runtime.
 *
 * Business anchors:
 *   - Luke (2026-09-21): "under the usage report on column J where it says MOD
 *     first that is a module flex sku … the product will say just NETWORK then
 *     the product code will be MODNETWflex that = modules flex." Refinements
 *     locked in the same conversation: a partner's product-SPECIFIC flex row
 *     (Amplivity "Network Flex") beats the generic Modules Flex rate, and
 *     Modsatflex prices from "SAT Flex" where it exists (exactly how Coro billed
 *     Evolve on invoice 2193 line 14).
 *   - ADD*flex (ADDSECUREWEBflex, ADDMDRflex) is ASSUMED to price like modules —
 *     Coro billed Cyber Construction's ADDSECUREWEBflex at the same 2.20 rate as
 *     its MOD lines — but nobody has confirmed it, so matches carry kind
 *     "assumed-add" and the close raises ASSUMED_MAPPING.
 *   - *-NFR codes are not-for-resale: listed, never billed.
 *   - A miss returns kind "none" — NEVER a cross-product or cross-partner
 *     fallback (Dane: "all these partners are on different stuff").
 */
import type { PricingPartner, PricingRow } from "../domain/types.js";
import { normalizeProduct } from "../ingest/specialPricing.js";

export type MatchKind =
  | "exact" // code's own product row (current-gen name or the bundle's flex row)
  | "specific-flex" // MOD code matched its product-specific flex row ("Network Flex")
  | "modules-flex" // MOD/ADD/SAT code matched a generic modules-flex row
  | "sat-flex" // Modsatflex matched the partner's "SAT Flex" row
  | "fallback-current" // legacy/flex code priced from the current-gen row (surfaced)
  | "assumed-add" // ADD*flex matched via the modules chain — unconfirmed mapping
  | "nfr" // not-for-resale — non-billable
  | "none"; // no pricing row at all — the close HOLDS the line

export interface RowMatch {
  readonly row: PricingRow | null;
  readonly kind: MatchKind;
  /** Human-readable why, for findings/UI. */
  readonly reason: string;
}

/** Current-gen codes → their product row name(s), in preference order. */
const CURRENT_EXACT: Readonly<Record<string, readonly string[]>> = {
  "cor-comp-c": ["coro ai complete"],
  "cor-ess-c": ["coro ai essentials"],
  "cor-endp-c": ["coro ai endpoint"],
  "cor-lte-c": ["coro ai lite"],
  "cor-manage-c": ["coro managed/monthly", "coro managed"],
};

/** MOD code → its product-specific flex row name(s). */
const MOD_SPECIFIC: Readonly<Record<string, readonly string[]>> = {
  modnetwflex: ["network flex"],
  modemailflex: ["email flex"],
  modusrdataflex: ["user data flex"],
  modendsecflex: ["endpoint security flex"],
  modenddataflex: ["endpoint data flex"],
  modcloudflex: ["cloud flex"],
};

/** Generic modules rows, in preference order (both spellings seen in the real CSV). */
const GENERIC_MODULES: readonly string[] = ["modules flex", "coro module flex"];
/** Current-gen modules row — last resort for MOD codes, surfaced as fallback. */
const MODULES_CURRENT: readonly string[] = ["coro ai modules"];

/** Legacy bundle codes → flex row names (kind exact) then current-gen fallbacks. */
const LEGACY_BUNDLES: Readonly<
  Record<string, { readonly flex: readonly string[]; readonly current: readonly string[] }>
> = {
  bucomflex: { flex: ["complete flex"], current: ["coro ai complete"] },
  bucoroflex: { flex: ["essentials flex"], current: ["coro ai essentials"] },
  bucoclassflex: { flex: ["classic flex", "coro classic flex", "coro classic"], current: [] },
  bucoclassmnflex: { flex: ["managed classic flex", "classic flex"], current: [] },
  bucommngflex: {
    flex: ["complete managed flex", "complete flex"],
    current: ["coro ai complete"],
  },
  buendflex: { flex: ["endpoint protection flex"], current: ["coro ai endpoint"] },
  buemailflex: { flex: ["email protection flex", "email flex"], current: [] },
};

function findRow(partner: PricingPartner, names: readonly string[]): PricingRow | null {
  for (const name of names) {
    const hit = partner.rows.find((r) => normalizeProduct(r.product) === name);
    if (hit) return hit;
  }
  return null;
}

function miss(vendorSku: string, partner: PricingPartner): RowMatch {
  return {
    row: null,
    kind: "none",
    reason: `no pricing row for code "${vendorSku}" on ${partner.name}'s card`,
  };
}

/**
 * Resolve a usage product code against ONE partner's special-pricing block.
 * First hit in the code's preference chain wins; a miss is "none", never a guess.
 */
export function resolvePricingRow(partner: PricingPartner, vendorSku: string): RowMatch {
  const code = vendorSku.trim().toLowerCase();

  if (/-nfr$/.test(code)) {
    return { row: null, kind: "nfr", reason: `${vendorSku} is not-for-resale — never billed` };
  }

  const current = CURRENT_EXACT[code];
  if (current) {
    const row = findRow(partner, current);
    return row
      ? { row, kind: "exact", reason: `${vendorSku} → "${row.product}"` }
      : miss(vendorSku, partner);
  }

  if (code === "modsatflex") {
    const sat = findRow(partner, ["sat flex"]);
    if (sat) {
      return { row: sat, kind: "sat-flex", reason: `Modsatflex → "${sat.product}"` };
    }
    // No SAT row: SAT is a module — fall through the modules chain.
    return resolveModulesChain(partner, vendorSku, "modules-flex");
  }

  if (code.startsWith("mod")) {
    const specific = MOD_SPECIFIC[code];
    if (specific) {
      const row = findRow(partner, specific);
      if (row) {
        return {
          row,
          kind: "specific-flex",
          reason: `${vendorSku} → partner's product-specific "${row.product}" row`,
        };
      }
    }
    return resolveModulesChain(partner, vendorSku, "modules-flex");
  }

  if (code.startsWith("add")) {
    const m = resolveModulesChain(partner, vendorSku, "assumed-add");
    return m.kind === "none"
      ? m
      : {
          ...m,
          kind: "assumed-add",
          reason: `${vendorSku} priced via the Modules Flex chain ("${m.row!.product}") — ASSUMED, unconfirmed`,
        };
  }

  const legacy = LEGACY_BUNDLES[code];
  if (legacy) {
    const flexRow = findRow(partner, legacy.flex);
    if (flexRow) {
      return { row: flexRow, kind: "exact", reason: `${vendorSku} → "${flexRow.product}"` };
    }
    const currentRow = findRow(partner, legacy.current);
    if (currentRow) {
      return {
        row: currentRow,
        kind: "fallback-current",
        reason: `${vendorSku} has no flex row on ${partner.name}'s card — priced from current-gen "${currentRow.product}"`,
      };
    }
    return miss(vendorSku, partner);
  }

  return miss(vendorSku, partner);
}

/** MOD/ADD/SAT shared tail: generic modules rows, then the current-gen modules row. */
function resolveModulesChain(
  partner: PricingPartner,
  vendorSku: string,
  genericKind: "modules-flex" | "assumed-add"
): RowMatch {
  const generic = findRow(partner, GENERIC_MODULES);
  if (generic) {
    return {
      row: generic,
      kind: genericKind,
      reason: `${vendorSku} = Modules Flex (Luke 2026-09-21) → "${generic.product}"`,
    };
  }
  const currentRow = findRow(partner, MODULES_CURRENT);
  if (currentRow) {
    return {
      row: currentRow,
      kind: "fallback-current",
      reason: `${vendorSku} = Modules Flex but ${partner.name}'s card has no flex row — priced from "${currentRow.product}"`,
    };
  }
  return miss(vendorSku, partner);
}
