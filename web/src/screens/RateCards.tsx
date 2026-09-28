/**
 * Rate Cards — the FULL special-pricing card per partner: every product row of
 * the Coro Special MSP Pricing CSV, including partners with no usage this
 * month. "Partner pays" (col E, Net Price to MSP) is what the MSP pays MSP Hub
 * — it is the partner's price, never "our cost". "Sheet cost" is col H exactly
 * as written (untrusted; validated elsewhere against E×0.95 and the additive
 * rule). Sheet-math and card-level findings surface inline, never hidden.
 * Active partners also carry an indicative GP/GM line read from the close's
 * PartnerDraft (never recomputed here).
 *
 * Rate intelligence: rows that usage priced this month (joined to the close's
 * DraftLines by product label) carry confirmed-override provenance, the unit
 * margin vs our additive-rule cost, a below-cost alarm, and a month-over-month
 * rate diff read from the local close archive. All read-only — nothing here
 * recomputes pricing.
 */
import { useEffect, useMemo, useState } from "react";
import { Search, TriangleAlert } from "lucide-react";
import { useClose } from "@/lib/closeStore";
import type { ScreenProps } from "@/lib/nav";
import { money, gmPct, moneyStr } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type {
  DraftLine,
  Exception,
  ExceptionKind,
  PartnerDraft,
  PricingPartner,
  PricingRow,
} from "@pipeline/domain/types.js";
import type { CloseSnapshot } from "@pipeline/domain/snapshot.js";
import type { Money } from "@pipeline/lib/money.js";

/** Percent cells hold 0-100 numbers (60 ⇒ "60%") — NOT 0..1 fractions. */
function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}

/** Null money = blank/garbage source cell — rendered "—", never invented. */
function moneyCell(m: Money | null): string {
  return m === null ? "—" : money(m);
}

/** Card-level finding kinds surfaced under the partner header. */
const CARD_LEVEL_KINDS: ReadonlySet<ExceptionKind> = new Set<ExceptionKind>([
  "MISSING_WORKSPACE_ID",
  "DUPLICATE_WORKSPACE_ID",
  "DUPLICATE_RATE_ROW",
  "LIST_PRICE_DIVERGES",
]);

const CARD_KIND_LABEL: Partial<Record<ExceptionKind, string>> = {
  MISSING_WORKSPACE_ID: "missing workspace id",
  DUPLICATE_WORKSPACE_ID: "duplicate workspace id",
  DUPLICATE_RATE_ROW: "duplicate rate row",
  LIST_PRICE_DIVERGES: "list price diverges",
};

/** One partner block of an archived CloseSnapshot (the prior month's rates). */
type SnapPartner = CloseSnapshot["partners"][number];

/**
 * Per-row rate intelligence — the close's DraftLines this pricing row priced
 * this month (usually one; generic flex rows can carry several usage SKUs).
 * Confirmed-override provenance, unit margin vs the additive-rule cost, a
 * below-cost alarm, and the prior archived month's rate when it differs.
 */
