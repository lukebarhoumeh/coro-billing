/**
 * Report pack — the monthly close as a print-grade paper document (spec §5).
 *
 * Rendered on demand as a full-screen overlay (same in-app pattern as
 * InvoiceDoc): white ground, navy/gold/slate print-safe palette, plain
 * semantic tables with 1px slate borders — NO glass classes anywhere in this
 * component. Printing rides the `.print-report` carve-out in index.css (the
 * same visibility technique the customer invoice uses), so the print output
 * is the report alone; the `no-print` bar at the top re-prints or closes.
 * Opening the pack goes straight to the print dialog ("Report pack ↧" means
 * paper) — cancelling keeps the on-screen preview.
 *
 * INTERNAL document: unlike the customer invoice, cost / GP / GM are the
 * point. Sections: header, KPI block, GP concentration, partner summary,
 * billed bridge (when a prior month is archived), credit tracker, findings
 * digest, audit footer (fingerprints + rates revision + generated-at).
 */
import { useEffect, useMemo, type ReactNode } from "react";
import { sum } from "@pipeline/lib/money.js";
import {
  snapshotFromClose,
  type CloseSnapshot,
  type CreditStatus,
} from "@pipeline/domain/snapshot.js";
import { CONFIRMED_RATES_REVISION } from "@pipeline/config/confirmedRates.js";
import { waterfall } from "@pipeline/close/trends.js";
import { useClose } from "@/lib/closeStore";
import { money, moneyStr, gmPct, pct } from "@/lib/format";
import { cn } from "@/lib/cn";

const NAVY = "#1B3A57";
const GOLD = "#B98A2F";
/** GP-concentration bar palette — print-safe navy/gold/slate (spec §5). */
const BAR_COLORS: readonly string[] = [NAVY, GOLD, "#475569", "#64748B", "#94A3B8"];
const OTHERS_COLOR = "#CBD5E1";

const CREDIT_LABEL: Record<CreditStatus, string> = {
  expected: "expected",
  "memo-received": "memo received",
  applied: "applied",
};

const SEVERITY_ORDER: Record<"block" | "warn" | "info", number> = { block: 0, warn: 1, info: 2 };

