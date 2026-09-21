/**
 * Partner identity — Coro workspace slugs → invoice names.
 *
 * The two real August files disagree on partner identity (docs/AUGUST_CLOSE_PLAN.md
 * fact 6): usage keys partners by workspace slug (`amplivitycom_NE7N_b`), the invoice
 * by clean name (`Amplivity`). Automatic matching fails for several
 * (`techlpcom` → Techlead Professional Services LLC, `evolvewithuscom` → Evolve
 * Technologies, `itnsgroupcom` → IT Network Solutions Group LLC), so the map is
 * CURATED — reviewed in git, never guessed at run time (decision D6).
 *
 * An unmapped slug is returned cleaned-but-unmapped and the caller must surface an
 * UNMAPPED_PARTNER exception — the close never silently invents a partner identity.
 *
 * Hurricane IT is mapped even though it has no line on invoice 2193: it appears
 * in August usage (NFR — consumed but unbilled, surfaced as USAGE_NOT_ON_INVOICE).
 *
 * vaimancom → "AVOX LLC": invoice 2193 bills this workspace's consumption under
 * "AVOX LLC" (the special-pricing sheet calls the partner "Avox"). The map's
 * original "Vaiman" guess made 2193's AVOX line look like it had no usage —
 * corrected 2026-09-21 (the "Vaiman consumed-but-unbilled" finding was a naming
 * artifact, not a real gap).
 */

/** `amplivitycom_NE7N_b` → `amplivitycom`. The `_XXXX_b` suffix is Coro's workspace id. */
export function stripWorkspaceSuffix(slug: string): string {
  return slug.trim().replace(/_[A-Z0-9]{3,6}_b$/i, "");
}

/**
 * Curated slug → invoice-name map (August 2026 packet; extend as partners appear).
 * Keys are post-stripWorkspaceSuffix, lowercased.
 */
export const PARTNER_SLUG_MAP: Readonly<Record<string, string>> = {
  amplivitycom: "Amplivity",
  beneintcom: "BeNe International",
  "cyber-constructioncom": "Cyber Construction",
  evolvewithuscom: "Evolve Technologies",
  "goa-techcom": "GOA-TECH",
  "hurricane-itcom": "Hurricane IT",
  idealtechhelp: "Ideal Tech Help",
  itnsgroupcom: "IT Network Solutions Group LLC",
  meetingtreecomputercom: "Meeting Tree Computer",
  "net-techus": "Net-Tech Consulting",
  rockerio: "Rocker",
  techlpcom: "Techlead Professional Services LLC",
  teledatauscom: "Teledata Cloud Services",
  vaimancom: "AVOX LLC",
  viener4gatescom: "Viener4Gates",
  xtbsolutionscom: "XTB Solutions",
};

/** Canonical invoice names, for recognizing an already-canonical input. */
const CANONICAL_NAMES = new Map<string, string>(
  Object.values(PARTNER_SLUG_MAP).map((name) => [name.toLowerCase(), name])
);

export interface CanonicalPartner {
  /** The invoice-side partner name when mapped; the cleaned slug otherwise. */
  readonly name: string;
  /** False when the slug is not in the curated map — caller must flag, not guess. */
  readonly mapped: boolean;
}

/**
 * Resolve a usage-side partner identifier (slug or already-clean name) to the
 * invoice-side canonical name. Deterministic; no fuzzy matching beyond the curated map.
 */
export function canonicalPartner(raw: string): CanonicalPartner {
  const trimmed = raw.trim();
  // Already a canonical invoice name (e.g. tests or a future clean feed)?
  const asName = CANONICAL_NAMES.get(trimmed.toLowerCase());
  if (asName !== undefined) return { name: asName, mapped: true };

  const slug = stripWorkspaceSuffix(trimmed).toLowerCase();
  const mapped = PARTNER_SLUG_MAP[slug];
  if (mapped !== undefined) return { name: mapped, mapped: true };

  // Unmapped: return the cleaned slug so output stays readable and deterministic,
  // but flag it — the close raises UNMAPPED_PARTNER rather than pretend.
  return { name: stripWorkspaceSuffix(trimmed), mapped: false };
}
