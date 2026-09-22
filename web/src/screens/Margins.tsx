/**
 * Margins — the margin room, where the accounting team lives in the numbers.
 *
 * Five analytics over the CloseModel, every figure traceable to a draft line:
 *   1. GP bridge — billed → cost → GP as labeled proportional rows. Cost is
 *      the Coro-invoice actual where loaded, the expected-additive total
 *      otherwise (per partner); GP = billed − cost so the bridge always ties.
 *   2. GM% by partner, ranked, with a brass reference line at the blended
 *      overall GM% (sum of model margins ÷ sum billed — the same margins
 *      every other screen shows).
 *   3. GP by product family (vendorSku prefix → family), current-gen vs
 *      legacy rollup on top — "WHERE do we make money".
 *   4. Discrepancy impact — every money disagreement quantified in dollars,
 *      signed by its effect on gross profit (positive lifts GP, negative cuts
 *      it), worst first. The detail sentence carries the raw facts.
 *   5. Loss-makers — every line with negative margin, worst first.
 *
 * Held lines never enter billed/cost/GP totals; they appear ONLY in the
 * discrepancy table as unbillable-revenue estimates. All money display goes
 * through money(); GM% through gmPct(); Money.toNumber() is used solely for
 * bar-width arithmetic, never display. Pure SVG/div bars — no chart library.
 */
import {
  CheckCircle2,
  Layers,
  Percent,
  Scale,
  TrendingDown,
  TriangleAlert,
} from "lucide-react";
import { Money, sum } from "@pipeline/lib/money.js";
import type { CloseModel, DraftLine, PartnerDraft } from "@pipeline/domain/types.js";
import { useClose } from "@/lib/closeStore";
import type { ScreenProps } from "@/lib/nav";
import { money, gmPct } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------------- *
 * Derivations (pure functions of the CloseModel — deterministic order).
 * ------------------------------------------------------------------------- */

function abs(m: Money): Money {
  return m.isNegative() ? m.mul(-1) : m;
}

function qtyStr(n: number): string {
  return n.toLocaleString("en-US");
}

/** Signed money for the impact column: money() renders "$-x"; prefix "+" when up. */
function signedMoney(m: Money): string {
  return m.isNegative() || m.isZero() ? money(m) : `+${money(m)}`;
}

/* --- GP bridge ------------------------------------------------------------ */

interface Bridge {
  readonly billed: Money;
  readonly cost: Money;
  readonly gp: Money; // billed − cost, so the three rows always tie
  readonly actualPartners: number;
  readonly expectedPartners: number;
}

function buildBridge(model: CloseModel): Bridge {
  let actualPartners = 0;
  let expectedPartners = 0;
  const costs: Money[] = [];
  for (const p of model.partners) {
    if (p.totalHActual !== null) {
      actualPartners += 1;
      costs.push(p.totalHActual);
    } else {
      expectedPartners += 1;
      costs.push(p.totalHExpected);
    }
  }
  const billed = sum(model.partners.map((p) => p.totalL));
  const cost = sum(costs);
  return { billed, cost, gp: billed.sub(cost), actualPartners, expectedPartners };
}

/* --- GM% by partner ------------------------------------------------------- */

interface GmRow {
  readonly slug: string;
  readonly cardName: string;
  readonly billed: Money;
  readonly gp: Money;
  readonly gmFrac: number; // gp ÷ billed as a fraction, for bar scale only
}

function buildGmRows(partners: readonly PartnerDraft[]): readonly GmRow[] {
  const rows: GmRow[] = partners
    .filter((p) => !p.totalL.isZero())
    .map((p) => ({
      slug: p.slug,
      cardName: p.cardName,
      billed: p.totalL,
      gp: p.totalMargin,
      gmFrac: p.totalMargin.toNumber() / p.totalL.toNumber(),
    }));
  rows.sort((a, b) => (b.gmFrac !== a.gmFrac ? b.gmFrac - a.gmFrac : a.slug < b.slug ? -1 : 1));
  return rows;
}

/* --- GP by product family ------------------------------------------------- */

