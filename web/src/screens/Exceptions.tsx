/**
 * Exceptions — every finding of the close, grouped by KIND and ordered by
 * severity (block → warn → info), run as a burn-down list: each row carries an
 * acknowledge checkbox so the accounting team can record that a human saw it
 * (it changes no number). Each kind is a collapsible glass panel; info-kind
 * groups start collapsed — real months carry 40+ info findings. Each row can
 * jump to the screen where the finding is actionable, carrying the partner's
 * workspace slug when the name resolves to a draft.
 */
import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, EyeOff } from "lucide-react";
import type { Exception, ExceptionKind } from "@pipeline/domain/types.js";
import { useClose, findingKey } from "@/lib/closeStore";
import type { ScreenProps, SectionKey } from "@/lib/nav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/glass/GlassPanel";
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
  CLIENT_PRICE_DIFFERS: "invoices",
  // Coro 2026-09-22 answers:
  CREDIT_EXPECTED: "reconcile", // over-billed legacy line — chase the Coro credit memo
  CLASSIC_RATE_RULE_DISAGREES: "ratecards", // card row drifts from the flat-45 Classic rule
  SHEET_MISLABEL_OVERRIDE: "ratecards", // priced via the curated mislabel signature
};

type Severity = Exception["severity"];

const SEVERITY_TITLE: Record<Severity, string> = {
  block: "Blocking",
  warn: "Warnings",
  info: "Informational",
};

const SEVERITY_RANK: Record<Severity, number> = { block: 0, warn: 1, info: 2 };

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
        "flex items-baseline justify-between gap-3 rounded-glass border bg-glass-1 px-4 py-3 shadow-glass",
        count > 0 ? SEVERITY_STAT[severity] : "border-edge text-muted-foreground"
      )}
    >
      <span className="microlabel">{SEVERITY_TITLE[severity]}</span>
      <span className="figure text-2xl">{count}</span>
    </div>
  );
}

/** Findings of one kind, tagged with the group's severity (block > warn > info). */
interface KindGroup {
  readonly kind: ExceptionKind;
  readonly severity: Severity;
  readonly items: readonly Exception[];
}

/** Group findings by kind, ordered block → warn → info then kind name. */
function groupByKind(findings: readonly Exception[]): readonly KindGroup[] {
  const byKind = new Map<ExceptionKind, Exception[]>();
  for (const f of findings) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
  }
  const groups: KindGroup[] = [...byKind.entries()].map(([kind, items]) => ({
    kind,
    severity: items.reduce<Severity>(
      (s, f) => (SEVERITY_RANK[f.severity] < SEVERITY_RANK[s] ? f.severity : s),
      "info"
    ),
    items,
  }));
  groups.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.kind.localeCompare(b.kind)
  );
  return groups;
}

function FindingsTable({
  findings,
  onNavigate,
  slugFor,
  acked,
  onToggleAck,
}: {
  findings: readonly Exception[];
  onNavigate: ScreenProps["onNavigate"];
  slugFor: (partner: string) => string | undefined;
  acked: ReadonlySet<string>;
  onToggleAck: (key: string) => void;
}) {
  return (
    <Table>
      <THead>
        <TR>
          <TH className="w-10">Ack</TH>
          <TH>Severity</TH>
          <TH>Kind</TH>
          <TH>Partner</TH>
          <TH>SKU</TH>
          <TH>Message</TH>
          <TH className="w-16" />
        </TR>
      </THead>
      <TBody>
        {findings.map((f) => {
          const key = findingKey(f);
          const isAcked = acked.has(key);
          return (
            <TR key={key} className={cn(isAcked && "opacity-60")}>
              <TD>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-primary"
                  aria-label={`Acknowledge finding ${f.kind}`}
                  checked={isAcked}
                  onChange={() => onToggleAck(key)}
                />
              </TD>
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
              <TD className={cn("break-words text-muted-foreground", isAcked && "line-through")}>
                {f.message}
              </TD>
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
          );
        })}
      </TBody>
    </Table>
  );
}

