/**
 * Rate Cards — the FULL special-pricing card per partner: every product row of
 * the Coro Special MSP Pricing CSV, including partners with no usage this
 * month. "Partner pays" (col E, Net Price to MSP) is what the MSP pays MSP Hub
 * — it is the partner's price, never "our cost". "Sheet cost" is col H exactly
 * as written (untrusted; validated elsewhere against E×0.95 and the additive
 * rule). Sheet-math and card-level findings surface inline, never hidden.
 */
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useClose } from "@/lib/closeStore";
import type { ScreenProps } from "@/lib/nav";
import { money } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type {
  Exception,
  ExceptionKind,
  PricingPartner,
  PricingRow,
} from "@pipeline/domain/types.js";
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
}: {
  card: PricingPartner;
  active: boolean;
  findings: readonly Exception[];
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

  const contact = [card.contactName, card.contactEmail, card.approxMonthlySpend]
    .filter((v): v is string => v !== null && v.trim() !== "")
    .join(" · ");

  return (
    <Card>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm font-semibold text-foreground">{card.name}</CardTitle>
          {card.workspaceId !== null && (
            <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
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
              <TH className="text-right">Partner pays</TH>
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
                    </div>
                  </TD>
                  <TD className="tabular text-right">{moneyCell(row.listPrice)}</TD>
                  <TD className="tabular text-right">{fmtPct(row.mspDiscountPct)}</TD>
                  <TD className="tabular text-right">{fmtPct(row.hubDiscountPct)}</TD>
                  <TD className="tabular text-right font-semibold text-foreground">
                    {moneyCell(row.netMsp)}
                  </TD>
                  <TD className="tabular text-right text-muted-foreground">
                    {moneyCell(row.netHubStated)}
                  </TD>
                  <TD className="tabular text-right">{fmtPct(row.totalDiscountPct)}</TD>
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
  const { files, model } = useClose();
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
      <div className="mx-auto mt-16 max-w-md text-center text-sm text-muted-foreground">
        <p className="mb-3">
          No special-pricing file loaded — the rate card comes from the Coro Special MSP Pricing
          CSV.
        </p>
        <button
          className="text-primary underline"
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
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Rate cards</h1>
        <p className="text-sm text-muted-foreground">
          The full Coro special-pricing card per partner — every product, including ones with no
          usage this month. "Partner pays" is the net price to the MSP (what they pay MSP Hub).
        </p>
      </div>

      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-3 rounded-lg bg-background/95 px-2 py-2 backdrop-blur">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            data-testid="ratecard-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search partners by name or workspace id…"
            className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {partners.length} partners
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No partners match "{query}" — try a shorter name or a workspace-id fragment.
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((card) => (
            <PartnerCard
              key={`${card.name}#${card.sourceRow}`}
              card={card}
              active={card.workspaceId !== null && activeSlugs.has(card.workspaceId)}
              findings={model?.findings ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
