import { useMemo, useState } from "react";
import type { DemoResult } from "@/lib/pipeline";
import type { Exception } from "@pipeline/domain/types.js";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge, severityVariant, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

/**
 * Exceptions & Checks — the review surface for MSP Hub accounting.
 *
 * Dane's rule: the system flags, it never silently "fixes" a rate. Accounting is the
 * one who accepts / reclasses / holds. This screen renders the two artifacts that make
 * that judgment possible — the reconciliation checks (the acceptance test's gates) and
 * the priced-line exceptions grouped by kind — and offers a UI-only workflow control so
 * an operator can mark a disposition per group without any of it being persisted.
 *
 * Pure presentational: every number is read straight off DemoResult. The only state is
 * the operator's local (non-persisted) accept/reclass/hold selection.
 */

type Disposition = "accept" | "reclass" | "hold";

const DISPOSITIONS: readonly { key: Disposition; label: string; hint: string }[] = [
  { key: "accept", label: "Accept", hint: "Bill as priced" },
  { key: "reclass", label: "Reclass", hint: "Recode the line" },
  { key: "hold", label: "Hold", hint: "Pull from this close" },
];

/** Severity ordering so blocking groups float to the top of the list. */
const SEVERITY_RANK: Record<Exception["severity"], number> = { block: 0, warn: 1, info: 2 };

const SEVERITY_LABEL: Record<Exception["severity"], string> = {
  block: "Blocking",
  warn: "Warning",
  info: "Info",
};

/** Human-friendly titles for the raw ExceptionKind codes. */
const KIND_TITLE: Record<string, string> = {
  MISSING_HUB_COST: "Missing our cost (H)",
  MISSING_MSP_PRICE: "Missing what we're charging (L)",
  MISSING_RATE_CARD_ROW: "No rate-card row for partner + SKU",
  LEGACY_RATE_UNCONFIRMED: "Legacy rate unconfirmed",
  UNKNOWN_UD_FIELD: "Unknown U / D field",
  NEGATIVE_OR_ZERO_QTY: "Negative or zero quantity",
  PARTNER_SPECIAL_DEAL: "Partner special deal",
  COST_DISAGREES_WITH_INVOICE: "Cost disagrees with Coro invoice",
  SKU_CLASS_NOISE: "SKU class could not be resolved",
};

function kindTitle(kind: string): string {
  return KIND_TITLE[kind] ?? kind.replace(/_/g, " ").toLowerCase();
}

interface ExceptionGroup {
  readonly kind: string;
  readonly severity: Exception["severity"];
  readonly title: string;
  readonly message: string;
  readonly items: readonly Exception[];
}

function checkStatusVariant(status: "pass" | "fail" | "warn"): BadgeVariant {
  return status === "pass" ? "success" : status === "fail" ? "danger" : "warning";
}

function checkStatusLabel(status: "pass" | "fail" | "warn"): string {
  return status === "pass" ? "Pass" : status === "fail" ? "Fail" : "Warn";
}

