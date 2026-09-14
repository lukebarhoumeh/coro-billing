import { useMemo } from "react";
import type { ReactNode } from "react";
import type { DemoResult } from "@/lib/pipeline";
import { money } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

/**
 * Overview — the top of the close. Reads everything off DemoResult (no fetching,
 * no re-running the pipeline, no business logic). The only computation here is
 * display-only footer/summary sums via Money.add.
 *
 * Dane's pipeline, in his words: usage in -> H ("our cost") & L ("what we're
 * charging") attached -> broken down by customer -> QuickBooks. This screen is
 * the headline: what this close is, does it tie to Lindita, and the per-partner roll-up.
 */
export function OverviewScreen({ result }: { result: DemoResult }) {
  const { invoices, exceptions, checks, report, period, dataset } = result;

  // Display-only roll-ups across every invoice (one invoice per MSP partner).
  const totals = useMemo(() => {
    let charge = invoices[0]?.subtotalCharge;
    let cost = invoices[0]?.subtotalCost;
    let margin = invoices[0]?.margin;
    for (let i = 1; i < invoices.length; i++) {
      charge = charge!.add(invoices[i].subtotalCharge);
      cost = cost!.add(invoices[i].subtotalCost);
      margin = margin!.add(invoices[i].margin);
    }
    return { charge, cost, margin };
  }, [invoices]);

  const checksPassing = checks.filter((c) => c.status === "pass").length;

  return (
    <div className="space-y-6">
      {/* Intro — what this close is, in Dane's terms. */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Close overview</h2>
          <Badge variant="muted">{period}</Badge>
          <Badge variant={dataset === "consistent" ? "success" : "warning"}>
            {dataset === "consistent" ? "Clean month" : "Month with issues"}
          </Badge>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          The automated version of Lindita&apos;s manual month-end workbook: Coro{" "}
          <span className="text-foreground">usage</span> comes in, our cost{" "}
          <span className="text-foreground">(H)</span> and what we&apos;re charging{" "}
          <span className="text-foreground">(L)</span> attach per partner &times; SKU,
          the bill is <span className="text-foreground">broken down by customer</span>, and
          the result flows to <span className="text-foreground">QuickBooks</span> so Lindita
          has her invoices. Margin follows once H and L exist.
        </p>
      </div>

      {/* KPI grid. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Invoices" hint="one per MSP partner">
          <span className="tabular">{invoices.length}</span>
        </Kpi>
        <Kpi label="Total charge (L)" hint="what we bill the partners">
          <span className="tabular">{totals.charge ? money(totals.charge) : "—"}</span>
        </Kpi>
        <Kpi label="Total cost (H)" hint="what Coro bills Hub · internal">
          <span className="tabular text-muted-foreground">
            {totals.cost ? money(totals.cost) : "—"}
          </span>
        </Kpi>
        <Kpi label="Total margin" hint="charge − cost, follows">
          <span
            className={
              "tabular " +
              (totals.margin && totals.margin.isNegative() ? "text-danger" : "text-success")
            }
          >
            {totals.margin ? money(totals.margin) : "—"}
          </span>
        </Kpi>
        <Kpi label="Exceptions" hint="rows needing review">
          <span className={"tabular " + (exceptions.length > 0 ? "text-warning" : "")}>
            {exceptions.length}
          </span>
        </Kpi>
        <Kpi label="Checks passing" hint="reconciliation checks">
          <span className="tabular">
            {checksPassing} <span className="text-muted-foreground">/ {checks.length}</span>
          </span>
        </Kpi>
        <div className="col-span-2 md:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Recreation vs Lindita &mdash; the acceptance test</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Badge variant={report.matched ? "success" : "danger"} className="text-sm">
                  {report.matched ? "MATCHED" : "NOT MATCHED"}
                </Badge>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {report.matched
                    ? "Our recreation ties to Lindita's manual workbook cent-exact."
                    : `${report.discrepancies.length} line${
                        report.discrepancies.length === 1 ? "" : "s"
                      } differ from Lindita's manual workbook.`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-muted-foreground">Ours</div>
                <div className="tabular text-base font-semibold">{money(report.totalOurs)}</div>
                <div className="mt-1 text-xs text-muted-foreground">Lindita</div>
                <div className="tabular text-base font-semibold">
                  {money(report.totalLindita)}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Per-partner summary. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-foreground">By partner</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each MSP partner gets one invoice, broken down by customer underneath.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <THead>
              <TR>
                <TH>Partner</TH>
                <TH className="text-right"># customers</TH>
                <TH className="text-right"># lines</TH>
                <TH className="text-right">Charge (L)</TH>
                <TH className="text-right">Cost (H)</TH>
                <TH className="text-right">Margin</TH>
              </TR>
            </THead>
            <TBody>
              {invoices.map((inv) => {
                const customers = new Set(
                  inv.lines.map((l) => l.customer).filter((c): c is string => c != null)
                ).size;
                const marginNeg = inv.margin.isNegative();
                return (
                  <TR key={inv.partner}>
                    <TD className="font-medium">{inv.partner}</TD>
                    <TD className="tabular text-right text-muted-foreground">{customers}</TD>
                    <TD className="tabular text-right text-muted-foreground">
                      {inv.lines.length}
                    </TD>
                    <TD className="tabular text-right">{money(inv.subtotalCharge)}</TD>
                    <TD className="tabular text-right text-muted-foreground">
                      {money(inv.subtotalCost)}
                    </TD>
                    <TD
                      className={
                        "tabular text-right font-medium " +
                        (marginNeg ? "text-danger" : "text-success")
                      }
                    >
                      {money(inv.margin)}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
            {invoices.length > 0 && (
              <tfoot className="border-t border-border text-sm">
                <TR className="border-b-0">
                  <TD className="font-semibold">Total</TD>
                  <TD />
                  <TD className="tabular text-right text-muted-foreground">
                    {invoices.reduce((n, inv) => n + inv.lines.length, 0)}
                  </TD>
                  <TD className="tabular text-right font-semibold">
                    {totals.charge ? money(totals.charge) : "—"}
                  </TD>
                  <TD className="tabular text-right font-semibold text-muted-foreground">
                    {totals.cost ? money(totals.cost) : "—"}
                  </TD>
                  <TD
                    className={
                      "tabular text-right font-semibold " +
                      (totals.margin && totals.margin.isNegative()
                        ? "text-danger"
                        : "text-success")
                    }
                  >
                    {totals.margin ? money(totals.margin) : "—"}
                  </TD>
                </TR>
              </tfoot>
            )}
          </Table>
        </CardContent>
      </Card>

      {/* H/L caption. */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">H (our cost)</span> stays internal &mdash;
        it is what Coro bills Hub and never appears on the partner&apos;s invoice.{" "}
        <span className="font-medium text-foreground">L (what we&apos;re charging)</span> is the
        rate the MSP partner is billed. Margin is simply L &minus; H.
      </p>
    </div>
  );
}

function Kpi({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{children}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
