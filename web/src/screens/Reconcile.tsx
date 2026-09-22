/**
 * Reconcile — the three-way match: rate card ↔ usage ↔ Coro invoice.
 *
 * One row per joined partner draft; expanding a row shows the per-product
 * quantity match against the Coro invoice. Usage with no pricing block and
 * card partners with no usage this month are surfaced separately — nothing
 * silently disappears from the close.
 */
import { Fragment, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Receipt, TriangleAlert } from "lucide-react";
import type { DraftLine, MatchKind } from "@pipeline/domain/types.js";
import { useClose } from "@/lib/closeStore";
import type { ScreenProps } from "@/lib/nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";

/** Short display labels for non-exact pricing matches. */
const MATCH_LABEL: Partial<Record<MatchKind, string>> = {
  "specific-flex": "flex rate",
  "modules-flex": "modules flex",
  "sat-flex": "SAT flex",
  "fallback-current": "fallback",
  "add-module": "module",
  "mislabel-override": "mislabel fix",
  nfr: "NFR",
  none: "no rate",
};

function ProductRow({ line }: { line: DraftLine }) {
  // HELD line (no rate) — keep it loud, with the finding reason, never a quiet
  // zero. NFR lines also carry a null unitL but are non-billable by design, not
  // held (mirrors the pipeline's heldLines definition and Invoices.tsx).
  const held = line.matchKind !== "nfr" && line.unitL === null;
  const heldReason = held
    ? line.findings.find(
        (f) => f.kind === "MISSING_RATE" || f.kind === "UNKNOWN_PRODUCT_CODE"
      )?.message
    : undefined;
  const delta = line.invoiceQuantity !== null ? line.invoiceQuantity - line.quantity : null;
  const matchLabel = MATCH_LABEL[line.matchKind];
  return (
    <TR className={cn(held && "bg-warning/5")}>
      <TD className="whitespace-nowrap font-mono text-xs text-muted-foreground">
        {line.vendorSku}
      </TD>
      <TD>
        <div className={cn(held && "text-warning")}>{line.productLabel}</div>
        {heldReason !== undefined && (
          <div className="mt-0.5 text-xs text-warning">{heldReason}</div>
        )}
      </TD>
      <TD className="tabular text-right">{line.quantity.toLocaleString()}</TD>
      <TD
        className={cn(
          "tabular text-right",
          line.invoiceQuantity === null && "text-muted-foreground"
        )}
      >
        {line.invoiceQuantity !== null ? line.invoiceQuantity.toLocaleString() : "—"}
      </TD>
      <TD
        className={cn(
          "tabular text-right",
          delta !== null && delta !== 0 ? "font-medium text-warning" : "text-muted-foreground"
        )}
      >
        {delta === null ? "—" : delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}
      </TD>
      <TD>
        <span className="inline-flex flex-wrap items-center gap-1">
          {matchLabel !== undefined && (
            <Badge variant={line.matchKind === "none" ? "warning" : "muted"}>{matchLabel}</Badge>
          )}
          {line.creditExpected !== null && (
            <Badge variant="warning">credit ${line.creditExpected.toFixed2()}</Badge>
          )}
        </span>
      </TD>
    </TR>
  );
}