const FAMILY_RULES: readonly { readonly prefix: string; readonly family: string }[] = [
  { prefix: "COR-COMP", family: "AI Complete" },
  { prefix: "COR-ESS", family: "AI Essentials" },
  { prefix: "COR-ENDP", family: "AI Endpoint" },
  { prefix: "COR-LTE", family: "AI Lite" },
  { prefix: "COR-MANAGE", family: "Managed" },
  { prefix: "BUCOM", family: "Complete Flex (legacy)" },
  { prefix: "BUCORO", family: "Essentials Flex (legacy)" },
  { prefix: "BUCOCLASS", family: "Classic Flex (legacy)" },
  { prefix: "BUEND", family: "Endpoint Flex (legacy)" },
  { prefix: "BUEMAIL", family: "Email Flex (legacy)" },
  // MOD* covers Modsat* too (uppercased); ADD* joins the modules chain.
  { prefix: "MOD", family: "Modules Flex (legacy)" },
  { prefix: "ADD", family: "Modules Flex (legacy)" },
];

function familyOf(vendorSku: string): string {
  const u = vendorSku.toUpperCase();
  for (const r of FAMILY_RULES) if (u.startsWith(r.prefix)) return r.family;
  return "Other";
}

interface FamilyRow {
  readonly family: string;
  readonly legacy: boolean;
  readonly billed: Money;
  readonly cost: Money;
  readonly gp: Money;
  readonly lines: number;
}

/** Aggregate billable lines into families. Cost basis per line = actual Coro
 * amount where loaded, else expected-additive×qty — exactly the model's own
 * margin basis, so family GP is the sum of the very margins shown per line. */
function buildFamilies(model: CloseModel): readonly FamilyRow[] {
  const acc = new Map<string, { billed: Money; cost: Money; gp: Money; lines: number }>();
  for (const p of model.partners) {
    for (const line of p.lines) {
      if (line.matchKind === "nfr" || line.amountL === null) continue; // NFR + held excluded
      const fam = familyOf(line.vendorSku);
      const cur = acc.get(fam) ?? {
        billed: Money.zero(),
        cost: Money.zero(),
        gp: Money.zero(),
        lines: 0,
      };
      cur.billed = cur.billed.add(line.amountL);
      if (line.margin !== null) {
        cur.gp = cur.gp.add(line.margin);
        cur.cost = cur.cost.add(line.amountL.sub(line.margin));
      }
      cur.lines += 1;
      acc.set(fam, cur);
    }
  }
  const rows: FamilyRow[] = [...acc.entries()].map(([family, v]) => ({
    family,
    legacy: family.endsWith("(legacy)"),
    ...v,
  }));
  // GP desc — losses fall to the bottom naturally; name tie-break for determinism.
  rows.sort((a, b) => {
    const d = b.gp.toCents() - a.gp.toCents();
    return d !== 0 ? d : a.family < b.family ? -1 : 1;
  });
  return rows;
}

interface Rollup {
  readonly label: string;
  readonly billed: Money;
  readonly cost: Money;
  readonly gp: Money;
}

function rollupFamilies(rows: readonly FamilyRow[]): readonly Rollup[] {
  const roll = (legacy: boolean, label: string): Rollup => {
    const set = rows.filter((r) => r.legacy === legacy);
    return {
      label,
      billed: sum(set.map((r) => r.billed)),
      cost: sum(set.map((r) => r.cost)),
      gp: sum(set.map((r) => r.gp)),
    };
  };
  return [roll(false, "Current-gen"), roll(true, "Legacy (flex)")];
}

/* --- Discrepancy impact --------------------------------------------------- */

interface ImpactRow {
  readonly key: string;
  /** Signed effect on gross profit; null = held with no basis to estimate. */
  readonly impact: Money | null;
  readonly label: string;
  readonly slug: string;
  readonly partner: string;
  readonly sku: string;
  readonly detail: string;
}

function hasFinding(line: DraftLine, kind: string): boolean {
  return line.findings.some((f) => f.kind === kind);
}

/** Every money disagreement in dollars, signed by its effect on GP:
 * positive lifts GP vs the modeled close, negative cuts it. The magnitudes
 * are the raw deltas (team−card, actual−expected, invoiceQty−usageQty ×
 * rate); cost-side deltas are negated so a Coro overcharge reads as −$. */
