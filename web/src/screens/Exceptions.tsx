/**
 * Exceptions — every finding of the close, grouped by severity (block → warn →
 * info). Each row can jump to the screen where the finding is actionable,
 * carrying the partner's workspace slug when the name resolves to a draft.
 * Info findings start collapsed — real months carry 40+.
 */
import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import type { Exception, ExceptionKind } from "@pipeline/domain/types.js";
import { useClose } from "@/lib/closeStore";
import type { ScreenProps, SectionKey } from "@/lib/nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";

/** Where each finding kind is actionable. Unmapped kinds fall back to Reconcile. */
const SECTION_FOR_KIND: Partial<Record<ExceptionKind, SectionKey>> = {
  SHEET_MATH_INCONSISTENT: "ratecards",
  LIST_PRICE_DIVERGES: "ratecards",
  DUPLICATE_RATE_ROW: "ratecards",
  MISSING_WORKSPACE_ID: "ratecards",
  DUPLICATE_WORKSPACE_ID: "ratecards",
  EMPTY_PARTNER_BLOCK: "ratecards",
  INVOICE_QTY_DISAGREES: "reconcile",
  INVOICE_RATE_UNEXPECTED: "reconcile",
  OUT_OF_PERIOD_LINE: "reconcile",
  NO_USAGE_BREAKDOWN: "reconcile",
  AUDIT_QTY_MISMATCH: "reconcile",
  UNMAPPED_PARTNER: "reconcile",
  USAGE_NOT_ON_CARD: "reconcile",
  MISSING_RATE: "invoices",
  UNKNOWN_PRODUCT_CODE: "invoices",
  NFR_LINE: "invoices",
  ASSUMED_MAPPING: "invoices",
  PRODUCT_FALLBACK: "invoices",
};

type Severity = Exception["severity"];

const SEVERITY_TITLE: Record<Severity, string> = {
  block: "Blocking",
  warn: "Warnings",
  info: "Informational",
};

/** Severity-colored border + numeral tint for the summary stat chips. */
const SEVERITY_STAT: Record<Severity, string> = {
  block: "border-danger/40 text-danger",
  warn: "border-warning/40 text-warning",
  info: "border-accent/40 text-accent",
};

function SeverityStat({ severity, count }: { severity: Severity; count: number }) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 rounded-lg border bg-card px-4 py-3 shadow-ledger",
        count > 0 ? SEVERITY_STAT[severity] : "border-border text-muted-foreground"
      )}
    >
      <span className="microlabel">{SEVERITY_TITLE[severity]}</span>
      <span className="figure text-2xl">{count}</span>
    </div>
  );
}

function FindingsTable({
  findings,
  onNavigate,
  slugFor,
}: {
  findings: readonly Exception[];
  onNavigate: ScreenProps["onNavigate"];
  slugFor: (partner: string) => string | undefined;
}) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Severity</TH>
          <TH>Kind</TH>
          <TH>Partner</TH>
          <TH>SKU</TH>
          <TH>Message</TH>
          <TH className="w-16" />
        </TR>
      </THead>
      <TBody>
        {findings.map((f, i) => (
          <TR key={`${f.kind}-${f.partner}-${f.sku}-${i}`}>
            <TD>
              <Badge variant={severityVariant(f.severity)}>{f.severity}</Badge>
            </TD>
            <TD className="whitespace-nowrap font-mono text-xs">{f.kind}</TD>
            <TD className="whitespace-nowrap">
              {f.partner !== "" ? f.partner : <span className="text-muted-foreground">—</span>}
            </TD>
            <TD className="whitespace-nowrap font-mono text-xs text-muted-foreground">
              {f.sku !== "" ? f.sku : "—"}
            </TD>
            <TD className="break-words text-muted-foreground">{f.message}</TD>
            <TD>
              <Button
                variant="ghost"
                className="h-auto px-2 py-1 text-xs text-primary"
                onClick={() =>
                  onNavigate(SECTION_FOR_KIND[f.kind] ?? "reconcile", slugFor(f.partner))
                }
              >
                view
              </Button>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function ExceptionsScreen({ onNavigate }: ScreenProps) {
  const { model } = useClose();
  const [showInfo, setShowInfo] = useState(false);

  if (model === null) return null;

  const block = model.findings.filter((f) => f.severity === "block");
  const warn = model.findings.filter((f) => f.severity === "warn");
  const info = model.findings.filter((f) => f.severity === "info");
  const slugFor = (partner: string): string | undefined =>
    model.partners.find((p) => p.cardName === partner)?.slug;

  return (
    <div className="space-y-6">
      <div className="rise space-y-2" style={{ "--rise-i": 0 } as React.CSSProperties}>
        <h1 className="figure rule-brass text-2xl">Exceptions</h1>
        <p className="pt-1 text-sm text-muted-foreground">
          {model.findings.length} finding{model.findings.length === 1 ? "" : "s"} this close —
          every anomaly the pipeline recorded, grouped by severity.
        </p>
      </div>

      {/* Severity summary — three stat chips */}
      <div
        className="rise grid gap-3 sm:grid-cols-3"
        style={{ "--rise-i": 1 } as React.CSSProperties}
      >
        <SeverityStat severity="block" count={block.length} />
        <SeverityStat severity="warn" count={warn.length} />
        <SeverityStat severity="info" count={info.length} />
      </div>

      {model.findings.length === 0 && (
        <Card
          className="rise border-success/40"
          style={{ "--rise-i": 2 } as React.CSSProperties}
        >
          <CardContent className="flex items-center gap-2 p-5 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            No findings — a clean close.
          </CardContent>
        </Card>
      )}

      {([
        ["block", block],
        ["warn", warn],
      ] as const).map(
        ([sev, items], i) =>
          items.length > 0 && (
            <Card
              key={sev}
              className="rise"
              style={{ "--rise-i": i + 2 } as React.CSSProperties}
            >
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <CardTitle>{SEVERITY_TITLE[sev]}</CardTitle>
                <Badge variant={severityVariant(sev)}>{items.length}</Badge>
              </CardHeader>
              <CardContent>
                <FindingsTable findings={items} onNavigate={onNavigate} slugFor={slugFor} />
              </CardContent>
            </Card>
          )
      )}

      {info.length > 0 && (
        <Card className="rise" style={{ "--rise-i": 4 } as React.CSSProperties}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <div className="flex items-center gap-2">
              <CardTitle>{SEVERITY_TITLE.info}</CardTitle>
              <Badge variant={severityVariant("info")}>{info.length}</Badge>
            </div>
            <Button
              variant="ghost"
              data-testid="toggle-info"
              className="h-auto px-2 py-1 text-xs"
              onClick={() => setShowInfo((v) => !v)}
            >
              {showInfo ? (
                <>
                  Hide info findings
                  <ChevronUp className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  Show {info.length} info findings
                  <ChevronDown className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </CardHeader>
          {showInfo && (
            <CardContent>
              <FindingsTable findings={info} onNavigate={onNavigate} slugFor={slugFor} />
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