/** "$1,234.56" / "−$1,234.56" from signed cents (bridge + credit balance). */
function fmtCents(c: number): string {
  return (
    (c < 0 ? "−" : "") +
    "$" +
    Math.abs(c / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Table cell idioms — every border is an explicit 1px slate line. */
const TH =
  "border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-left text-[0.625rem] font-medium uppercase tracking-[0.14em] text-slate-600";
const TD = "border border-slate-300 px-2.5 py-1.5";

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <div className="mb-2 border-b border-slate-300 pb-1 text-[0.625rem] font-medium uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      {children}
    </section>
  );
}

interface CreditRow {
  readonly period: string;
  readonly slug: string;
  readonly name: string;
  readonly expected: string;
  readonly status: CreditStatus;
}

export function ReportPack({ onClose }: { onClose: () => void }) {
  const { model, period, files, demo, archivePeriods, loadArchived } = useClose();

  // Pinned once per open so the header date and the audit footer agree.
  const generatedAt = useMemo(() => new Date().toISOString(), []);

  // "Report pack ↧" opens the overlay then window.print() — a short delay lets
  // the document paint first. Cancelling the dialog keeps the preview open.
  useEffect(() => {
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, []);

  // Escape closes — the overlay behaves like a modal document viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Snapshot-shaped view of the close: totals, bridge vs the prior archived
  // month, and the credit tracker across the whole archive (live close wins
  // its own period; archived credit-status edits overlay the fresh snapshot).
  const report = useMemo(() => {
    if (model === null || files.pricing === undefined || files.usage === undefined) return null;
    const fp = {
      pricing: files.pricing.fingerprint.slice(0, 12),
      usage: files.usage.fingerprint.slice(0, 12),
      ...(files.invoice !== undefined ? { invoice: files.invoice.fingerprint.slice(0, 12) } : {}),
    };
    const live = snapshotFromClose(model, fp, CONFIRMED_RATES_REVISION, generatedAt);
    const archivedCurrent = loadArchived(period);
    const curr: CloseSnapshot = {
      ...live,
      creditStatus: { ...live.creditStatus, ...(archivedCurrent?.creditStatus ?? {}) },
    };
    const prevPeriod = archivePeriods.filter((p) => p < period).at(-1) ?? null;
    const prevSnap = prevPeriod !== null ? loadArchived(prevPeriod) : null;

    const allSnaps = [
      ...archivePeriods
        .filter((p) => p !== period)
        .map((p) => loadArchived(p))
        .filter((s): s is CloseSnapshot => s !== null),
      curr,
    ].sort((a, b) => a.period.localeCompare(b.period));
    const creditRows: CreditRow[] = allSnaps.flatMap((s) =>
      s.partners
        .filter((p) => p.creditExpected !== "0.00")
        .map((p) => ({
          period: s.period,
          slug: p.slug,
          name: p.cardName,
          expected: p.creditExpected,
          status: s.creditStatus[p.slug] ?? "expected",
        }))
    );
    creditRows.sort(
      (a, b) => b.period.localeCompare(a.period) || Number(b.expected) - Number(a.expected)
    );
    const outstandingCents = creditRows.reduce(
      (n, r) => n + (r.status !== "applied" ? Math.round(Number(r.expected) * 100) : 0),
      0
    );

    return {
      curr,
      buckets: prevSnap !== null ? waterfall(prevSnap, curr) : null,
      prevPeriod,
      creditRows,
      outstandingCents,
    };
  }, [model, files, period, archivePeriods, loadArchived, generatedAt]);

  // Model-side aggregates (Money-exact, same conventions as Overview):
  // partner summary by billed desc, GP concentration over positive GP,
  // findings digest by kind × severity.
  const aggregates = useMemo(() => {
    if (model === null) return null;
    const byBilled = [...model.partners].sort((a, b) => b.totalL.toCents() - a.totalL.toCents());
    const billedTotal = sum(model.partners.map((p) => p.totalL));
    const costTotal = sum(model.partners.map((p) => p.totalHActual ?? p.totalHExpected));
    const marginTotal = sum(model.partners.map((p) => p.totalMargin));

    const positives = model.partners
      .filter((p) => p.totalMargin.toCents() > 0)
      .sort(
        (x, y) => y.totalMargin.toCents() - x.totalMargin.toCents() || x.slug.localeCompare(y.slug)
      );
    const positiveGpCents = positives.reduce((n, p) => n + p.totalMargin.toCents(), 0);
    const gpBars = positives.slice(0, 5).map((p, i) => ({
      key: p.slug,
      label: p.cardName,
      value: money(p.totalMargin),
      share: positiveGpCents > 0 ? p.totalMargin.toCents() / positiveGpCents : 0,
      color: BAR_COLORS[Math.min(i, BAR_COLORS.length - 1)]!,
    }));
    const rest = positives.slice(5);
    if (rest.length > 0) {
      const restGp = sum(rest.map((p) => p.totalMargin));
      gpBars.push({
        key: "__others",
        label: `${rest.length} others`,
        value: money(restGp),
        share: positiveGpCents > 0 ? restGp.toCents() / positiveGpCents : 0,
        color: OTHERS_COLOR,
      });
    }

    const digest = new Map<string, { kind: string; severity: "block" | "warn" | "info"; count: number }>();
    for (const f of model.findings) {
      const key = `${f.kind}|${f.severity}`;
      const entry = digest.get(key);
      if (entry === undefined) digest.set(key, { kind: f.kind, severity: f.severity, count: 1 });
      else entry.count += 1;
    }
    const findingsRows = [...digest.values()].sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        b.count - a.count ||
        a.kind.localeCompare(b.kind)
    );

    return { byBilled, billedTotal, costTotal, marginTotal, gpBars, findingsRows };
  }, [model]);

  if (model === null || report === null || aggregates === null) return null;

  const t = report.curr.totals;
  const fp = report.curr.fingerprints;
  const generatedDate = new Date(generatedAt).toLocaleDateString("en-US");
  const kpis: readonly { label: string; value: string }[] = [
    { label: "Billed to partners", value: moneyStr(t.billedL) },
    { label: "Our cost (expected)", value: moneyStr(t.costExpected) },
    ...(t.costActual !== undefined
      ? [{ label: "Our cost (actual)", value: moneyStr(t.costActual) }]
      : []),
    { label: "Gross profit", value: moneyStr(t.margin) },
    { label: "Coro credit expected", value: moneyStr(t.creditExpected) },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Coro close report pack for ${period}`}
      data-testid="report-pack-overlay"
      className="print-report fixed inset-0 z-[100] overflow-auto bg-white text-slate-900"
    >
      {/* Screen-only controls — hidden from paper via .no-print. */}
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-6 py-3">
        <span className="text-sm text-slate-500">
          Report pack preview — Print / PDF produces the paper document.
        </span>
        <div className="flex items-center gap-2">
          <button
            data-testid="report-print"
            onClick={() => window.print()}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Print / PDF
          </button>
          <button
            data-testid="report-close"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            style={{ backgroundColor: NAVY }}
          >
            Close
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-7 px-8 py-8">
        {/* ---- Header: brand + Coro Close — <period> + generated date ---- */}
        <header className="break-inside-avoid border-l-[6px]" style={{ borderColor: GOLD }}>
          <div className="px-7 py-6" style={{ backgroundColor: NAVY }}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <span className="inline-flex items-center rounded-md bg-white px-3 py-2.5 shadow-sm">
                <img src="/brand/msphub-logo.jpeg" alt="MSP Hub" className="h-5 w-auto" />
              </span>
              <div className="text-right">
                <div className="flex items-center justify-end gap-2">
                  {demo && (
                    <span className="rounded border border-amber-300/60 bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold tracking-[0.15em] text-amber-200">
                      SYNTHETIC
                    </span>
                  )}
                  <span className="font-display text-2xl font-semibold tracking-[0.06em] text-white">
                    Coro Close — {period}
                  </span>
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-white/60">
                  Monthly close report · generated {generatedDate}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ---- KPI block: plain stat rows ---- */}
        <Section label="Month totals">
          <div className="border border-slate-300">
            {kpis.map((k) => (
              <div
                key={k.label}
                className="flex items-baseline justify-between gap-6 border-b border-slate-200 px-3.5 py-2 text-sm last:border-b-0"
              >
                <span className="text-slate-600">{k.label}</span>
                <span className="tabular font-semibold text-slate-900">{k.value}</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Held lines are excluded from every total; cost is the Coro-invoice actual where loaded,
            the additive expected rule otherwise.
          </p>
        </Section>

        {/* ---- GP concentration: plain horizontal bars ---- */}
        <Section label="GP concentration — share of positive gross profit">
          {aggregates.gpBars.length === 0 ? (
            <p className="text-sm text-slate-500">No positive gross profit this month.</p>
          ) : (
            <div className="space-y-1.5">
              {aggregates.gpBars.map((b) => (
                <div key={b.key} className="flex items-center gap-3 text-xs">
                  <span className="w-44 shrink-0 truncate text-slate-700">{b.label}</span>
                  <span className="h-3 flex-1 overflow-hidden rounded-sm bg-slate-100">
                    <span
                      className="block h-full"
                      style={{ width: `${b.share * 100}%`, backgroundColor: b.color }}
                    />
                  </span>
                  <span className="tabular w-24 shrink-0 text-right font-medium text-slate-900">
                    {b.value}
                  </span>
                  <span className="tabular w-12 shrink-0 text-right text-slate-500">
                    {pct(b.share)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ---- Partner summary ---- */}
        <Section label="Partner summary">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={TH}>Partner</th>
                <th className={cn(TH, "text-right")}>Billed</th>
                <th className={cn(TH, "text-right")}>Cost</th>
                <th className={cn(TH, "text-right")}>GP</th>
                <th className={cn(TH, "text-right")}>GM</th>
              </tr>
            </thead>
            <tbody>
              {aggregates.byBilled.map((p) => (
                <tr key={p.slug}>
                  <td className={cn(TD, "font-medium")}>
                    {p.cardName}
                    {p.heldLines > 0 && (
                      <span className="ml-1.5 text-[10px] text-amber-700">
                        ({p.heldLines} held)
                      </span>
                    )}
                  </td>
                  <td className={cn(TD, "tabular text-right")}>{money(p.totalL)}</td>
                  <td className={cn(TD, "tabular text-right")}>
                    {money(p.totalHActual ?? p.totalHExpected)}
                  </td>
                  <td
                    className={cn(
                      TD,
                      "tabular text-right",
                      p.totalMargin.isNegative() && "text-red-700"
                    )}
                  >
                    {money(p.totalMargin)}
                  </td>
                  <td className={cn(TD, "tabular text-right")}>{gmPct(p.totalMargin, p.totalL)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td className={TD}>Total</td>
                <td className={cn(TD, "tabular text-right")}>{money(aggregates.billedTotal)}</td>
                <td className={cn(TD, "tabular text-right")}>{money(aggregates.costTotal)}</td>
                <td
                  className={cn(
                    TD,
                    "tabular text-right",
                    aggregates.marginTotal.isNegative() && "text-red-700"
                  )}
                >
                  {money(aggregates.marginTotal)}
                </td>
                <td className={cn(TD, "tabular text-right")}>
                  {gmPct(aggregates.marginTotal, aggregates.billedTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </Section>

        {/* ---- Billed bridge — only when a prior month is archived (spec §5).
             The TABLE is the canonical print form; no chart here. ---- */}
        {report.buckets !== null && report.prevPeriod !== null && (
          <Section label={`Billed bridge — ${report.prevPeriod} → ${period}`}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={TH}>Bucket</th>
                  <th className={cn(TH, "text-right")}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {report.buckets.map((b) => (
                  <tr key={b.key}>
                    <td className={TD}>{b.label}</td>
                    <td
                      className={cn(
                        TD,
                        "tabular text-right",
                        b.kind === "delta" &&
                          (b.amountCents >= 0 ? "text-emerald-700" : "text-red-700")
                      )}
                    >
                      {b.kind === "delta" && b.amountCents >= 0 ? "+" : ""}
                      {fmtCents(b.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Rate changes include the qty×rate cross term and any rounding residue, so the bridge
              ties exactly.
            </p>
          </Section>
        )}

        {/* ---- Credit tracker ---- */}
        <Section label="Coro credit tracker">
          {report.creditRows.length === 0 ? (
            <p className="text-sm text-slate-500">
              No expected Coro credits this month or in the archive.
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={TH}>Partner</th>
                  <th className={TH}>Month</th>
                  <th className={cn(TH, "text-right")}>Expected</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.creditRows.map((r) => (
                  <tr key={`${r.period}-${r.slug}`}>
                    <td className={cn(TD, "font-medium")}>{r.name}</td>
                    <td className={cn(TD, "tabular")}>{r.period}</td>
                    <td className={cn(TD, "tabular text-right")}>{moneyStr(r.expected)}</td>
                    <td className={TD}>
                      <span className="rounded-full border border-slate-300 px-2 py-0.5 text-[10.5px] text-slate-600">
                        {CREDIT_LABEL[r.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={2} className={cn(TD, "text-xs text-slate-600")}>
                    Running balance (status ≠ applied)
                  </td>
                  <td className={cn(TD, "tabular text-right")}>
                    {fmtCents(report.outstandingCents)}
                  </td>
                  <td className={TD} />
                </tr>
              </tfoot>
            </table>
          )}
        </Section>

        {/* ---- Findings digest ---- */}
        <Section label="Findings digest">
          {aggregates.findingsRows.length === 0 ? (
            <p className="text-sm text-slate-500">No findings this month.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={TH}>Kind</th>
                  <th className={TH}>Severity</th>
                  <th className={cn(TH, "text-right")}>Count</th>
                </tr>
              </thead>
              <tbody>
                {aggregates.findingsRows.map((r) => (
                  <tr key={`${r.kind}|${r.severity}`}>
                    <td className={cn(TD, "font-mono text-xs")}>{r.kind}</td>
                    <td className={cn(TD, r.severity === "block" && "font-semibold text-red-700")}>
                      {r.severity}
                    </td>
                    <td className={cn(TD, "tabular text-right")}>{r.count}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={2} className={TD}>
                    Total
                  </td>
                  <td className={cn(TD, "tabular text-right")}>{model.findings.length}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Section>

        {/* ---- Audit footer ---- */}
        <footer className="break-inside-avoid border-t border-slate-300 pt-3 text-[11px] leading-relaxed text-slate-500">
          <div className="tabular">
            Files — pricing {fp.pricing} · usage {fp.usage} ·{" "}
            {fp.invoice !== undefined ? `invoice ${fp.invoice}` : "no Coro invoice loaded"}
          </div>
          <div className="tabular">
            Confirmed-rates revision {report.curr.ratesRevision} · generated {generatedAt}
          </div>
          <div className="mt-1">
            MSP Hub, LLC — internal close document. Every figure traces to the draft invoices;
            held lines are never invented into totals.
          </div>
        </footer>
      </div>
    </div>
  );
}
