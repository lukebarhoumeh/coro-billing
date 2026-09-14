import { downloadText, type DemoResult } from "@/lib/pipeline";
import { money } from "@/lib/format";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

/**
 * Invoices screen — presentational only.
 *
 * Renders the outbound QuickBooks invoices exactly as the pipeline built them:
 * one invoice per MSP partner, each broken down by customer. H (our cost) is
 * internal and never shown on the partner-facing lines; the per-invoice footer
 * surfaces subtotal charge (L), subtotal cost (H) and margin for Hub accounting.
 *
 * No data fetching, no re-running the pipeline, no business logic. The only
 * computation is a display-only Money.add over the invoice subtotals for the
 * page-level totals bar.
 */
export function InvoicesScreen({ result }: { result: DemoResult }) {
  const { invoices, period } = result;

  // Display-only rollups across all invoices (Money.add — never float math).
  // Seed from the first invoice's zeroed subtotal so the accumulator is always a
  // non-null Money triple when there is at least one invoice.
  const first = invoices[0];
  const totals = first
    ? invoices.reduce(
        (acc, inv) => ({
          charge: acc.charge.add(inv.subtotalCharge),
          cost: acc.cost.add(inv.subtotalCost),
          margin: acc.margin.add(inv.margin),
        }),
        {
          charge: first.subtotalCharge.mul(0),
          cost: first.subtotalCost.mul(0),
          margin: first.margin.mul(0),
        }
      )
    : null;

  return (
    <div className="space-y-6">
      {/* Intro — Dane's Amplivity framing. */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Invoices</h2>
          <Badge variant="muted">{period}</Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          One invoice per MSP partner, broken down by customer. Amplivity gets a single
          bill from us for all of this stuff, with each end customer as its own line.
        </p>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The MSP is the QuickBooks <span className="text-foreground">Customer</span>; the
          end customer / workspace is the line breakdown.{" "}
          <span className="text-foreground">H (our cost)</span> is internal to Hub
          accounting and is not shown to the partner — only{" "}
          <span className="text-foreground">L, what we&rsquo;re charging</span>, appears on
          the invoice lines.
        </p>
      </div>

      {/* Export actions — the clean artifacts Lindita can post to QuickBooks. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => downloadText(`coro-invoices-${period}.csv`, result.csv)}
        >
          Download QuickBooks CSV
        </Button>
        <Button
          variant="outline"
          onClick={() => downloadText(`coro-invoices-${period}.iif`, result.iif, "text/plain")}
        >
          Download IIF (Desktop)
        </Button>
        <span className="text-xs text-muted-foreground">
          QBO import CSV or QuickBooks Desktop IIF — the same output the pipeline hands off.
        </span>
      </div>

      {/* Held lines — blocking exceptions are excluded from the invoices/export above
          (never billed as $0). Surfaced here so nothing is hidden. */}
      {result.held.length > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <Badge variant="warning">
                {result.held.length} line{result.held.length === 1 ? "" : "s"} held from export
              </Badge>
              <span className="text-sm text-muted-foreground">
                Blocking exceptions — excluded from the invoices and the QuickBooks export
                (never billed as $0). Resolve the rate, then re-run.
              </span>
            </div>
            <Table className="mt-3">
              <THead>
                <TR>
                  <TH>Partner</TH>
                  <TH>Customer</TH>
                  <TH>SKU</TH>
                  <TH className="text-right">Qty</TH>
                  <TH>Reason</TH>
                </TR>
              </THead>
              <TBody>
                {result.held.map((r, i) => (
                  <TR key={`held-${r.partner}-${r.sku.vendorSku}-${i}`}>
                    <TD className="font-medium text-foreground">{r.partner}</TD>
                    <TD>
                      {r.customer ?? <span className="text-muted-foreground">(partner-level)</span>}
                    </TD>
                    <TD className="font-mono text-xs text-muted-foreground">{r.sku.vendorSku}</TD>
                    <TD className="text-right tabular">{r.quantity}</TD>
                    <TD className="text-xs text-muted-foreground">
                      {r.exceptions
                        .filter((e) => e.severity === "block")
                        .map((e) => e.kind)
                        .join(", ")}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Page-level totals bar. */}
      {totals && (
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 pt-5 sm:grid-cols-4">
            <Totals label="Invoices" value={String(invoices.length)} />
            <Totals label="Total charge (L)" value={money(totals.charge)} accent="success" />
            <Totals label="Total cost (H) · internal" value={money(totals.cost)} muted />
            <Totals label="Margin" value={money(totals.margin)} accent="success" />
          </CardContent>
        </Card>
      )}

      {/* One card per invoice. */}
      {invoices.length === 0 ? (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">
            No invoices in this close.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {invoices.map((inv) => (
            <Card key={inv.partner}>
              <CardHeader className="flex items-start justify-between gap-4 pb-4">
                <div className="space-y-1">
                  <CardTitle className="text-xs">MSP partner · QuickBooks Customer</CardTitle>
                  <div className="text-lg font-semibold text-foreground">{inv.partner}</div>
                  <div className="text-xs text-muted-foreground">
                    {inv.lines.length} {inv.lines.length === 1 ? "line" : "lines"}, broken down by customer
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Invoice total (L)</div>
                  <Badge variant="success" className="mt-1 text-sm tabular">
                    {money(inv.subtotalCharge)}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Customer</TH>
                      <TH>SKU</TH>
                      <TH>Description</TH>
                      <TH className="text-right">Qty</TH>
                      <TH className="text-right">Rate (L)</TH>
                      <TH className="text-right">Amount</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {inv.lines.map((line, i) => (
                      <TR key={`${inv.partner}-${line.customer ?? "partner"}-${line.sku}-${i}`}>
                        <TD className="font-medium text-foreground">
                          {line.customer ?? (
                            <span className="text-muted-foreground">(partner-level)</span>
                          )}
                        </TD>
                        <TD className="font-mono text-xs text-muted-foreground">{line.sku}</TD>
                        <TD className="text-muted-foreground">{line.description}</TD>
                        <TD className="text-right tabular">{line.quantity}</TD>
                        <TD className="text-right tabular">{money(line.rate)}</TD>
                        <TD className="text-right tabular font-medium text-foreground">
                          {money(line.amount)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                  <tfoot>
                    <tr className="border-t border-border">
                      <td
                        colSpan={5}
                        className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground"
                      >
                        Subtotal — what we&rsquo;re charging (L)
                      </td>
                      <td className="px-3 py-2 text-right tabular font-semibold text-foreground">
                        {money(inv.subtotalCharge)}
                      </td>
                    </tr>
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-1 text-right text-xs uppercase tracking-wide text-muted-foreground"
                      >
                        Our cost (H) · internal
                      </td>
                      <td className="px-3 py-1 text-right tabular text-muted-foreground">
                        {money(inv.subtotalCost)}
                      </td>
                    </tr>
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-1 pb-2 text-right text-xs uppercase tracking-wide text-muted-foreground"
                      >
                        Margin
                      </td>
                      <td className="px-3 py-1 pb-2 text-right tabular font-medium text-success">
                        {money(inv.margin)}
                      </td>
                    </tr>
                  </tfoot>
                </Table>
                <p className="mt-3 text-xs text-muted-foreground">
                  H (our cost) and margin are internal to Hub accounting — the partner only sees the L lines above.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Totals({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: string;
  accent?: "success";
  muted?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1 text-2xl font-semibold tabular " +
          (accent === "success" ? "text-success" : muted ? "text-muted-foreground" : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}