function RowIntel({
  lines,
  prevUnitBySku,
  prevPeriod,
}: {
  lines: readonly DraftLine[];
  prevUnitBySku: ReadonlyMap<string, string>;
  prevPeriod: string | null;
}) {
  const overrides = lines.flatMap((l) =>
    l.findings.filter((f) => f.kind === "RATE_OVERRIDE_APPLIED")
  );
  // Unique unit margins (unitL − expectedHAdditive) across the row's priced lines.
  const margins = [
    ...new Set(
      lines
        .filter((l) => l.unitL !== null && l.expectedHAdditive !== null)
        .map((l) => l.unitL!.sub(l.expectedHAdditive!).toFixed2())
    ),
  ];
  const below = lines.find(
    (l) =>
      l.unitL !== null &&
      l.expectedHAdditive !== null &&
      l.unitL.toCents() < l.expectedHAdditive.toCents()
  );
  // Prior-month rates that differ from this month's draft (slug+sku join).
  const was = [
    ...new Set(
      lines.flatMap((l) => {
        if (l.unitL === null) return [];
        const prev = prevUnitBySku.get(l.vendorSku.toLowerCase());
        return prev !== undefined && prev !== l.unitL.toFixed2() ? [prev] : [];
      })
    ),
  ];
  if (overrides.length === 0 && margins.length === 0 && below === undefined && was.length === 0) {
    return null;
  }
  return (
    <>
      {overrides.length > 0 && (
        <Badge title={overrides.map((f) => f.message).join("\n")}>
          confirmed
          {overrides.length > 1 && ` ×${overrides.length}`}
        </Badge>
      )}
      {margins.map((fixed) => {
        const neg = fixed.startsWith("-");
        return (
          <Badge
            key={fixed}
            variant={neg ? "danger" : "success"}
            className="tabular"
            title="Unit margin: what the partner pays per unit minus our additive-rule cost"
          >
            {neg ? "−" : "+"}
            {moneyStr(neg ? fixed.slice(1) : fixed)}/unit
          </Badge>
        );
      })}
      {below !== undefined && (
        <Badge
          variant="danger"
          title={`Partner pays ${below.unitL!.toFixed2()}/unit — below our additive-rule cost ${below.expectedHAdditive!.toFixed2()}`}
        >
          <TriangleAlert className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
          below cost
        </Badge>
      )}
      {was.map((prev) => (
        <Badge
          key={prev}
          variant="muted"
          className="tabular"
          title={`${prevPeriod ?? "prior month"} billed rate — different this month`}
        >
          was {prev}
        </Badge>
      ))}
    </>
  );
}

/**
 * "Standard tier" = every row that carries BOTH discounts is 20% MSP + 25% Hub.
 * Requires at least one such row so an all-blank card is not mislabeled.
 */
function isStandardTier(rows: readonly PricingRow[]): boolean {
  const withBoth = rows.filter((r) => r.mspDiscountPct !== null && r.hubDiscountPct !== null);
  return (
    withBoth.length > 0 &&
    withBoth.every((r) => r.mspDiscountPct === 20 && r.hubDiscountPct === 25)
  );
}

