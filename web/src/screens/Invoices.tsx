/**
 * Invoices — the payoff screen. One draft invoice per MSP partner for the
 * month; the account team double-checks lines, approves (or flags), and prints.
 *
 * Money semantics (spec 2026-09-21): unitL is pricing col E — the partner's
 * price, what the MSP pays MSP Hub. Cost to Hub is internal-only (print:hidden)
 * and shown per its basis: the real Coro invoice (actualHUnit) when loaded,
 * else the additive rule (expectedHAdditive); when the sheet's col H disagrees
 * with the additive rule, BOTH are shown. HELD lines (no rate) are amber and
 * excluded from totals — never rendered as zero-dollar rows.
 *
 * GP/GM language (MSP Hub): GP = the computed Money margin; GM = gmPct(GP,
 * billed L). Both are screen-only — the printed invoice never shows cost.
 *
 * The list is a review QUEUE: filter chips (All / Unreviewed / Flagged / Held /
 * Approved — Held is orthogonal to status), one-click "Approve all clean" for
 * drafts with nothing held and only info-level findings, and prev/next paging
 * (buttons + arrow keys) through the CURRENTLY FILTERED order in the detail.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCheck, CheckCircle2, ChevronRight, Flag, Printer } from "lucide-react";
import type {
  DraftLine,
  Exception,
  ExceptionKind,
  PartnerDraft,
  Period,
} from "@pipeline/domain/types.js";
import { useClose, type ReviewEntry, type ReviewStatus } from "@/lib/closeStore";
import type { ScreenProps } from "@/lib/nav";
import { gmPct, money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExportBar } from "@/components/ExportBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

/* ------------------------------------------------------------------------- */

const ANOMALY_LABELS: Partial<Record<ExceptionKind, string>> = {
  INVOICE_QTY_DISAGREES: "qty mismatch",
  INVOICE_RATE_UNEXPECTED: "rate anomaly",
  ASSUMED_MAPPING: "assumed rate",
  PRODUCT_FALLBACK: "fallback rate",
};

function anomalyLabels(findings: readonly Exception[]): string[] {
  const out: string[] = [];
  for (const f of findings) {
    const label = ANOMALY_LABELS[f.kind];
    if (label !== undefined && !out.includes(label)) out.push(label);
  }
  return out;
}

/** "vs Coro invoice" once any line's margin is grounded in the real invoice. */
function marginBasisLabel(draft: PartnerDraft): string {
  return draft.lines.some((l) => l.marginBasis === "actual")
    ? "vs Coro invoice"
    : "vs expected cost";
}

function ReviewPill({ status }: { status: ReviewStatus | undefined }) {
  if (status === "approved") return <Badge variant="success">Approved</Badge>;
  if (status === "needs_review") return <Badge variant="warning">Needs review</Badge>;
  return <Badge variant="muted">Unreviewed</Badge>;
}

/* ----------------------------- list view -------------------------------- */