function buildImpacts(model: CloseModel): readonly ImpactRow[] {
  const rows: ImpactRow[] = [];
  for (const p of model.partners) {
    for (const line of p.lines) {
      const qty = line.quantity;
      const base = { slug: p.slug, partner: p.cardName, sku: line.vendorSku };

      // HELD — no confirmed L; estimate the unbillable revenue.
      if (line.unitL === null && line.matchKind !== "nfr") {
        const label = "HELD — can't bill";
        if (line.teamClientPrice !== null) {
          rows.push({
            ...base,
            key: `${p.slug}|${line.vendorSku}|${label}`,
            label,
            impact: line.teamClientPrice.mul(qty).mul(-1),
            detail: `no card rate; team keyed ${money(line.teamClientPrice)} × ${qtyStr(qty)} units — revenue at risk`,
          });
        } else if (line.expectedHAdditive !== null) {
          rows.push({
            ...base,
            key: `${p.slug}|${line.vendorSku}|${label}`,
            label,
            impact: line.expectedHAdditive.mul(qty).mul(-1),
            detail: `no card rate; estimated at expected cost ${money(line.expectedHAdditive)} × ${qtyStr(qty)} units`,
          });
        } else {
          rows.push({
            ...base,
            key: `${p.slug}|${line.vendorSku}|${label}`,
            label,
            impact: null,
            detail: `no card rate and no basis to estimate — ${qtyStr(qty)} units unpriced`,
          });
        }
      }

      // Team's keyed bill-out rate ≠ the rate card's col E.
      if (
        hasFinding(line, "CLIENT_PRICE_DIFFERS") &&
        line.teamClientPrice !== null &&
        line.unitL !== null
      ) {
        const label = "team price ≠ card";
        rows.push({
          ...base,
          key: `${p.slug}|${line.vendorSku}|${label}`,
          label,
          impact: line.teamClientPrice.sub(line.unitL).mul(qty),
          detail: `team bills ${money(line.teamClientPrice)}, card says ${money(line.unitL)} × ${qtyStr(qty)} units`,
        });
      }

      // Coro's actual unit cost ≠ the additive expectation.
      if (
        hasFinding(line, "INVOICE_RATE_UNEXPECTED") &&
        line.actualHUnit !== null &&
        line.expectedHAdditive !== null
      ) {
        const label = "Coro rate ≠ expected";
        rows.push({
          ...base,
          key: `${p.slug}|${line.vendorSku}|${label}`,
          label,
          // (actual − expected)×qty is the cost delta; negate → GP effect.
          impact: line.expectedHAdditive.sub(line.actualHUnit).mul(qty),
          detail: `Coro bills ${money(line.actualHUnit)}/unit, expected ${money(line.expectedHAdditive)} × ${qtyStr(qty)} units`,
        });
      }

      // Coro invoice quantity ≠ usage-derived quantity.
      if (hasFinding(line, "INVOICE_QTY_DISAGREES") && line.invoiceQuantity !== null) {
        const rate = line.actualHUnit ?? line.expectedHAdditive;
        if (rate !== null) {
          const label = "qty mismatch";
          rows.push({
            ...base,
            key: `${p.slug}|${line.vendorSku}|${label}`,
            label,
            // (invoiceQty − qty)×rate is the cost delta; negate → GP effect.
            impact: rate.mul(qty - line.invoiceQuantity),
            detail: `Coro invoiced ${qtyStr(line.invoiceQuantity)} units, usage says ${qtyStr(qty)} at ${money(rate)}/unit`,
          });
        }
      }
    }
  }
  // |$ impact| desc; unquantifiable held rows last; key tie-break.
  rows.sort((a, b) => {
    const aa = a.impact === null ? -1 : abs(a.impact).toCents();
    const bb = b.impact === null ? -1 : abs(b.impact).toCents();
    return bb !== aa ? bb - aa : a.key < b.key ? -1 : 1;
  });
  return rows;
}

/* --- Loss-makers ---------------------------------------------------------- */