export function ExceptionsScreen({ result }: { result: DemoResult }) {
  const { checks, exceptions } = result;

  // Group exceptions by kind (blocking severities first), preserving first-seen order within severity.
  const groups = useMemo<ExceptionGroup[]>(() => {
    const byKind = new Map<string, Exception[]>();
    for (const ex of exceptions) {
      const bucket = byKind.get(ex.kind);
      if (bucket) bucket.push(ex);
      else byKind.set(ex.kind, [ex]);
    }
    return Array.from(byKind.entries())
      .map(([kind, items]) => ({
        kind,
        severity: items[0]!.severity,
        title: kindTitle(kind),
        message: items[0]!.message,
        items,
      }))
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          b.items.length - a.items.length ||
          a.title.localeCompare(b.title)
      );
  }, [exceptions]);

  // UI-only workflow state: disposition per exception kind. Default = no decision. Never persisted.
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>({});

  const failingChecks = checks.filter((c) => c.status === "fail").length;
  const blockingLines = exceptions.filter((e) => e.severity === "block").length;

  return (
    <div className="space-y-6">
      {/* Intro / philosophy */}
      <Card>
        <CardHeader>
          <CardTitle>Exceptions &amp; checks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-relaxed text-foreground/90">
            The system <span className="font-medium text-foreground">flags</span>; it never
            silently fixes. Accounting <span className="font-medium text-success">accepts</span>,{" "}
            <span className="font-medium text-warning">reclasses</span>, or{" "}
            <span className="font-medium text-danger">holds</span> — a rate is never rewritten
            behind the operator's back.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-danger">Blocking</span> lines are held out of the
            QuickBooks export entirely — they are never billed as $0. A held line waits for a
            corrected rate, not a guess.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant={failingChecks > 0 ? "danger" : "success"}>
              {failingChecks > 0
                ? `${failingChecks} check${failingChecks === 1 ? "" : "s"} failing`
                : "All checks passing"}
            </Badge>
            <Badge variant={blockingLines > 0 ? "danger" : "muted"}>
              {blockingLines} blocking line{blockingLines === 1 ? "" : "s"} held from export
            </Badge>
            <Badge variant={exceptions.length > 0 ? "info" : "muted"}>
              {exceptions.length} exception{exceptions.length === 1 ? "" : "s"} flagged
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Reconciliation checks — the acceptance test's gates */}
      <Card>
        <CardHeader>
          <CardTitle>Reconciliation checks — the acceptance test</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Check</TH>
                <TH className="w-24">Status</TH>
                <TH className="w-20 text-right">Fails</TH>
                <TH>Detail</TH>
              </TR>
            </THead>
            <TBody>
              {checks.map((check) => (
                <TR key={check.id}>
                  <TD className="font-medium text-foreground">{check.title}</TD>
                  <TD>
                    <Badge variant={checkStatusVariant(check.status)}>
                      {checkStatusLabel(check.status)}
                    </Badge>
                  </TD>
                  <TD className="tabular text-right text-muted-foreground">
                    {check.failCount > 0 ? check.failCount : "—"}
                  </TD>
                  <TD className="text-muted-foreground">{check.detail}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {/* Exceptions grouped by kind */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Badge variant="success">No exceptions</Badge>
            <p className="text-base font-medium text-foreground">
              Every usage line priced cleanly.
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              Each row matched a partner × SKU rate card, our cost (H) and what we're charging (L)
              both attached, and nothing tripped a reconciliation gate. This close is ready to
              hand to QuickBooks.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              Flagged exceptions ({groups.length} group{groups.length === 1 ? "" : "s"})
            </h2>
            <span className="text-xs text-muted-foreground">
              Disposition below is UI-only workflow state — nothing is persisted.
            </span>
          </div>

          {groups.map((group) => {
            const decision = dispositions[group.kind];
            const isBlock = group.severity === "block";
            return (
              <Card
                key={group.kind}
                className={isBlock ? "border-danger/40" : undefined}
              >
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {group.title}
                        </span>
                        <Badge variant={severityVariant(group.severity)}>
                          {SEVERITY_LABEL[group.severity]}
                        </Badge>
                        <Badge variant="muted">
                          {group.items.length} line{group.items.length === 1 ? "" : "s"}
                        </Badge>
                        {isBlock && (
                          <span className="text-xs font-medium text-danger">
                            held from export
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{group.message}</p>
                    </div>

                    {/* Accept / reclass / hold segmented control (UI-only) */}
                    <div
                      role="group"
                      aria-label={`Disposition for ${group.title}`}
                      className="inline-flex overflow-hidden rounded-md border border-border"
                    >
                      {DISPOSITIONS.map((d) => {
                        const active = decision === d.key;
                        return (
                          <Button
                            key={d.key}
                            variant="ghost"
                            title={d.hint}
                            aria-pressed={active}
                            onClick={() =>
                              setDispositions((prev) =>
                                prev[group.kind] === d.key
                                  ? // toggle back to "no decision"
                                    (() => {
                                      const { [group.kind]: _drop, ...rest } = prev;
                                      return rest;
                                    })()
                                  : { ...prev, [group.kind]: d.key }
                              )
                            }
                            className={
                              "rounded-none border-r border-border px-3 py-1.5 text-xs last:border-r-0 " +
                              (active
                                ? d.key === "accept"
                                  ? "bg-success/20 text-success hover:bg-success/25"
                                  : d.key === "reclass"
                                    ? "bg-warning/20 text-warning hover:bg-warning/25"
                                    : "bg-danger/20 text-danger hover:bg-danger/25"
                                : "text-muted-foreground")
                            }
                          >
                            {d.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>

                  {decision && (
                    <p className="pt-2 text-xs text-muted-foreground">
                      Marked{" "}
                      <span className="font-medium text-foreground">{decision}</span> for this
                      group (local only — no persistence).
                    </p>
                  )}
                </CardHeader>

                <CardContent>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Partner</TH>
                        <TH>Customer</TH>
                        <TH>SKU</TH>
                        <TH className="w-20 text-right">Source row</TH>
                        <TH>Message</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {group.items.map((ex, i) => (
                        <TR key={`${group.kind}-${i}`}>
                          <TD className="font-medium text-foreground">{ex.partner}</TD>
                          <TD className="text-muted-foreground">
                            {ex.customer ?? (
                              <span className="italic text-muted-foreground/70">
                                partner-level
                              </span>
                            )}
                          </TD>
                          <TD className="font-mono text-xs text-foreground/90">{ex.sku}</TD>
                          <TD className="tabular text-right text-muted-foreground">
                            {ex.sourceRow != null ? ex.sourceRow : "—"}
                          </TD>
                          <TD className="text-muted-foreground">{ex.message}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