export function ReconcileScreen({ context }: ScreenProps) {
  const { model, files } = useClose();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    context !== undefined ? { [context]: true } : {}
  );
  useEffect(() => {
    if (context !== undefined) setExpanded((e) => ({ ...e, [context]: true }));
  }, [context]);

  if (model === null) return null;
  const invoiceLoaded = files.invoice !== undefined;

  const toggle = (slug: string) => setExpanded((e) => ({ ...e, [slug]: !e[slug] }));

  return (
    <div className="space-y-6">
      <div className="rise space-y-2" style={{ "--rise-i": 0 } as React.CSSProperties}>
        <h1 className="figure rule-brass text-2xl">Reconcile</h1>
        <p className="pt-1 text-sm text-muted-foreground">
          Three-way match: rate card ↔ usage ↔ Coro invoice. Every workspace lands in exactly one
          bucket below.
        </p>
      </div>

      {/* Summary strip — four microlabel + figure stat tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rise" style={{ "--rise-i": 1 } as React.CSSProperties}>
          <CardHeader className="pb-1">
            <CardTitle>Joined partners</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="figure text-3xl text-foreground">{model.partners.length}</div>
            <div className="mt-1 text-xs text-muted-foreground">card + usage matched</div>
          </CardContent>
        </Card>
        <Card
          className={cn("rise", model.usageOnly.length > 0 && "border-warning/40")}
          style={{ "--rise-i": 2 } as React.CSSProperties}
        >
          <CardHeader className="pb-1">
            <CardTitle>Usage only</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "figure text-3xl",
                model.usageOnly.length > 0 ? "text-warning" : "text-foreground"
              )}
            >
              {model.usageOnly.length}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">no special-pricing block</div>
          </CardContent>
        </Card>
        <Card className="rise" style={{ "--rise-i": 3 } as React.CSSProperties}>
          <CardHeader className="pb-1">
            <CardTitle>Card only</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="figure text-3xl text-foreground">{model.cardOnly.length}</div>
            <div className="mt-1 text-xs text-muted-foreground">no usage this month</div>
          </CardContent>
        </Card>
        <Card
          className={cn("rise", invoiceLoaded && "border-success/40")}
          style={{ "--rise-i": 4 } as React.CSSProperties}
        >
          <CardHeader className="pb-1">
            <CardTitle>Coro invoice</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "flex items-center gap-2",
                invoiceLoaded ? "text-success" : "text-muted-foreground"
              )}
            >
              <Receipt className="h-5 w-5 shrink-0" />
              <span className="figure text-2xl">{invoiceLoaded ? "Loaded" : "Not loaded"}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {invoiceLoaded
                ? "actual Coro cost is authoritative"
                : "cost shown from expected rules only"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main three-way table */}
      <Card className="rise" style={{ "--rise-i": 5 } as React.CSSProperties}>
        <CardHeader className="pb-2">
          <CardTitle>Joined partners — quantity match</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH className="w-8" />
                <TH>Partner</TH>
                <TH>Workspace</TH>
                <TH>Card</TH>
                <TH>Usage</TH>
                <TH>Invoice</TH>
              </TR>
            </THead>
            <TBody>
              {model.partners.map((p) => {
                const open = expanded[p.slug] === true;
                const onInvoice = p.lines.some((l) => l.actualHAmount !== null);
                return (
                  <Fragment key={p.slug}>
                    <TR>
                      <TD className="w-8 pr-0">
                        <button
                          data-testid={`reconcile-expand-${p.slug}`}
                          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-expanded={open}
                          title={open ? "Collapse products" : "Expand products"}
                          onClick={() => toggle(p.slug)}
                        >
                          {open ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </TD>
                      <TD>
                        <div className="font-medium">{p.cardName}</div>
                        {p.invoiceName !== null && p.invoiceName !== p.cardName && (
                          <div className="text-xs text-muted-foreground">
                            on invoice: {p.invoiceName}
                          </div>
                        )}
                      </TD>
                      <TD className="font-mono text-xs text-muted-foreground">{p.slug}</TD>
                      <TD>
                        <Check className="h-4 w-4 text-success" />
                      </TD>
                      <TD>
                        <Check className="h-4 w-4 text-success" />
                      </TD>
                      <TD>
                        {onInvoice ? (
                          <Check className="h-4 w-4 text-success" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TD>
                    </TR>
                    {open && (
                      <TR className="bg-muted/20">
                        <TD className="w-8" />
                        <TD colSpan={5} className="pb-3">
                          <Table>
                            <THead>
                              <TR>
                                <TH>SKU</TH>
                                <TH>Product</TH>
                                <TH className="text-right">Usage qty</TH>
                                <TH className="text-right">Invoice qty</TH>
                                <TH className="text-right">Δ</TH>
                                <TH>Match</TH>
                              </TR>
                            </THead>
                            <TBody>
                              {p.lines.map((l) => (
                                <ProductRow key={l.vendorSku} line={l} />
                              ))}
                            </TBody>
                          </Table>
                        </TD>
                      </TR>
                    )}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {/* Usage with no pricing block — these lines are in NO draft. */}
      {model.usageOnly.length > 0 && (
        <Card
          className="rise border-warning/40"
          style={{ "--rise-i": 6 } as React.CSSProperties}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-warning">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              Usage without a rate card
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              These workspaces consumed Coro this month but have no special-pricing block — their
              usage is in no draft invoice until a rate card lands.
            </p>
            <ul className="space-y-1">
              {model.usageOnly.map((u) => (
                <li key={u.slug} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium">{u.partner}</span>
                  <span className="font-mono text-xs text-muted-foreground">{u.slug}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Card partners with no usage — quiet, not missing. */}
      {model.cardOnly.length > 0 && (
        <Card className="rise" style={{ "--rise-i": 7 } as React.CSSProperties}>
          <CardHeader className="pb-2">
            <CardTitle>On the card, quiet this month</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {model.cardOnly.map((p) => (
              <Badge key={`${p.sourceRow}-${p.name}`} variant="muted">
                {p.name}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