interface LossRow {
  readonly key: string;
  readonly partner: string;
  readonly slug: string;
  readonly product: string;
  readonly sku: string;
  readonly quantity: number;
  readonly billed: Money;
  readonly cost: Money;
  readonly gp: Money;
}

function buildLosses(model: CloseModel): readonly LossRow[] {
  const rows: LossRow[] = [];
  for (const p of model.partners) {
    for (const line of p.lines) {
      if (line.margin === null || !line.margin.isNegative() || line.amountL === null) continue;
      rows.push({
        key: `${p.slug}|${line.vendorSku}`,
        partner: p.cardName,
        slug: p.slug,
        product: line.productLabel,
        sku: line.vendorSku,
        quantity: line.quantity,
        billed: line.amountL,
        cost: line.amountL.sub(line.margin),
        gp: line.margin,
      });
    }
  }
  rows.sort((a, b) => {
    const d = a.gp.toCents() - b.gp.toCents(); // ascending — worst first
    return d !== 0 ? d : a.key < b.key ? -1 : 1;
  });
  return rows;
}

/* ------------------------------------------------------------------------- *
 * Presentational bits.
 * ------------------------------------------------------------------------- */

/** Faint quarter gridlines inside a bar track (border tokens, low opacity). */
function TrackGrid() {
  return (
    <>
      {[25, 50, 75].map((x) => (
        <span
          key={x}
          aria-hidden
          className="absolute inset-y-0 border-l border-border/40"
          style={{ left: `${x}%` }}
        />
      ))}
    </>
  );
}