function PartnerCard({
  card,
  active,
  findings,
  draft,
  prev,
  prevPeriod,
  riseIndex,
}: {
  card: PricingPartner;
  active: boolean;
  findings: readonly Exception[];
  /** The close's draft for this partner (slug === workspaceId); null for quiet partners. */
  draft: PartnerDraft | null;
  /** The same partner in the prior archived month's snapshot; null when absent. */
  prev: SnapPartner | null;
  /** The prior archived period ("2026-07"), for MoM chip tooltips. */
  prevPeriod: string | null;
  /** Staggered entrance index (capped by the caller). */
  riseIndex: number;
}) {
  // Card-level findings, grouped by kind so a noisy card stays one badge per kind.
  const cardFindings = useMemo(() => {
    const grouped = new Map<ExceptionKind, Exception[]>();
    for (const f of findings) {
      if (!CARD_LEVEL_KINDS.has(f.kind) || f.partner !== card.name) continue;
      const list = grouped.get(f.kind) ?? [];
      list.push(f);
      grouped.set(f.kind, list);
    }
    return [...grouped.entries()];
  }, [findings, card.name]);

  // Sheet-math findings keyed by product name for per-row badges.
  const mathByProduct = useMemo(() => {
    const map = new Map<string, Exception[]>();
    for (const f of findings) {
      if (f.kind !== "SHEET_MATH_INCONSISTENT" || f.partner !== card.name) continue;
      const list = map.get(f.sku) ?? [];
      list.push(f);
      map.set(f.sku, list);
    }
    return map;
  }, [findings, card.name]);

  // This month's DraftLines joined to pricing rows by product label — the
  // label IS the priced row's product for every line usage priced this month.
  const linesByProduct = useMemo(() => {
    const map = new Map<string, DraftLine[]>();
    for (const l of draft?.lines ?? []) {
      const list = map.get(l.productLabel) ?? [];
      list.push(l);
      map.set(l.productLabel, list);
    }
    return map;
  }, [draft]);

  // Prior archived month's unit rates by vendorSku (lowercased) for MoM diffs.
  const prevUnitBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of prev?.lines ?? []) {
      if (l.unitL !== undefined) map.set(l.vendorSku.toLowerCase(), l.unitL);
    }
    return map;
  }, [prev]);

  const contact = [card.contactName, card.contactEmail, card.approxMonthlySpend]
    .filter((v): v is string => v !== null && v.trim() !== "")
    .join(" · ");

  return (
    <Card className="fade-up" style={{ animationDelay: `${riseIndex * 40}ms` }}>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-display text-base font-semibold normal-case tracking-normal text-foreground">
            {card.name}
          </CardTitle>
          {card.workspaceId !== null && (
            <span className="rounded-full border border-edge bg-glass-3 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {card.workspaceId}
            </span>
          )}
          {active ? (
            <Badge variant="success">active this month</Badge>
          ) : (
            <Badge variant="muted">no usage</Badge>
          )}
          {isStandardTier(card.rows) && <Badge variant="info">standard tier</Badge>}
        </div>
        {draft !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="microlabel">Indicative GM (vs sheet cost)</span>
            <span className="tabular text-xs text-foreground">
              GP {money(draft.totalMargin)}
            </span>
            <Badge
              className="tabular"
              variant={draft.totalMargin.isNegative() ? "danger" : "success"}
              title="Gross margin this month: GP (draft margin) ÷ billed L, from the close's partner draft"
            >
              {gmPct(draft.totalMargin, draft.totalL)} GM
            </Badge>
          </div>
        )}
        {cardFindings.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {cardFindings.map(([kind, list]) => (
              <Badge
                key={kind}
                variant={severityVariant(list[0]!.severity)}
                title={list.map((f) => f.message).join("\n")}
              >
                {CARD_KIND_LABEL[kind] ?? kind}
                {list.length > 1 && ` ×${list.length}`}
              </Badge>
            ))}
          </div>
        )}
        {contact !== "" && <div className="text-xs text-muted-foreground">{contact}</div>}
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <THead>
            <TR>
              <TH>Product</TH>
              <TH className="text-right">List</TH>
              <TH className="text-right">MSP disc</TH>
              <TH className="text-right">Hub disc</TH>
              <TH className="text-right text-primary">Partner pays</TH>
              <TH className="text-right">Sheet cost</TH>
              <TH className="text-right">Total disc</TH>
            </TR>
          </THead>
          <TBody>
            {card.rows.map((row) => {
              const math = mathByProduct.get(row.product) ?? [];
              return (
                <TR key={row.sourceRow}>
                  <TD>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{row.product}</span>
                      {math.length > 0 && (
                        <Badge variant="warning" title={math.map((f) => f.message).join("\n")}>
                          sheet math
                        </Badge>
                      )}
                      {row.netMsp === null && <Badge variant="danger">no price</Badge>}
                      <RowIntel
                        lines={linesByProduct.get(row.product) ?? []}
                        prevUnitBySku={prevUnitBySku}
                        prevPeriod={prevPeriod}
                      />
                    </div>
                  </TD>
                  <TD className="tabular text-right text-muted-foreground">
                    {moneyCell(row.listPrice)}
                  </TD>
                  <TD className="tabular text-right text-muted-foreground">
                    {fmtPct(row.mspDiscountPct)}
                  </TD>
                  <TD className="tabular text-right text-muted-foreground">
                    {fmtPct(row.hubDiscountPct)}
                  </TD>
                  <TD className="tabular text-right font-medium text-foreground">
                    {moneyCell(row.netMsp)}
                  </TD>
                  <TD className="tabular text-right text-muted-foreground">
                    {moneyCell(row.netHubStated)}
                  </TD>
                  <TD className="tabular text-right text-muted-foreground">
                    {fmtPct(row.totalDiscountPct)}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function RateCardsScreen({ onNavigate, context }: ScreenProps) {
  const { files, model, period, archivePeriods, loadArchived } = useClose();
  const [query, setQuery] = useState(context ?? "");

  // Navigating here with a partner slug focuses the search on it.
  useEffect(() => {
    if (context !== undefined) setQuery(context);
  }, [context]);

  const payload = files.pricing?.payload;
  const pricing = payload?.slot === "pricing" ? payload.pricing : null;
  const partners = pricing?.partners ?? [];

  /** Slugs with usage this month — "active" partners in the close. */
  const activeSlugs = useMemo(
    () => new Set((model?.partners ?? []).map((p) => p.slug)),
    [model]
  );

  /** The close's drafts by slug — source of the card-level GP/GM line. */
  const draftBySlug = useMemo(
    () => new Map((model?.partners ?? []).map((p) => [p.slug, p])),
    [model]
  );

  // Prior archived month (local close archive) — powers the MoM rate diffs.
  const prevArchive = useMemo(() => {
    const prevPeriod = archivePeriods.filter((p) => p < period).at(-1) ?? null;
    const snap = prevPeriod !== null ? loadArchived(prevPeriod) : null;
    if (snap === null) return null;
    return { period: snap.period, bySlug: new Map(snap.partners.map((p) => [p.slug, p])) };
  }, [archivePeriods, period, loadArchived]);

  // Header intelligence counts, straight off the close model (null pre-close).
  const intelCounts = useMemo(() => {
    if (model === null) return null;
    const confirmed = model.findings.filter((f) => f.kind === "RATE_OVERRIDE_APPLIED").length;
    let belowCost = 0;
    for (const p of model.partners) {
      for (const l of p.lines) {
        if (
          l.unitL !== null &&
          l.expectedHAdditive !== null &&
          l.unitL.toCents() < l.expectedHAdditive.toCents()
        ) {
          belowCost += 1;
        }
      }
    }
    return { confirmed, belowCost };
  }, [model]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (q === "") return partners;
    return partners.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.workspaceId ?? "").toLowerCase().includes(q)
    );
  }, [partners, q]);

  if (pricing === null) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <p className="figure mb-2 text-xl text-foreground">No rate card on the ledger</p>
        <p className="mb-4 text-sm text-muted-foreground">
          No special-pricing file loaded — the rate card comes from the Coro Special MSP Pricing
          CSV.
        </p>
        <button
          className="text-sm text-primary underline underline-offset-4"
          data-testid="ratecard-goto-intake"
          onClick={() => onNavigate("intake")}
        >
          Go to intake
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="fade-up space-y-2">
        <h1 className="figure rule-brass text-2xl">Rate cards</h1>
        <p className="pt-1 text-sm text-muted-foreground">
          The full Coro special-pricing card per partner — every product, including ones with no
          usage this month. "Partner pays" is the net price to the MSP (what they pay MSP Hub).
        </p>
        {intelCounts !== null && (
          <div
            className="flex flex-wrap items-center gap-2 pt-1"
            data-testid="ratecard-intel-counts"
          >
            <Badge className="tabular">
              {intelCounts.confirmed} confirmed override{intelCounts.confirmed === 1 ? "" : "s"}
            </Badge>
            <span aria-hidden="true" className="text-xs text-muted-foreground">
              ·
            </span>
            <Badge variant={intelCounts.belowCost > 0 ? "danger" : "muted"} className="tabular">
              {intelCounts.belowCost} below-cost
            </Badge>
          </div>
        )}
      </div>

      <div
        className="fade-up sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-3 rounded-glass border border-edge bg-background/85 px-2 py-2 shadow-glass backdrop-blur-[12px] [border-top-color:hsl(var(--edge-hi))]"
        style={{ animationDelay: "40ms" }}
      >
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            data-testid="ratecard-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search partners by name or workspace id…"
            className="w-full rounded-md border border-edge bg-glass-1 py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <span className="microlabel tabular">
          {filtered.length} of {partners.length} partners
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No partners match "{query}" — try a shorter name or a workspace-id fragment.
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((card, i) => (
            <PartnerCard
              key={`${card.name}#${card.sourceRow}`}
              card={card}
              active={card.workspaceId !== null && activeSlugs.has(card.workspaceId)}
              findings={model?.findings ?? []}
              draft={
                card.workspaceId !== null ? (draftBySlug.get(card.workspaceId) ?? null) : null
              }
              prev={
                card.workspaceId !== null
                  ? (prevArchive?.bySlug.get(card.workspaceId) ?? null)
                  : null
              }
              prevPeriod={prevArchive?.period ?? null}
              riseIndex={Math.min(i + 2, 8)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
