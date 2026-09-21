/**
 * Overview — the month at a glance.
 *
 * KPI row (billed / cost / margin / partners / findings), margin-by-partner
 * bars that jump into the per-MSP draft, the two-cost-rules callout (sheet
 * ×0.95 vs Coro's additive discount stacking), and a held-lines warning.
 * All figures come straight off the CloseModel; HELD lines are excluded from
 * every total and surfaced separately — never rendered as zero-dollar rows.
 */
import type { ReactNode } from "react";
import {
  CircleAlert,
  Receipt,
  Scale,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import { Money, sum } from "@pipeline/lib/money.js";
import type { CloseModel, PartnerDraft } from "@pipeline/domain/types.js";
import { useClose } from "@/lib/closeStore";
import type { ScreenProps } from "@/lib/nav";
import { money, pct } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const SEVERITIES = ["block", "warn", "info"] as const;

interface Aggregates {
  readonly billed: Money;
  readonly costExpected: Money;
  readonly costActual: Money | null;
  readonly margin: Money;
  readonly marginFraction: number | undefined;
  readonly severityCounts: Readonly<Record<(typeof SEVERITIES)[number], number>>;
  readonly byBilled: readonly PartnerDraft[];
  readonly maxBilledCents: number;
  readonly sheetTotal: Money;
  readonly additiveTotal: Money;
  readonly rulesDelta: Money;
  readonly heldTotal: number;
  readonly heldPartners: readonly PartnerDraft[];
}

function aggregate(model: CloseModel): Aggregates {
  const billed = sum(model.partners.map((p) => p.totalL));
  const costExpected = sum(model.partners.map((p) => p.totalHExpected));
  const actuals = model.partners
    .map((p) => p.totalHActual)
    .filter((h): h is Money => h !== null);
  const costActual = actuals.length > 0 ? sum(actuals) : null;
  const margin = sum(model.partners.map((p) => p.totalMargin));
  const marginFraction = billed.isZero() ? undefined : margin.toNumber() / billed.toNumber();

  const severityCounts = { block: 0, warn: 0, info: 0 };
  for (const f of model.findings) severityCounts[f.severity] += 1;

  // The one re-sort this screen is allowed: partners by billed total, desc.
  const byBilled = [...model.partners].sort((a, b) => b.totalL.toCents() - a.totalL.toCents());
  const maxBilledCents = byBilled.length > 0 ? byBilled[0]!.totalL.toCents() : 0;

  // Aggregate sheet-vs-additive delta over every line where BOTH rules priced.
  const sheetAmounts: Money[] = [];
  const additiveAmounts: Money[] = [];
  for (const p of model.partners) {
    for (const line of p.lines) {
      if (line.expectedHSheet !== null && line.expectedHAdditive !== null) {
        sheetAmounts.push(line.expectedHSheet.mul(line.quantity));
        additiveAmounts.push(line.expectedHAdditive.mul(line.quantity));
      }
    }
  }
  const sheetTotal = sum(sheetAmounts);
  const additiveTotal = sum(additiveAmounts);

  const heldPartners = model.partners.filter((p) => p.heldLines > 0);
  const heldTotal = heldPartners.reduce((n, p) => n + p.heldLines, 0);

  return {
    billed,
    costExpected,
    costActual,
    margin,
    marginFraction,
    severityCounts,
    byBilled,
    maxBilledCents,
    sheetTotal,
    additiveTotal,
    rulesDelta: sheetTotal.sub(additiveTotal),
    heldTotal,
    heldPartners,
  };
}

function Kpi({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Wallet;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">{children}</CardContent>
    </Card>
  );
}

export function OverviewScreen({ onNavigate }: ScreenProps) {
  const { model, period } = useClose();
  if (model === null) return null; // App gates on the model; belt-and-suspenders.
  const a = aggregate(model);
  const marginNegative = a.margin.isNegative();
  const totalFindings = model.findings.length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          {period} at a glance — every figure below traces to the draft invoices; held lines are
          excluded from totals, never zeroed.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={Wallet} title="Billed to partners">
          <div className="text-2xl font-semibold tabular">{money(a.billed)}</div>
          <div className="text-xs text-muted-foreground">
            sum of {model.partners.length} draft invoices
          </div>
        </Kpi>

        <Kpi icon={Receipt} title="Our cost">
          {a.costActual !== null ? (
            <>
              <div className="text-2xl font-semibold tabular">{money(a.costActual)}</div>
              <div className="text-xs text-muted-foreground">actual (Coro invoice)</div>
              <div className="text-xs text-muted-foreground">
                expected <span className="tabular">{money(a.costExpected)}</span> (additive rule)
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-semibold tabular">{money(a.costExpected)}</div>
              <div className="text-xs text-muted-foreground">expected (additive rule)</div>
            </>
          )}
        </Kpi>

        <Kpi icon={marginNegative ? TrendingDown : TrendingUp} title="Margin">
          <div
            className={cn(
              "text-2xl font-semibold tabular",
              marginNegative ? "text-danger" : "text-success"
            )}
          >
            {money(a.margin)}
          </div>
          <div className="text-xs text-muted-foreground">
            {pct(a.marginFraction)} of billed
          </div>
        </Kpi>

        <Kpi icon={Users} title="Partners">
          <div className="text-2xl font-semibold tabular">{model.partners.length}</div>
          <div className="text-xs text-muted-foreground">
            {model.partners.length} drafts · {model.cardOnly.length} quiet on card
          </div>
        </Kpi>

        <Kpi icon={TriangleAlert} title="Findings">
          <div className="text-2xl font-semibold tabular">{totalFindings}</div>
          {totalFindings > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {SEVERITIES.filter((s) => a.severityCounts[s] > 0).map((s) => (
                <Badge key={s} variant={severityVariant(s)}>
                  {a.severityCounts[s]} {s}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">clean close</div>
          )}
        </Kpi>
      </div>

      {/* Held lines — loud, amber, above the fold. */}
      {a.heldTotal > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-start gap-3 text-sm">
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div>
                <div className="font-medium text-warning">
                  {a.heldTotal} line{a.heldTotal === 1 ? "" : "s"} held — excluded from every total
                  above
                </div>
                <div className="text-xs text-muted-foreground">
                  No confirmed Net Price to MSP (missing rate or unknown product):{" "}
                  {a.heldPartners.map((p) => p.cardName).join(", ")}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              data-testid="held-callout"
              onClick={() => onNavigate("invoices")}
            >
              Review held lines →
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Margin by partner */}
      <Card>
        <CardHeader>
          <CardTitle>Margin by partner</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="divide-y divide-border/60">
            {a.byBilled.map((p) => {
              const widthPct =
                a.maxBilledCents > 0 ? (p.totalL.toCents() / a.maxBilledCents) * 100 : 0;
              return (
                <button
                  key={p.slug}
                  data-testid={`margin-row-${p.slug}`}
                  onClick={() => onNavigate("invoices", p.slug)}
                  className="flex w-full items-center gap-3 px-1 py-2 text-left text-sm transition-colors hover:bg-muted/40"
                  title={`Open ${p.cardName}'s draft invoice`}
                >
                  <span className="w-44 shrink-0 truncate font-medium">{p.cardName}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted/60">
                    <span
                      className="block h-full rounded-full bg-primary/60"
                      style={{ width: `${widthPct}%` }}
                    />
                  </span>
                  <span className="w-28 shrink-0 text-right tabular">{money(p.totalL)}</span>
                  <span
                    className={cn(
                      "w-28 shrink-0 text-right tabular",
                      p.totalMargin.isNegative() ? "text-danger" : "text-muted-foreground"
                    )}
                  >
                    {money(p.totalMargin)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-end gap-3 px-1 text-xs uppercase tracking-wide text-muted-foreground">
            <span className="w-28 text-right">billed</span>
            <span className="w-28 text-right">margin</span>
          </div>
        </CardContent>
      </Card>

      {/* Two cost rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4 shrink-0 text-primary" />
            Two cost rules — sheet vs Coro's additive billing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Sheet rule (col H)
              </div>
              <div className="text-lg font-semibold tabular">{money(a.sheetTotal)}</div>
              <div className="text-xs text-muted-foreground">MSP price × 0.95</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Additive rule
              </div>
              <div className="text-lg font-semibold tabular">{money(a.additiveTotal)}</div>
              <div className="text-xs text-muted-foreground">list × (1 − total discount)</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Delta (sheet − additive)
              </div>
              <div
                className={cn(
                  "text-lg font-semibold tabular",
                  a.rulesDelta.isZero() ? "text-muted-foreground" : "text-warning"
                )}
              >
                {money(a.rulesDelta)}
              </div>
              <div className="text-xs text-muted-foreground">
                {a.rulesDelta.isZero()
                  ? "the two rules agree this month"
                  : a.rulesDelta.isNegative()
                    ? "sheet understates our cost this month"
                    : "sheet overstates our cost this month"}
              </div>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The pricing sheet computes our cost as MSP price × 0.95, but Coro's real invoices stack
            the discounts additively off list, which is cheaper — e.g. a 58% + 5% partner is billed
            at 63% off list. When a Coro invoice is loaded, its actuals are authoritative; until
            then, both rules are shown and neither is presented as "the" cost where they disagree.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
