import type { ReactNode } from "react";
import type { DemoResult } from "@/lib/pipeline";
import { money, moneyStr } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { Discrepancy } from "@pipeline/domain/types.js";

/**
 * Reconcile — the ACCEPTANCE TEST view.
 *
 * Dane's acceptance gate, verbatim: "recreate the August invoice and see any
 * discrepancies we have against Lita's manual one." This screen recreates the
 * close from the real pipeline and diffs it, cent-for-cent, against Lindita's
 * manual workbook. It renders purely from `result.report` — no re-run, no math
 * beyond display-only Money.sub for the signed variance.
 *
 * An "explained" legacy line (e.g. the $6-vs-$9 special deal) is still shown as a
 * discrepancy to review — the system never silently auto-accepts a mismatch.
 */

/** Money fields carry a formatted "6.00" string; quantity carries a plain count. */
const MONEY_FIELDS = new Set<Discrepancy["field"]>(["ourPrice", "charge", "margin"]);

const FIELD_LABEL: Record<Discrepancy["field"], string> = {
  ourPrice: "H — our cost",
  charge: "L — what we're charging",
  quantity: "Quantity",
  margin: "Margin",
  presence: "Presence",
};

export function ReconcileScreen({ result }: { result: DemoResult }) {
  const { report } = result;
  const matched = report.matched;

  // Display-only signed variance: ours − Lindita. Never float math on strings.
  const variance = report.totalOurs.sub(report.totalLindita);
  const overUnder = variance.isNegative() ? "UNDER" : "OVER";

  const discrepancies = report.discrepancies;
  const onlyOurs = report.onlyInOurs;
  const onlyLindita = report.onlyInLindita;

  const nothingToReview =
    matched && discrepancies.length === 0 && onlyOurs.length === 0 && onlyLindita.length === 0;

  return (
    <div className="space-y-6">
      {/* Framing — Dane's words drive the screen. */}
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">The acceptance test</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Recreate the August invoice from the pipeline and see any discrepancies against Lita&rsquo;s
          manual one, so corrections can be made before automating.{" "}
          <span className="text-foreground/70">
            Reconciliation for <span className="tabular font-medium">{report.period}</span>.
          </span>
        </p>
      </div>

      {/* Prominent verdict banner. */}
      <VerdictBanner matched={matched} discrepancyCount={discrepancies.length} />

      {/* Totals: ours vs Lindita, with a signed variance. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TotalCard
          title="Our recreation"
          value={money(report.totalOurs)}
          hint="Pipeline output — H &amp; L applied, broken down by customer"
        />
        <TotalCard
          title="Lindita's workbook"
          value={money(report.totalLindita)}
          hint="Her manual August close — the recreation target"
        />
        <Card
          className={
            variance.isZero()
              ? "border-success/40"
              : "border-danger/40"
          }
        >
          <CardHeader>
            <CardTitle>Variance</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={
                "tabular text-2xl font-semibold " +
                (variance.isZero() ? "text-success" : "text-danger")
              }
            >
              {money(variance)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              ours{" "}
              <span
                className={
                  "font-medium " + (variance.isZero() ? "text-success" : "text-danger")
                }
              >
                {overUnder}
              </span>{" "}
              Lindita
              {variance.isZero() && <span className="text-success"> · ties cent-exact</span>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Discrepancies table — the heart of the acceptance test. */}
      {discrepancies.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-foreground">Discrepancies vs Lindita</CardTitle>
            <Badge variant="danger">
              {discrepancies.length} {discrepancies.length === 1 ? "row" : "rows"} to review
            </Badge>
          </CardHeader>
          <CardContent className="pt-1">
            <p className="mb-3 text-xs text-muted-foreground">
              Each row is a mismatch between our recreation and Lita&rsquo;s manual file. An explained
              line (e.g. a legacy special deal) is still a discrepancy to review here &mdash; nothing is
              auto-accepted.
            </p>
            <Table>
              <THead>
                <TR>
                  <TH>Partner</TH>
                  <TH>Customer</TH>
                  <TH>SKU</TH>
                  <TH>Field</TH>
                  <TH className="text-right">Ours</TH>
                  <TH className="text-right">Lindita</TH>
                  <TH className="text-right">Cents</TH>
                  <TH>Explanation</TH>
                </TR>
              </THead>
              <TBody>
                {discrepancies.map((d, i) => (
                  <DiscrepancyRow key={rowKey(d, i)} d={d} />
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Presence gaps — nothing hidden. */}
      {(onlyOurs.length > 0 || onlyLindita.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PresenceCard
            title="Only in our recreation"
            subtitle="Lines the pipeline produced that Lindita's workbook does not have"
            count={onlyOurs.length}
            items={onlyOurs.map((r) => ({
              partner: r.partner,
              customer: r.customer,
              sku: r.sku.vendorSku,
              legacy: r.sku.isLegacy,
            }))}
          />
          <PresenceCard
            title="Only in Lindita's workbook"
            subtitle="Lines she has that our recreation is missing"
            count={onlyLindita.length}
            items={onlyLindita.map((l) => ({
              partner: l.partner,
              customer: l.customer,
              sku: l.sku,
              legacy: false,
            }))}
          />
        </div>
      )}

      {/* Clean success empty-state. */}
      {nothingToReview && (
        <Card className="border-success/40">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-success/15 text-lg font-semibold text-success">
              &#10003;
            </div>
            <div className="text-base font-semibold text-success">Ties to Lindita, cent-exact</div>
            <p className="max-w-md text-sm text-muted-foreground">
              Every line in the recreation matches her manual August workbook. There are no
              discrepancies and no presence gaps &mdash; the close is safe to trust and hand to
              QuickBooks.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function VerdictBanner({
  matched,
  discrepancyCount,
}: {
  matched: boolean;
  discrepancyCount: number;
}) {
  if (matched) {
    return (
      <div className="rounded-xl border border-success/40 bg-success/10 p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/20 text-success">
            &#10003;
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-success">Ties to Lindita cent-exact</span>
              <Badge variant="success">Matched</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              The recreated August invoice reconciles against Lita&rsquo;s manual one. Safe to trust
              this close.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-danger/40 bg-danger/10 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger/20 text-lg font-semibold text-danger">
          !
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-danger">
              Does not match &mdash; review before trusting the close
            </span>
            <Badge variant="danger">Not matched</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            The recreation diverges from Lita&rsquo;s manual August file
            {discrepancyCount > 0 && (
              <>
                {" "}
                across{" "}
                <span className="font-medium text-foreground">
                  {discrepancyCount} {discrepancyCount === 1 ? "line" : "lines"}
                </span>
              </>
            )}
            . Either the recreation has a bug, or Lindita used a special deal we missed (the classic
            $6-vs-$9 legacy case). Resolve every mismatch before automating.
          </p>
        </div>
      </div>
    </div>
  );
}

function DiscrepancyRow({ d }: { d: Discrepancy }) {
  const isMoney = MONEY_FIELDS.has(d.field);
  const ours = isMoney ? moneyStr(d.ours) : d.ours;
  const lindita = isMoney ? moneyStr(d.lindita) : d.lindita;

  return (
    <TR>
      <TD className="font-medium">{d.partner}</TD>
      <TD className="text-muted-foreground">{d.customer ?? <Dash />}</TD>
      <TD className="tabular text-xs">{d.sku}</TD>
      <TD>
        <Badge variant="danger">{FIELD_LABEL[d.field]}</Badge>
      </TD>
      <TD className="tabular text-right">{ours}</TD>
      <TD className="tabular text-right">{lindita}</TD>
      <TD className="tabular text-right text-muted-foreground">
        {d.centsDiff != null ? formatCents(d.centsDiff) : <Dash />}
      </TD>
      <TD className="max-w-xs text-xs text-muted-foreground">
        {d.explanation ? d.explanation : <span className="opacity-60">&mdash; unexplained</span>}
      </TD>
    </TR>
  );
}

interface PresenceItem {
  partner: string;
  customer: string | null;
  sku: string;
  legacy: boolean;
}

function PresenceCard({
  title,
  subtitle,
  count,
  items,
}: {
  title: string;
  subtitle: string;
  count: number;
  items: PresenceItem[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-foreground">{title}</CardTitle>
        <Badge variant={count > 0 ? "warning" : "muted"}>{count}</Badge>
      </CardHeader>
      <CardContent className="pt-1">
        <p className="mb-3 text-xs text-muted-foreground">{subtitle}</p>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None &mdash; both sides line up.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Partner</TH>
                <TH>Customer</TH>
                <TH>SKU</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((it, i) => (
                <TR key={`${it.partner}|${it.customer ?? ""}|${it.sku}|${i}`}>
                  <TD className="font-medium">{it.partner}</TD>
                  <TD className="text-muted-foreground">{it.customer ?? <Dash />}</TD>
                  <TD className="tabular text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      {it.sku}
                      {it.legacy && <Badge variant="warning">legacy</Badge>}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TotalCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="tabular text-2xl font-semibold">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function Dash() {
  return <span className="text-muted-foreground/50">&mdash;</span>;
}

/** "+3¢" / "-3¢" style label from a signed integer cent difference. */
function formatCents(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "-" : "";
  return `${sign}${Math.abs(cents)}¢`;
}

function rowKey(d: Discrepancy, i: number): string {
  return `${d.partner}|${d.customer ?? ""}|${d.sku}|${d.field}|${i}`;
}