export function ExceptionsScreen({ onNavigate }: ScreenProps) {
  const { model, acked, toggleAck } = useClose();
  const [showInfo, setShowInfo] = useState(false);
  const [hideAcked, setHideAcked] = useState(false);

  if (model === null) return null;

  const ackedCount = model.findings.filter((f) => acked.has(findingKey(f))).length;
  const total = model.findings.length;
  const ackPct = total > 0 ? (ackedCount / total) * 100 : 0;

  const visible = (items: readonly Exception[]): readonly Exception[] =>
    hideAcked ? items.filter((f) => !acked.has(findingKey(f))) : items;

  const block = visible(model.findings.filter((f) => f.severity === "block"));
  const warn = visible(model.findings.filter((f) => f.severity === "warn"));
  const info = visible(model.findings.filter((f) => f.severity === "info"));
  const groups = groupByKind([...block, ...warn, ...info]);
  const slugFor = (partner: string): string | undefined =>
    model.partners.find((p) => p.cardName === partner)?.slug;

  return (
    <div className="space-y-6">
      <div className="fade-up space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h1 className="figure rule-brass text-2xl">Exceptions</h1>
            <p className="pt-1 text-sm text-muted-foreground">
              {total} finding{total === 1 ? "" : "s"} this close —
              every anomaly the pipeline recorded, grouped by kind, blockers first.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {info.length > 0 && (
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
            )}
            {total > 0 && (
              <Button
                variant="outline"
                data-testid="toggle-acked"
                aria-pressed={hideAcked}
                className={cn(
                  "h-auto px-2.5 py-1.5 text-xs",
                  hideAcked && "border-primary/40 bg-primary/10 text-primary"
                )}
                onClick={() => setHideAcked((v) => !v)}
              >
                <EyeOff className="h-3.5 w-3.5" />
                Hide acknowledged
              </Button>
            )}
          </div>
        </div>
        {total > 0 && (
          <div className="max-w-sm space-y-1.5 pt-1" data-testid="ack-progress">
            <div className="flex items-baseline gap-1.5">
              <span className="microlabel">acknowledged</span>
              <span className="figure text-sm">{ackedCount}</span>
              <span className="text-xs text-muted-foreground">of</span>
              <span className="figure text-sm">{total}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted/60">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${ackPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Severity summary — three stat chips */}
      <div className="fade-up grid gap-3 sm:grid-cols-3" style={{ animationDelay: "40ms" }}>
        <SeverityStat severity="block" count={block.length} />
        <SeverityStat severity="warn" count={warn.length} />
        <SeverityStat severity="info" count={info.length} />
      </div>

      {total === 0 && (
        <Card className="fade-up border-success/40" style={{ animationDelay: "80ms" }}>
          <CardContent className="flex items-center gap-2 p-5 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            No findings — a clean close.
          </CardContent>
        </Card>
      )}

      {total > 0 && hideAcked && block.length + warn.length + info.length === 0 && (
        <Card className="fade-up border-success/40" style={{ animationDelay: "80ms" }}>
          <CardContent className="flex items-center gap-2 p-5 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            All {total} finding{total === 1 ? "" : "s"} acknowledged — burn-down complete.
          </CardContent>
        </Card>
      )}

      {/* One collapsible glass panel per finding kind, block → warn → info.
          Block/warn groups open by default; info groups follow the bulk toggle
          (each stays individually collapsible in between). */}
      {groups.map((g, i) => (
        <div
          key={g.kind}
          className="fade-up"
          style={{ animationDelay: `${Math.min(i + 2, 12) * 40}ms` }}
        >
          <GlassPanel>
            <details className="group" open={g.severity === "info" ? showInfo : true}>
              <summary className="flex cursor-pointer select-none list-none flex-wrap items-center gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <Badge variant={severityVariant(g.severity)}>{g.severity}</Badge>
                <span className="font-mono text-sm text-foreground">{g.kind}</span>
                <span className="text-xs text-muted-foreground">
                  · {g.items.length} finding{g.items.length === 1 ? "" : "s"}
                </span>
                <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <div className="border-t border-edge px-4 pb-4 pt-1">
                <FindingsTable
                  findings={g.items}
                  onNavigate={onNavigate}
                  slugFor={slugFor}
                  acked={acked}
                  onToggleAck={toggleAck}
                />
              </div>
            </details>
          </GlassPanel>
        </div>
      ))}
    </div>
  );
}
