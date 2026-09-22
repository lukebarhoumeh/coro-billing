/**
 * Overview — the month at a glance ("Midnight Ledger").
 *
 * KPI row (billed / cost / gross profit / partners / findings), GP-by-partner
 * bars that jump into the per-MSP draft, the two-cost-rules callout (sheet
 * ×0.95 vs Coro's additive discount stacking), and a held-lines warning.
 * GP = the model's Money margin; GM% always via gmPct() — never local math.
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
import { money, gmPct, pct } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const SEVERITIES = ["block", "warn", "info"] as const;

/** One segment of the GP-concentration strip (a positive-GP partner, or "others"). */
interface GpSegment {
  readonly key: string;
  readonly label: string;
  readonly gp: Money;
  /** 0..1 share of total positive GP. */
  readonly share: number;
}

/** Deterministic segment tones (position-keyed, never meaning-keyed — labels carry meaning). */
const GP_SEGMENT_TONES = [
  { bg: "bg-primary/85", text: "text-primary-foreground" },
  { bg: "bg-primary/60", text: "text-primary-foreground" },
  { bg: "bg-accent/60", text: "text-accent-foreground" },
  { bg: "bg-accent/35", text: "text-foreground" },
  { bg: "bg-success/50", text: "text-success-foreground" },
] as const;
const GP_OTHERS_TONE = { bg: "bg-muted", text: "text-muted-foreground" } as const;

interface Aggregates {
  readonly billed: Money;
  readonly costExpected: Money;
  /** Actual-else-additive per partner — the same basis as every GP figure. */
  readonly costBlended: Money;
  /** How many partners the blend priced from a Coro-invoice actual. */
  readonly costActualPartners: number;
  readonly margin: Money;
  readonly severityCounts: Readonly<Record<(typeof SEVERITIES)[number], number>>;
  readonly byBilled: readonly PartnerDraft[];
  readonly maxBilledCents: number;
  readonly sheetTotal: Money;
  readonly additiveTotal: Money;
  readonly rulesDelta: Money;
  readonly heldTotal: number;
  readonly heldPartners: readonly PartnerDraft[];
  /** Positive-GP partners' share of total positive GP: top 5 + "others". */
  readonly gpSegments: readonly GpSegment[];
  /** min(3, positive-GP partner count) — for the concentration caption. */
  readonly gpTopCount: number;
  /** 0..1 share of positive GP carried by the top gpTopCount partners; null if none. */
  readonly gpTopShare: number | null;
}