function PartnerCard({ draft, status, index, onOpen }: {
  draft: PartnerDraft;
  status: ReviewStatus | undefined;
  index: number;
  onOpen: () => void;
}) {
  const negative = draft.totalMargin.isNegative();
  return (
    <Card
      role="button"
      tabIndex={0}
      data-testid={`invoice-card-${draft.slug}`}
      className="rise cursor-pointer transition-colors hover:border-primary/60 hover:shadow-ledger-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ "--rise-i": index } as React.CSSProperties}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="min-w-0">
          <CardTitle className="truncate text-sm font-medium normal-case tracking-normal text-foreground">
            {draft.cardName}
          </CardTitle>
          {draft.contact.contactEmail !== null && (
            <div className="truncate text-xs text-muted-foreground">
              {draft.contact.contactEmail}
            </div>
          )}
        </div>
        <ReviewPill status={status} />
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="figure tabular text-2xl">{money(draft.totalL)}</div>
        <div className="text-sm">
          <span className={cn("tabular", negative ? "text-danger" : "text-success")}>
            GP {money(draft.totalMargin)} · GM {gmPct(draft.totalMargin, draft.totalL)}
          </span>{" "}
          <span className="text-xs text-muted-foreground">({marginBasisLabel(draft)})</span>
        </div>
        {draft.heldLines > 0 && (
          <Badge variant="warning">
            {draft.heldLines} held
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------- review toolbar ------------------------------ */

function ReviewToolbar({ slug, entry, setReview }: {
  slug: string;
  entry: ReviewEntry | undefined;
  setReview: (slug: string, entry: ReviewEntry | null) => void;
}) {
  const [note, setNote] = useState(entry?.note ?? "");
  return (
    <Card className="rise print:hidden" style={{ "--rise-i": 1 } as React.CSSProperties}>
      <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
        <div className="flex flex-wrap items-center gap-2">
          <ReviewPill status={entry?.status} />
          <Button
            data-testid="approve-invoice"
            onClick={() => setReview(slug, { status: "approved", note })}
          >
            <CheckCircle2 className="h-4 w-4" />
            Approve
          </Button>
          <Button
            variant="outline"
            data-testid="flag-invoice"
            className="border-warning/40 text-warning hover:bg-warning/10"
            onClick={() => setReview(slug, { status: "needs_review", note })}
          >
            <Flag className="h-4 w-4" />
            Needs review
          </Button>
          <Button variant="outline" data-testid="print-invoice" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print / PDF
          </Button>
        </div>
        <textarea
          data-testid="review-note"
          value={note}
          rows={2}
          placeholder="Review note — saved with this month's close…"
          className="w-full flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            // Persist the note, keeping the current status (unreviewed defaults
            // to needs_review). A stray focus with nothing typed is a no-op.
            if (entry === undefined && note === "") return;
            setReview(slug, { status: entry?.status ?? "needs_review", note });
          }}
        />
      </CardContent>
    </Card>
  );
}

/* ---------------------------- invoice lines ------------------------------ */

/** Internal cost/unit cell: actual Coro-billed when present, else the additive
 * rule; the sheet's col H is ALSO shown whenever it disagrees. */
function CostCell({ line }: { line: DraftLine }) {
  const primary = line.actualHUnit ?? line.expectedHAdditive;
  if (primary === null) return <span className="text-muted-foreground">—</span>;
  const caption = line.actualHUnit !== null ? "actual (Coro invoice)" : "expected (additive)";
  const sheetNote =
    line.expectedHSheet !== null &&
    line.expectedHAdditive !== null &&
    !line.expectedHSheet.equalsCents(line.expectedHAdditive)
      ? money(line.expectedHSheet)
      : null;
  return (
    <div>
      <div>{money(primary)}</div>
      <div className="text-xs text-muted-foreground">{caption}</div>
      {sheetNote !== null && (
        <div className="text-xs text-muted-foreground">sheet {sheetNote}</div>
      )}
    </div>
  );
}

function InvoiceLineRow({ line }: { line: DraftLine }) {
  const [expanded, setExpanded] = useState(false);
  const nfr = line.matchKind === "nfr";
  const held = !nfr && line.unitL === null;
  // Billable but nothing consumed — reviewer noise, so mute the whole row.
  const zeroUsage = !nfr && !held && line.quantity === 0;
  const badges = anomalyLabels(line.findings);
  const marginNegative = line.margin !== null && line.margin.isNegative();

  return (
    <>
      <TR
        className={cn(
          held && "bg-warning/10",
          nfr && "text-muted-foreground",
          zeroUsage && "text-muted-foreground opacity-60"
        )}
      >
        <TD>
          <div className={cn(!nfr && "font-medium")}>{line.productLabel}</div>
          <div className="font-mono text-xs text-muted-foreground">{line.vendorSku}</div>
          {(badges.length > 0 || line.customers.length > 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 print:hidden">
              {badges.map((label) => (
                <Badge key={label} variant="warning">
                  {label}
                </Badge>
              ))}
              {line.customers.length > 0 && (
                <Button
                  variant="ghost"
                  data-testid={`toggle-customers-${line.vendorSku}`}
                  className="h-auto px-1.5 py-0.5 text-xs font-normal text-muted-foreground hover:text-foreground"
                  onClick={() => setExpanded((v) => !v)}
                >
                  <ChevronRight
                    className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")}
                  />
                  {line.customers.length} customer{line.customers.length === 1 ? "" : "s"}
                </Button>
              )}
            </div>
          )}
        </TD>
        <TD className="text-right tabular">
          {line.quantity.toLocaleString()}
          {line.invoiceQuantity !== null && line.invoiceQuantity !== line.quantity && (
            <div className="text-xs text-warning print:hidden">
              inv {line.invoiceQuantity.toLocaleString()}
            </div>
          )}
        </TD>
        <TD className="text-right tabular">
          {line.unitL !== null ? money(line.unitL) : <span className="text-muted-foreground">—</span>}
        </TD>
        <TD className="text-right tabular">
          {nfr ? (
            <span className="text-xs">not billed</span>
          ) : held ? (
            <div className="text-warning">
              <div className="text-xs font-medium">
                {/* The held reason is the MISSING_RATE / UNKNOWN_PRODUCT_CODE
                    finding — findings[0] can be an unrelated info finding. */}
                HELD —{" "}
                {line.findings.find(
                  (f) => f.kind === "MISSING_RATE" || f.kind === "UNKNOWN_PRODUCT_CODE"
                )?.message ?? "no rate on the card"}
              </div>
              <div className="text-xs">excluded from total</div>
              <div className="text-xs text-muted-foreground print:hidden">
                Fix: ask Coro billing to add this product to the partner's special pricing sheet.
              </div>
            </div>
          ) : zeroUsage ? (
            <span className="text-xs">no usage this month</span>
          ) : line.amountL !== null ? (
            money(line.amountL)
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TD>
        <TD className="text-right tabular print:hidden">
          <CostCell line={line} />
        </TD>
        <TD className="text-right tabular print:hidden">
          {line.margin !== null ? (
            <div>
              <div className={marginNegative ? "text-danger" : "text-success"}>
                {money(line.margin)}
              </div>
              <div className="text-xs text-muted-foreground print:hidden">
                GM {gmPct(line.margin, line.amountL)}
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TD>
      </TR>
      {line.customers.length > 0 && (
        // Collapsed on screen until toggled; ALWAYS rendered in print — the MSP
        // wants the by-customer detail on the paper invoice.
        <TR className={cn("bg-muted/20", !expanded && "hidden print:table-row")}>
          <TD colSpan={6} className="py-2">
            <div className="pl-4 text-xs">
              <div className="microlabel mb-1">
                By customer
              </div>
              {line.customers.map((c) => (
                <div
                  key={c.customer ?? "partner-workspace"}
                  className="flex max-w-md justify-between gap-6 border-b border-border/40 py-0.5 last:border-0"
                >
                  <span className={c.customer === null ? "italic text-muted-foreground" : undefined}>
                    {c.customer ?? "partner workspace"}
                  </span>
                  <span className="tabular">{c.quantity.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </TD>
        </TR>
      )}
    </>
  );
}

/* ---------------------------- detail view -------------------------------- */

function InvoiceDetail({ draft, entry, setReview, period, demo, onBack, position, onPrev, onNext }: {
  draft: PartnerDraft;
  entry: ReviewEntry | undefined;
  setReview: (slug: string, entry: ReviewEntry | null) => void;
  period: Period;
  demo: boolean;
  onBack: () => void;
  /** Place in the CURRENTLY FILTERED queue: at is -1 when filtered out. */
  position: { readonly at: number; readonly of: number };
  onPrev: () => void;
  onNext: () => void;
}) {
  const { contactName, contactEmail, address } = draft.contact;
  const negative = draft.totalMargin.isNegative();

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div
        className="rise flex flex-wrap items-center justify-between gap-2 print:hidden"
        style={{ "--rise-i": 0 } as React.CSSProperties}
      >
        <Button variant="ghost" data-testid="invoice-back" onClick={onBack}>
          ← All invoices
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            data-testid="invoice-prev"
            aria-label="Previous draft"
            title="Previous draft (←)"
            disabled={position.of === 0}
            onClick={onPrev}
          >
            ←
          </Button>
          <span className="text-xs text-muted-foreground">
            <span className="tabular">{position.at >= 0 ? position.at + 1 : "–"}</span> of{" "}
            <span className="tabular">{position.of}</span>
          </span>
          <Button
            variant="outline"
            data-testid="invoice-next"
            aria-label="Next draft"
            title="Next draft (→)"
            disabled={position.of === 0}
            onClick={onNext}
          >
            →
          </Button>
        </div>
      </div>

      <ReviewToolbar key={draft.slug} slug={draft.slug} entry={entry} setReview={setReview} />

      {/* The invoice document — the ONLY thing that prints; the ledger's
          design centerpiece on screen. */}
      <div
        className="print-invoice rise rounded-xl border border-border bg-card p-8 shadow-ledger md:p-10"
        style={{ "--rise-i": 2 } as React.CSSProperties}
      >
        {/* Bill-from */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-display text-xl font-semibold tracking-tight">
              MSP Hub — Disti/MSP
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Draft invoice · {period}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge>DRAFT</Badge>
            {demo && <Badge variant="warning">SYNTHETIC</Badge>}
          </div>
        </div>

        {/* Bill-to + service period */}
        <div className="mt-8 flex flex-wrap gap-x-16 gap-y-6">
          <div>
            <div className="microlabel">Bill to</div>
            <div className="mt-1.5 space-y-0.5 text-sm">
              <div className="font-medium">{draft.cardName}</div>
              {contactName !== null && <div>{contactName}</div>}
              {contactEmail !== null && <div>{contactEmail}</div>}
              {address !== null && <div>{address}</div>}
            </div>
          </div>
          <div>
            <div className="microlabel">Service period</div>
            <div className="mt-1.5 text-sm font-medium">{period}</div>
          </div>
        </div>

        {/* Lines */}
        <Table className="mt-8">
          <THead>
            <TR>
              <TH>Product</TH>
              <TH className="text-right">Qty</TH>
              <TH className="text-right">Unit price</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right print:hidden">Cost / unit</TH>
              <TH className="text-right print:hidden">GP</TH>
            </TR>
          </THead>
          <TBody>
            {draft.lines.map((line) => (
              <InvoiceLineRow key={line.vendorSku} line={line} />
            ))}
          </TBody>
        </Table>

        {/* Totals */}
        <div className="mt-8 flex justify-end">
          <div className="w-full max-w-sm space-y-1.5 text-sm">
            {draft.heldLines > 0 && (
              <div className="text-right text-xs text-warning">
                {draft.heldLines} held line{draft.heldLines === 1 ? "" : "s"} excluded from this
                total
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-border pt-3">
              <span className="microlabel">Total due</span>
              <span className="figure tabular text-2xl text-primary">{money(draft.totalL)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground print:hidden">
              <span>Expected cost (additive rule)</span>
              <span className="tabular">{money(draft.totalHExpected)}</span>
            </div>
            {draft.totalHActual !== null && (
              <div className="flex justify-between text-muted-foreground print:hidden">
                <span>Actual cost (Coro invoice)</span>
                <span className="tabular">{money(draft.totalHActual)}</span>
              </div>
            )}
            <div className="flex justify-between print:hidden">
              <span className="text-muted-foreground">
                Gross profit (GP) — {marginBasisLabel(draft)}
              </span>
              <span className={cn("tabular", negative ? "text-danger" : "text-success")}>
                {money(draft.totalMargin)}
              </span>
            </div>
            <div className="flex justify-between print:hidden">
              <span className="text-muted-foreground">Gross margin (GM)</span>
              <span className={cn("tabular", negative ? "text-danger" : "text-success")}>
                {gmPct(draft.totalMargin, draft.totalL)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- review queue ------------------------------ */

type FilterKey = "all" | "unreviewed" | "flagged" | "held" | "approved";

const FILTERS: readonly { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unreviewed", label: "Unreviewed" },
  { key: "flagged", label: "Flagged" },
  { key: "held", label: "Held" },
  { key: "approved", label: "Approved" },
];

/** Held is orthogonal to review status — a held draft shows there regardless. */
function matchesFilter(
  draft: PartnerDraft,
  status: ReviewStatus | undefined,
  filter: FilterKey
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unreviewed":
      return status === undefined;
    case "flagged":
      return status === "needs_review";
    case "held":
      return draft.heldLines > 0;
    case "approved":
      return status === "approved";
  }
}

/** Qualifies for one-click approval: untouched, nothing held, and no line
 * finding above info severity — the drafts that need no human judgment. */
function isClean(draft: PartnerDraft, status: ReviewStatus | undefined): boolean {
  return (
    status === undefined &&
    draft.heldLines === 0 &&
    !draft.lines.some((l) =>
      l.findings.some((f) => f.severity === "block" || f.severity === "warn")
    )
  );
}

/* ------------------------------ screen ----------------------------------- */

export function InvoicesScreen({ context }: ScreenProps) {
  const { model, review, setReview, approveMany, period, demo } = useClose();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(() =>
    context !== undefined && model !== null && model.partners.some((p) => p.slug === context)
      ? context
      : null
  );
  const [filter, setFilter] = useState<FilterKey>("all");

  const partners = model?.partners;

  /** The queue: partners in model order, narrowed by the active chip. */
  const filtered = useMemo(
    () => (partners ?? []).filter((p) => matchesFilter(p, review[p.slug]?.status, filter)),
    [partners, review, filter]
  );

  /** Step prev/next through the CURRENTLY FILTERED order, wrapping around. */
  const step = useCallback(
    (delta: 1 | -1) => {
      setSelectedSlug((slug) => {
        if (filtered.length === 0) return slug;
        const at = slug === null ? -1 : filtered.findIndex((p) => p.slug === slug);
        // Filtered out (e.g. just approved under the Unreviewed chip): next
        // lands on the first queue item, prev on the last.
        const base = at >= 0 ? at : delta === 1 ? -1 : 0;
        return filtered[(base + delta + filtered.length) % filtered.length]!.slug;
      });
    },
    [filtered]
  );

  // Arrow keys page the detail view. Events from the note textarea (or any
  // input) are ignored so typing keeps its caret keys; cleaned up on unmount.
  useEffect(() => {
    if (selectedSlug === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // Leave modifier combos alone — Alt+← is browser back, etc.
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const tag = e.target instanceof HTMLElement ? e.target.tagName : "";
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSlug, step]);

  if (model === null) return null; // App gates on model; belt-and-braces

  const selected =
    selectedSlug === null
      ? undefined
      : model.partners.find((p) => p.slug === selectedSlug);

  if (selected !== undefined) {
    return (
      <InvoiceDetail
        draft={selected}
        entry={review[selected.slug]}
        setReview={setReview}
        period={period}
        demo={demo}
        onBack={() => setSelectedSlug(null)}
        position={{ at: filtered.findIndex((p) => p.slug === selected.slug), of: filtered.length }}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
      />
    );
  }

  const counts: Record<FilterKey, number> = {
    all: 0,
    unreviewed: 0,
    flagged: 0,
    held: 0,
    approved: 0,
  };
  for (const p of model.partners) {
    counts.all += 1;
    const status = review[p.slug]?.status;
    if (status === undefined) counts.unreviewed += 1;
    else if (status === "approved") counts.approved += 1;
    else counts.flagged += 1;
    if (p.heldLines > 0) counts.held += 1;
  }

  const clean = model.partners.filter((p) => isClean(p, review[p.slug]?.status));
  const approveAllClean = () => {
    if (clean.length === 0) return;
    const ok = window.confirm(
      `Approve ${clean.length} clean draft${clean.length === 1 ? "" : "s"}?\n\n` +
        `Clean = unreviewed, zero held lines, no block/warn findings ` +
        `(info-only is fine). Existing notes are kept.`
    );
    if (ok) approveMany(clean.map((p) => p.slug));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="rise space-y-2" style={{ "--rise-i": 0 } as React.CSSProperties}>
          <h1 className="figure rule-brass text-2xl">Draft invoices</h1>
          <p className="pt-1 text-sm text-muted-foreground">
            One draft per MSP partner for {period}. Open each to double-check the lines, approve or
            flag it, and print. Held lines are excluded from totals until resolved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-testid="approve-all-clean"
            disabled={clean.length === 0}
            title={
              clean.length === 0
                ? "Nothing qualifies — clean means unreviewed with zero held lines and no block/warn findings"
                : `Approve ${clean.length} unreviewed draft${clean.length === 1 ? "" : "s"} with zero held lines and only info-level findings`
            }
            onClick={approveAllClean}
          >
            <CheckCheck className="h-4 w-4" />
            Approve all clean
          </Button>
          <ExportBar />
        </div>
      </div>

      <div
        className="rise flex flex-wrap items-center gap-1.5"
        style={{ "--rise-i": 1 } as React.CSSProperties}
        role="group"
        aria-label="Filter drafts by review status"
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              data-testid={`invoice-filter-${f.key}`}
              aria-pressed={active}
              onClick={() => setFilter(f.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
              <span className="tabular">{counts[f.key]}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p, i) => (
          <PartnerCard
            key={p.slug}
            draft={p}
            status={review[p.slug]?.status}
            index={i + 2}
            onOpen={() => setSelectedSlug(p.slug)}
          />
        ))}
      </div>

      {model.partners.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No partner drafts this month — no usage matched a special-pricing block.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No drafts match this filter — pick another chip.
        </p>
      ) : null}
    </div>
  );
}