/** One row of the GP bridge: label · proportional bar · direct $ figure. */
function BridgeRow({
  label,
  sub,
  value,
  widthPct,
  barClass,
  valueClass,
}: {
  label: string;
  sub: string;
  value: string;
  widthPct: number;
  barClass: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0">
        <span className="microlabel block">{label}</span>
        <span className="block text-[0.6875rem] text-muted-foreground">{sub}</span>
      </span>
      <span className="relative h-6 flex-1 overflow-hidden rounded-sm bg-muted/40">
        <TrackGrid />
        <span
          className={cn("absolute inset-y-0 left-0 rounded-sm", barClass)}
          style={{ width: `${widthPct}%` }}
        />
      </span>
      <span className={cn("figure tabular w-32 shrink-0 text-right text-lg", valueClass)}>
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Screen.
 * ------------------------------------------------------------------------- */

export function MarginsScreen(props: ScreenProps) {
  const { onNavigate } = props;
  const { model, period } = useClose();
  if (model === null) return null; // App gates on the model; belt-and-suspenders.

  const bridge = buildBridge(model);
  const gmRows = buildGmRows(model.partners);
  const families = buildFamilies(model);
  const rollups = rollupFamilies(families);
  const impacts = buildImpacts(model);
  const losses = buildLosses(model);

  // Blended overall GM — the model's own margins over billed, matching every
  // other screen; the reference line the ranked bars are read against.
  const totalBilled = sum(model.partners.map((p) => p.totalL));
  const totalGp = sum(model.partners.map((p) => p.totalMargin));
  const overallFrac = totalBilled.isZero() ? 0 : totalGp.toNumber() / totalBilled.toNumber();

  // Bar-scale arithmetic (numbers allowed here, never for display).
  const bridgeScale = Math.max(
    bridge.billed.toNumber(),
    bridge.cost.toNumber(),
    Math.abs(bridge.gp.toNumber()),
    0
  );
  const bridgeW = (m: Money) =>
    bridgeScale > 0 ? (Math.abs(m.toNumber()) / bridgeScale) * 100 : 0;

  const maxAbsGm = Math.max(...gmRows.map((r) => Math.abs(r.gmFrac)), Math.abs(overallFrac), 0);
  const gmW = (frac: number) => (maxAbsGm > 0 ? (Math.abs(frac) / maxAbsGm) * 100 : 0);
  const overallTickPct = gmW(overallFrac);
  const showOverall = !totalBilled.isZero() && maxAbsGm > 0;

  const maxFamilyGpCents = Math.max(...families.map((f) => Math.abs(f.gp.toCents())), 0);
  const famW = (m: Money) =>
    maxFamilyGpCents > 0 ? (Math.abs(m.toCents()) / maxFamilyGpCents) * 100 : 0;

  const quantified = impacts.filter((r): r is ImpactRow & { impact: Money } => r.impact !== null);
  const totalAbsImpact = sum(quantified.map((r) => abs(r.impact)));

  const zeroBilledCount = model.partners.length - gmRows.length;
  const gpNegative = bridge.gp.isNegative();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* 1 — heading */}
      <div className="rise space-y-2" style={{ "--rise-i": 0 } as React.CSSProperties}>
        <h1 className="figure rule-brass text-2xl">Margins</h1>
        <p className="pt-1 text-sm text-muted-foreground">
          {period} — where the gross profit comes from and every dollar that disagrees. Each
          figure traces to a draft-invoice line; held lines never enter totals and are quantified
          separately below.
        </p>
      </div>

      {/* 2 — GP bridge */}
      <Card className="rise" style={{ "--rise-i": 1 } as React.CSSProperties}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4 shrink-0 text-primary" />
            GP bridge — billed, cost, gross profit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-3">
          <BridgeRow
            label="Billed"
            sub="sum of drafts"
            value={money(bridge.billed)}
            widthPct={bridgeW(bridge.billed)}
            barClass="bg-gradient-to-r from-primary/80 to-primary/50"
          />
          <BridgeRow
            label="− Cost"
            sub="Coro side"
            value={money(bridge.cost)}
            widthPct={bridgeW(bridge.cost)}
            barClass="bg-gradient-to-r from-accent/60 to-accent/35"
            valueClass="text-muted-foreground"
          />
          <BridgeRow
            label="= GP"
            sub="gross profit"
            value={money(bridge.gp)}
            widthPct={bridgeW(bridge.gp)}
            barClass={
              gpNegative
                ? "bg-gradient-to-r from-danger/80 to-danger/50"
                : "bg-gradient-to-r from-success/80 to-success/50"
            }
            valueClass={gpNegative ? "text-danger" : "text-success"}
          />
          {!model.totalCreditExpected.isZero() && (
            <BridgeRow
              label="+ Credits"
              sub="Coro over-bills pending credit (2026-09-22 answer c)"
              value={money(model.totalCreditExpected)}
              widthPct={bridgeW(model.totalCreditExpected)}
              barClass="bg-gradient-to-r from-warning/70 to-warning/40"
              valueClass="text-warning"
            />
          )}
          <p className="text-xs text-muted-foreground">
            Cost basis: Coro-invoice <span className="text-foreground">actual</span> for{" "}
            <span className="tabular">{bridge.actualPartners}</span> partner
            {bridge.actualPartners === 1 ? "" : "s"},{" "}
            <span className="text-foreground">expected additive</span> for{" "}
            <span className="tabular">{bridge.expectedPartners}</span>. GP = billed − cost, GM{" "}
            <span className="tabular">{gmPct(bridge.gp, bridge.billed)}</span> of billed.
            {!model.totalCreditExpected.isZero() && (
              <>
                {" "}After the pending Coro credits land, GP becomes{" "}
                <span className="tabular text-foreground">
                  {money(bridge.gp.add(model.totalCreditExpected))}
                </span>
                .
              </>
            )}
          </p>
        </CardContent>
      </Card>

      {/* 3 — GM% by partner (ranked) */}
      <Card className="rise" style={{ "--rise-i": 2 } as React.CSSProperties}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-4 w-4 shrink-0 text-primary" />
            GM% by partner — ranked
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {/* Legend row: the brass reference line's label sits at its position. */}
          <div className="flex items-center gap-3 px-1 pb-1">
            <span className="w-44 shrink-0" />
            <span className="microlabel w-16 shrink-0">GM</span>
            <span className="relative h-4 flex-1">
              {showOverall && (
                <span
                  className="microlabel absolute -translate-x-1/2 whitespace-nowrap text-primary"
                  style={{ left: `clamp(3rem, ${overallTickPct}%, calc(100% - 3rem))` }}
                >
                  overall {gmPct(totalGp, totalBilled)}
                </span>
              )}
            </span>
            <span className="microlabel w-28 shrink-0 text-right">GP</span>
            <span className="microlabel w-28 shrink-0 text-right">billed</span>
          </div>
          <div className="divide-y divide-border/60">
            {gmRows.map((r) => {
              const neg = r.gp.isNegative();
              return (
                <button
                  key={r.slug}
                  data-testid={`gm-row-${r.slug}`}
                  onClick={() => onNavigate("invoices", r.slug)}
                  className="flex w-full items-center gap-3 px-1 py-2 text-left text-sm transition-colors hover:bg-muted/40"
                  title={`Open ${r.cardName}'s draft invoice`}
                >
                  <span className="w-44 shrink-0 truncate font-medium">{r.cardName}</span>
                  <span className="w-16 shrink-0">
                    <Badge variant={neg ? "danger" : "success"} className="tabular">
                      {gmPct(r.gp, r.billed)}
                    </Badge>
                  </span>
                  <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted/60">
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-full",
                        neg
                          ? "bg-gradient-to-r from-danger/70 to-danger/40"
                          : "bg-gradient-to-r from-success/70 to-success/40"
                      )}
                      style={{ width: `${gmW(r.gmFrac)}%` }}
                    />
                    {showOverall && (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 w-px bg-primary/80"
                        style={{ left: `${overallTickPct}%` }}
                      />
                    )}
                  </span>
                  <span
                    className={cn(
                      "w-28 shrink-0 text-right tabular",
                      neg ? "text-danger" : "text-success"
                    )}
                  >
                    {money(r.gp)}
                  </span>
                  <span className="w-28 shrink-0 text-right tabular text-muted-foreground">
                    {money(r.billed)}
                  </span>
                </button>
              );
            })}
            {gmRows.length === 0 && (
              <div className="px-1 py-3 text-sm text-muted-foreground">
                No partners with billed amounts this month.
              </div>
            )}
          </div>
          {zeroBilledCount > 0 && (
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              {zeroBilledCount} partner{zeroBilledCount === 1 ? "" : "s"} with $0.00 billed
              (held/NFR-only) omitted from the ranking.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 4 — GP by product family */}
      <Card className="rise" style={{ "--rise-i": 3 } as React.CSSProperties}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 shrink-0 text-primary" />
            GP by product family — current-gen vs legacy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            {rollups.map((r) => {
              const neg = r.gp.isNegative();
              return (
                <div key={r.label} className="rounded-md border border-border/60 bg-muted/20 p-4">
                  <div className="microlabel">{r.label}</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span
                      className={cn(
                        "figure tabular text-2xl",
                        neg ? "text-danger" : "text-success"
                      )}
                    >
                      {money(r.gp)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      GP on <span className="tabular">{money(r.billed)}</span> billed · GM{" "}
                      <span className="tabular">{gmPct(r.gp, r.billed)}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <Table>
            <THead>
              <TR>
                <TH>Family</TH>
                <TH className="w-40">GP scale</TH>
                <TH className="text-right">Billed</TH>
                <TH className="text-right">Cost</TH>
                <TH className="text-right">GP</TH>
                <TH className="text-right">GM%</TH>
              </TR>
            </THead>
            <TBody>
              {families.map((f) => {
                const neg = f.gp.isNegative();
                return (
                  <TR key={f.family}>
                    <TD>
                      <span className="font-medium">{f.family}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {f.lines} line{f.lines === 1 ? "" : "s"}
                      </span>
                    </TD>
                    <TD className="align-middle">
                      <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
                        <span
                          className={cn(
                            "absolute inset-y-0 left-0 rounded-full",
                            neg ? "bg-danger/70" : "bg-success/70"
                          )}
                          style={{ width: `${famW(f.gp)}%` }}
                        />
                      </span>
                    </TD>
                    <TD className="text-right tabular">{money(f.billed)}</TD>
                    <TD className="text-right tabular text-muted-foreground">{money(f.cost)}</TD>
                    <TD
                      className={cn(
                        "text-right tabular",
                        neg ? "text-danger" : "text-success"
                      )}
                    >
                      {money(f.gp)}
                    </TD>
                    <TD className="text-right tabular">{gmPct(f.gp, f.billed)}</TD>
                  </TR>
                );
              })}
              {families.length === 0 && (
                <TR>
                  <TD colSpan={6} className="text-muted-foreground">
                    No billable lines this month.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Families group draft lines by vendor SKU prefix (COR-* current-gen, BU*/MOD*/ADD*
            legacy flex). Cost per line is the Coro-invoice actual where loaded, else the additive
            expectation — the same basis as each line's margin.
          </p>
        </CardContent>
      </Card>

      {/* 5 — Discrepancy impact */}
      <Card className="rise" style={{ "--rise-i": 4 } as React.CSSProperties}>
        <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 shrink-0 text-warning" />
            Discrepancy impact — every money disagreement, in dollars
          </CardTitle>
          {quantified.length > 0 && (
            <span className="text-sm text-muted-foreground">
              <span className="figure tabular text-lg text-foreground">
                {money(totalAbsImpact)}
              </span>{" "}
              absolute across {quantified.length} quantified row
              {quantified.length === 1 ? "" : "s"}
            </span>
          )}
        </CardHeader>
        <CardContent className="space-y-3 pt-3">
          {impacts.length === 0 ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              No money disagreements — team prices, Coro rates, and quantities all tie.
            </div>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH className="text-right">Impact $</TH>
                    <TH>What</TH>
                    <TH>Partner</TH>
                    <TH>SKU</TH>
                    <TH>Detail</TH>
                    <TH className="text-right">&nbsp;</TH>
                  </TR>
                </THead>
                <TBody>
                  {impacts.map((r) => {
                    const neg = r.impact !== null && r.impact.isNegative();
                    const pos = r.impact !== null && !neg && !r.impact.isZero();
                    return (
                      <TR key={r.key}>
                        <TD
                          className={cn(
                            "figure tabular whitespace-nowrap text-right",
                            neg && "text-danger",
                            pos && "text-success",
                            r.impact === null && "text-muted-foreground"
                          )}
                        >
                          {r.impact === null ? "—" : signedMoney(r.impact)}
                        </TD>
                        <TD>
                          <Badge
                            variant={r.label.startsWith("HELD") ? "warning" : "muted"}
                            className="whitespace-nowrap"
                          >
                            {r.label}
                          </Badge>
                        </TD>
                        <TD className="whitespace-nowrap">{r.partner}</TD>
                        <TD className="whitespace-nowrap font-mono text-xs">{r.sku}</TD>
                        <TD className="text-muted-foreground">{r.detail}</TD>
                        <TD className="text-right">
                          <Button
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => onNavigate("invoices", r.slug)}
                            title={`Open ${r.partner}'s draft invoice`}
                          >
                            view →
                          </Button>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                Impact is signed by its effect on gross profit: positive lifts GP versus the
                modeled close, negative cuts it (a Coro overcharge or an unbillable held line
                reads as −$). Unquantifiable held lines show "—" and sort last.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* 6 — Loss-makers */}
      <Card className="rise" style={{ "--rise-i": 5 } as React.CSSProperties}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 shrink-0 text-danger" />
            Loss-makers — lines billed below cost
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          {losses.length === 0 ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              No loss-making lines.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Partner</TH>
                  <TH>Product</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Billed</TH>
                  <TH className="text-right">Cost</TH>
                  <TH className="text-right">GP</TH>
                  <TH className="text-right">GM%</TH>
                </TR>
              </THead>
              <TBody>
                {losses.map((r) => (
                  <TR key={r.key}>
                    <TD className="whitespace-nowrap">{r.partner}</TD>
                    <TD>
                      <span>{r.product}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {r.sku}
                      </span>
                    </TD>
                    <TD className="text-right tabular">{qtyStr(r.quantity)}</TD>
                    <TD className="text-right tabular">{money(r.billed)}</TD>
                    <TD className="text-right tabular text-muted-foreground">{money(r.cost)}</TD>
                    <TD className="text-right tabular text-danger">{money(r.gp)}</TD>
                    <TD className="text-right tabular text-danger">{gmPct(r.gp, r.billed)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