function aggregate(model: CloseModel): Aggregates {
  const billed = sum(model.partners.map((p) => p.totalL));
  const costExpected = sum(model.partners.map((p) => p.totalHExpected));
  // Cost basis: Coro-invoice actual where loaded, expected additive otherwise —
  // per partner, the same actual-else-additive blend behind every margin figure.
  const costBlended = sum(model.partners.map((p) => p.totalHActual ?? p.totalHExpected));
  const costActualPartners = model.partners.filter((p) => p.totalHActual !== null).length;
  const margin = sum(model.partners.map((p) => p.totalMargin));

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

  // GP concentration: positive-GP partners only, sorted by GP desc (slug tiebreak
  // for determinism). Cent arithmetic via toCents() — display always via money()/pct().
  const positives = model.partners
    .filter((p) => p.totalMargin.toCents() > 0)
    .sort(
      (x, y) => y.totalMargin.toCents() - x.totalMargin.toCents() || x.slug.localeCompare(y.slug)
    );
  const positiveGpCents = positives.reduce((n, p) => n + p.totalMargin.toCents(), 0);
  const gpSegments: GpSegment[] = positives.slice(0, 5).map((p) => ({
    key: p.slug,
    label: p.cardName,
    gp: p.totalMargin,
    share: positiveGpCents > 0 ? p.totalMargin.toCents() / positiveGpCents : 0,
  }));
  const rest = positives.slice(5);
  if (rest.length > 0) {
    const restGp = sum(rest.map((p) => p.totalMargin));
    gpSegments.push({
      key: "__others",
      label: `${rest.length} others`,
      gp: restGp,
      share: positiveGpCents > 0 ? restGp.toCents() / positiveGpCents : 0,
    });
  }
  const gpTopCount = Math.min(3, positives.length);
  const gpTopShare =
    positiveGpCents > 0
      ? positives.slice(0, gpTopCount).reduce((n, p) => n + p.totalMargin.toCents(), 0) /
        positiveGpCents
      : null;

  return {
    billed,
    costExpected,
    costBlended,
    costActualPartners,
    margin,
    severityCounts,
    byBilled,
    maxBilledCents,
    sheetTotal,
    additiveTotal,
    rulesDelta: sheetTotal.sub(additiveTotal),
    heldTotal,
    heldPartners,
    gpSegments,
    gpTopCount,
    gpTopShare,
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
      <CardContent className="space-y-1.5">{children}</CardContent>
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
      <div className="rise space-y-2" style={{ "--rise-i": 0 } as React.CSSProperties}>
        <h1 className="figure rule-brass text-2xl">Overview</h1>
        <p className="pt-1 text-sm text-muted-foreground">
          {period} at a glance — every figure below traces to the draft invoices; held lines are
          excluded from totals, never zeroed.
        </p>
      </div>

      {/* KPI row */}
      <div
        className="rise grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
        style={{ "--rise-i": 1 } as React.CSSProperties}
      >
        <Kpi icon={Wallet} title="Billed to partners">
          <div className="figure tabular text-3xl">{money(a.billed)}</div>
          <div className="text-xs text-muted-foreground">
            sum of {model.partners.length} draft invoices
          </div>
        </Kpi>

        <Kpi icon={Receipt} title="Our cost">
          <div className="figure tabular text-3xl">{money(a.costBlended)}</div>
          {a.costActualPartners > 0 ? (
            <>
              <div className="text-xs text-muted-foreground">
                {a.costActualPartners === model.partners.length
                  ? "actual (Coro invoice)"
                  : `actual (Coro invoice) for ${a.costActualPartners} of ${model.partners.length} partners, expected for the rest`}
              </div>
              <div className="text-xs text-muted-foreground">
                all-expected <span className="tabular">{money(a.costExpected)}</span> (additive
                rule)
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">expected (additive rule)</div>
          )}
        </Kpi>

        <Kpi icon={marginNegative ? TrendingDown : TrendingUp} title="Gross profit (GP)">
          <div
            className={cn(
              "figure tabular text-3xl",
              marginNegative ? "text-danger" : "text-success"
            )}
          >
            {money(a.margin)}
          </div>
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "figure tabular text-lg",
                marginNegative ? "text-danger" : "text-success"
              )}
            >
              GM {gmPct(a.margin, a.billed)}
            </span>
            <span className="microlabel">of billed</span>
          </div>
          {!model.totalCreditExpected.isZero() && (
            <div className="text-xs text-muted-foreground">
              Coro credits pending{" "}
              <span className="tabular text-warning">{money(model.totalCreditExpected)}</span> —
              after credits{" "}
              <span className="tabular">{money(a.margin.add(model.totalCreditExpected))}</span>
            </div>
          )}
        </Kpi>

        <Kpi icon={Users} title="Partners">
          <div className="figure tabular text-3xl">{model.partners.length}</div>
          <div className="text-xs text-muted-foreground">
            {model.partners.length} drafts · {model.cardOnly.length} quiet on card
          </div>
        </Kpi>

        <Kpi icon={TriangleAlert} title="Findings">
          <div className="figure tabular text-3xl">{totalFindings}</div>
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

      {/* GP concentration — who carries the month's positive gross profit.
          100%-stacked strip (pure divs); the GP-by-partner table below is the
          full text alternative, and every segment carries its detail in title. */}
      {a.gpSegments.length > 0 && (
        <Card
          className="rise"
          data-testid="gp-concentration"
          style={{ "--rise-i": 2 } as React.CSSProperties}
        >
          <CardContent className="space-y-2.5 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="microlabel">GP concentration — share of positive gross profit</span>
              <span className="text-xs text-muted-foreground">
                top {a.gpTopCount} partner{a.gpTopCount === 1 ? "" : "s"}{" "}
                {a.gpTopCount === 1 ? "carries" : "carry"}{" "}
                <span className="tabular font-medium text-foreground">
                  {pct(a.gpTopShare ?? undefined)}
                </span>{" "}
                of gross profit
              </span>
            </div>
            <div
              role="img"
              aria-label={`Share of positive gross profit: ${a.gpSegments
                .map((s) => `${s.label} ${pct(s.share)}`)
                .join(", ")}`}
              className="flex h-5 w-full overflow-hidden rounded-full bg-muted/30"
            >
              {a.gpSegments.map((seg, i) => {
                const tone =
                  seg.key === "__others"
                    ? GP_OTHERS_TONE
                    : GP_SEGMENT_TONES[Math.min(i, GP_SEGMENT_TONES.length - 1)]!;
                return (
                  <div
                    key={seg.key}
                    title={`${seg.label} — ${money(seg.gp)} GP · ${pct(seg.share)} of positive GP`}
                    style={{ width: `${seg.share * 100}%` }}
                    className={cn(
                      "flex min-w-0 items-center justify-center overflow-hidden",
                      "border-r border-background/60 last:border-r-0",
                      tone.bg
                    )}
                  >
                    {seg.share >= 0.12 && (
                      <span
                        className={cn(
                          "truncate px-1.5 text-[10px] font-semibold leading-none",
                          tone.text
                        )}
                      >
                        {seg.label} · <span className="tabular">{pct(seg.share)}</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Held lines — loud, amber, above the fold. */}
      {a.heldTotal > 0 && (
        <Card
          className="rise border-warning/40 bg-warning/5"
          style={{ "--rise-i": 3 } as React.CSSProperties}
        >
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-1 h-5 w-5 shrink-0 text-warning" />
              <div>
                <div className="microlabel">Held — excluded from every total above</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="figure tabular text-2xl text-warning">{a.heldTotal}</span>
                  <span className="text-sm text-foreground">
                    line{a.heldTotal === 1 ? "" : "s"} with no confirmed Net Price to MSP
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Missing rate or unknown product: {a.heldPartners.map((p) => p.cardName).join(", ")}
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

      {/* GP by partner */}
      <Card className="rise" style={{ "--rise-i": 4 } as React.CSSProperties}>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CardTitle>GP by partner</CardTitle>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {/* Legend: cost is inset over billed on one scale — the brass remainder is GP. */}
            <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2 w-4 rounded-full bg-gradient-to-r from-primary/70 to-primary/30"
                />
                billed
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="relative h-2 w-4 overflow-hidden rounded-full bg-primary/60"
                >
                  <span className="absolute inset-0 bg-accent/30" />
                </span>
                cost
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-4 rounded-full bg-primary/45" />
                GP (remainder)
              </span>
            </span>
            <Button
              variant="ghost"
              className="h-auto px-2 py-1 text-xs text-primary hover:text-primary"
              onClick={() => onNavigate("margins")}
            >
              Margins →
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="divide-y divide-border/60">
            {a.byBilled.map((p) => {
              const widthPct =
                a.maxBilledCents > 0 ? (p.totalL.toCents() / a.maxBilledCents) * 100 : 0;
              const cost = p.totalHActual ?? p.totalHExpected;
              const costBasis = p.totalHActual !== null ? "actual" : "expected";
              const costPct =
                a.maxBilledCents > 0
                  ? Math.min(100, (cost.toCents() / a.maxBilledCents) * 100)
                  : 0;
              const gpNegative = p.totalMargin.isNegative();
              return (
                <button
                  key={p.slug}
                  data-testid={`margin-row-${p.slug}`}
                  onClick={() => onNavigate("invoices", p.slug)}
                  className="flex w-full items-center gap-3 px-1 py-2 text-left text-sm transition-colors hover:bg-muted/40"
                  title={`${p.cardName} — billed ${money(p.totalL)} · cost ${money(cost)} (${costBasis}) · GP ${money(p.totalMargin)}. Open the draft invoice.`}
                >
                  <span className="w-44 shrink-0 truncate font-medium">{p.cardName}</span>
                  {/* Paired bar, one scale: brass = billed; the darker inset overlay is
                      cost; the un-shaded brass remainder IS the GP. */}
                  <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted/60">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/70 to-primary/30"
                      style={{ width: `${widthPct}%` }}
                    />
                    <span
                      className="absolute inset-y-[2px] left-0 rounded-full bg-accent/30"
                      style={{ width: `${costPct}%` }}
                    />
                  </span>
                  <span className="w-28 shrink-0 text-right tabular">{money(p.totalL)}</span>
                  <span
                    className={cn(
                      "w-28 shrink-0 text-right tabular",
                      gpNegative ? "text-danger" : "text-success"
                    )}
                  >
                    {money(p.totalMargin)}
                  </span>
                  <span className="w-16 shrink-0 text-right">
                    <Badge variant={gpNegative ? "danger" : "success"} className="tabular">
                      {gmPct(p.totalMargin, p.totalL)}
                    </Badge>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3 px-1">
            <span className="text-[11px] text-muted-foreground">
              cost is actual (Coro invoice) when loaded, else expected (additive rule)
            </span>
            <span className="flex gap-3">
              <span className="microlabel w-28 text-right">billed</span>
              <span className="microlabel w-28 text-right">GP</span>
              <span className="microlabel w-16 text-right">GM</span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Two cost rules */}
      <Card className="rise" style={{ "--rise-i": 5 } as React.CSSProperties}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4 shrink-0 text-primary" />
            Two cost rules — sheet col H vs the confirmed additive rule
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="microlabel">Sheet col H (reference)</div>
              <div className="figure tabular mt-1 text-2xl">{money(a.sheetTotal)}</div>
              <div className="text-xs text-muted-foreground">as written (mostly E × 0.95)</div>
            </div>
            <div>
              <div className="microlabel">Additive rule (canonical)</div>
              <div className="figure tabular mt-1 text-2xl">{money(a.additiveTotal)}</div>
              <div className="text-xs text-muted-foreground">list × (1 − total discount)</div>
            </div>
            <div>
              <div className="microlabel">Delta (sheet − additive)</div>
              <div
                className={cn(
                  "figure tabular mt-1 text-2xl",
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
            Coro confirmed the additive rule as the intended cost (2026-09-22): total discount =
            partner % + MSP Hub's additional % (45 − partner, floored at 5), applied off list — e.g.
            a 58% + 5% partner is billed at 63% off list. Coro Classic and Managed Classic are the
            exception: a flat 45% off list regardless of partner. The sheet's col H column still
            mostly carries the older MSP price × 0.95 reading and is shown as reference only. When a
            Coro invoice is loaded, its actuals are authoritative — legacy lines Coro billed above
            the additive rule carry an expected credit (answer c).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
