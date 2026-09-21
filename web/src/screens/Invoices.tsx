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
 */
import { useState } from "react";
import { CheckCircle2, ChevronRight, Flag, Printer } from "lucide-react";
import type {
  DraftLine,
  Exception,
  ExceptionKind,
  PartnerDraft,
  Period,
} from "@pipeline/domain/types.js";
import { useClose, type ReviewEntry, type ReviewStatus } from "@/lib/closeStore";
import type { ScreenProps } from "@/lib/nav";
import { money } from "@/lib/format";
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

function PartnerCard({ draft, status, onOpen }: {
  draft: PartnerDraft;
  status: ReviewStatus | undefined;
  onOpen: () => void;
}) {
  const negative = draft.totalMargin.isNegative();
  return (
    <Card
      role="button"
      tabIndex={0}
      data-testid={`invoice-card-${draft.slug}`}
      className="cursor-pointer transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <CardTitle className="truncate text-foreground">{draft.cardName}</CardTitle>
          {draft.contact.contactEmail !== null && (
            <div className="truncate text-xs text-muted-foreground">
              {draft.contact.contactEmail}
            </div>
          )}
        </div>
        <ReviewPill status={status} />
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-2xl font-semibold tabular">{money(draft.totalL)}</div>
        <div className="text-sm">
          <span className={negative ? "text-danger" : "text-success"}>
            margin {money(draft.totalMargin)}
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
    <Card className="print:hidden">
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
  const badges = anomalyLabels(line.findings);
  const marginNegative = line.margin !== null && line.margin.isNegative();

  return (
    <>
      <TR className={cn(held && "bg-warning/10", nfr && "text-muted-foreground")}>
        <TD>
          <div className={cn(!nfr && "font-medium")}>{line.productLabel}</div>
          <div className="text-xs text-muted-foreground">{line.vendorSku}</div>
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
            </div>
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
            <span className={marginNegative ? "text-danger" : "text-success"}>
              {money(line.margin)}
            </span>
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
              <div className="mb-1 uppercase tracking-wide text-muted-foreground">
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

function InvoiceDetail({ draft, entry, setReview, period, demo, onBack }: {
  draft: PartnerDraft;
  entry: ReviewEntry | undefined;
  setReview: (slug: string, entry: ReviewEntry | null) => void;
  period: Period;
  demo: boolean;
  onBack: () => void;
}) {
  const { contactName, contactEmail, address } = draft.contact;
  const negative = draft.totalMargin.isNegative();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="print:hidden">
        <Button variant="ghost" data-testid="invoice-back" onClick={onBack}>
          ← All invoices
        </Button>
      </div>

      <ReviewToolbar key={draft.slug} slug={draft.slug} entry={entry} setReview={setReview} />

      {/* The invoice document — the ONLY thing that prints. */}
      <div className="print-invoice rounded-xl border border-border bg-card p-8 shadow-sm md:p-10">
        {/* Bill-from */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold tracking-tight">MSP Hub — Disti/MSP</div>
            <div className="text-sm text-muted-foreground">Service period: {period}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge>DRAFT</Badge>
            {demo && <Badge variant="warning">SYNTHETIC</Badge>}
          </div>
        </div>

        {/* Bill-to */}
        <div className="mt-8">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Bill to</div>
          <div className="mt-1 space-y-0.5 text-sm">
            <div className="font-medium">{draft.cardName}</div>
            {contactName !== null && <div>{contactName}</div>}
            {contactEmail !== null && <div>{contactEmail}</div>}
            {address !== null && <div>{address}</div>}
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
              <TH className="text-right print:hidden">Margin</TH>
            </TR>
          </THead>
          <TBody>
            {draft.lines.map((line) => (
              <InvoiceLineRow key={line.vendorSku} line={line} />
            ))}
          </TBody>
        </Table>

        {/* Totals */}
        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-sm space-y-1.5 text-sm">
            {draft.heldLines > 0 && (
              <div className="text-right text-xs text-warning">
                {draft.heldLines} held line{draft.heldLines === 1 ? "" : "s"} excluded from this
                total
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <span>Total due</span>
              <span className="tabular">{money(draft.totalL)}</span>
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
              <span className="text-muted-foreground">Margin ({marginBasisLabel(draft)})</span>
              <span className={cn("tabular", negative ? "text-danger" : "text-success")}>
                {money(draft.totalMargin)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ screen ----------------------------------- */

export function InvoicesScreen({ context }: ScreenProps) {
  const { model, review, setReview, period, demo } = useClose();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(() =>
    context !== undefined && model !== null && model.partners.some((p) => p.slug === context)
      ? context
      : null
  );

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
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Draft invoices</h1>
          <p className="text-sm text-muted-foreground">
            One draft per MSP partner for {period}. Open each to double-check the lines, approve or
            flag it, and print. Held lines are excluded from totals until resolved.
          </p>
        </div>
        <ExportBar />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {model.partners.map((p) => (
          <PartnerCard
            key={p.slug}
            draft={p}
            status={review[p.slug]?.status}
            onOpen={() => setSelectedSlug(p.slug)}
          />
        ))}
      </div>

      {model.partners.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No partner drafts this month — no usage matched a special-pricing block.
        </p>
      )}
    </div>
  );
}
