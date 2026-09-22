/**
 * The MSP Hub invoice document — Luke's Mountain Credit Union template
 * (Q20260921-MCU-C) adapted from quotation to invoice:
 *   - navy masthead band + gold spine, meta strip, PREPARED FOR / BY cards,
 *     navy line-table header, notes-left/totals-right, navy TOTAL DUE band;
 *   - "Prepared by: MSP Hub Invoices · invoices@msphub.com" (address kept);
 *   - NO acceptance/signature blocks (invoice, not a quote);
 *   - the real MSPHUB wordmark (web/public/brand/msphub-logo.jpeg).
 *
 * This is a PAPER document: fixed light palette (navy #1B3A57, gold #B98A2F,
 * slate ink) independent of the app's dark theme, so screen and print are the
 * same artifact. Screen-only review columns (cost, GP) and annotations carry
 * print:hidden. Printing preserves the brand colors via print-color-adjust
 * (see index.css).
 */
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { DraftLine, Exception, ExceptionKind, PartnerDraft, Period } from "@pipeline/domain/types.js";
import { gmPct, money } from "@/lib/format";
import { cn } from "@/lib/cn";

const NAVY = "#1B3A57";
const GOLD = "#B98A2F";
/** Darker gold for small text on white (contrast). */
const GOLD_INK = "#8F6A1F";

const ANOMALY_LABELS: Partial<Record<ExceptionKind, string>> = {
  INVOICE_QTY_DISAGREES: "qty mismatch",
  INVOICE_RATE_UNEXPECTED: "rate anomaly",
  ASSUMED_MAPPING: "assumed rate",
  PRODUCT_FALLBACK: "fallback rate",
  CLIENT_PRICE_DIFFERS: "team billed differently",
};

function anomalyLabels(findings: readonly Exception[]): string[] {
  const out: string[] = [];
  for (const f of findings) {
    const label = ANOMALY_LABELS[f.kind];
    if (label !== undefined && !out.includes(label)) out.push(label);
  }
  return out;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "2026-08" → { label: "Aug 1, 2026 – Aug 31, 2026", short: "8/1/26 – 8/31/26" } */
function monthRange(period: Period): { label: string; short: string } {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return { label: period, short: period };
  const last = new Date(y, m, 0).getDate();
  const mon = MONTHS[m - 1]!;
  const yy = String(y).slice(2);
  return {
    label: `${mon} 1, ${y} – ${mon} ${last}, ${y}`,
    short: `${m}/1/${yy} – ${m}/${last}/${yy}`,
  };
}

function Meta({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div>
      <div className="text-[0.625rem] font-medium uppercase tracking-[0.18em] text-white/60">
        {label}
      </div>
      <div className={cn("mt-0.5 text-sm font-semibold", gold ? "text-[#E4B85C]" : "text-white")}>
        {value}
      </div>
    </div>
  );
}

/** Microcaps caption on paper. */
function PaperLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[0.625rem] font-medium uppercase tracking-[0.18em] text-slate-400">
      {children}
    </div>
  );
}

function LineRow({ line, service }: { line: DraftLine; service: string }) {
  const [expanded, setExpanded] = useState(false);
  const nfr = line.matchKind === "nfr";
  const held = !nfr && line.unitL === null;
  const zeroUsage = !nfr && !held && line.quantity === 0;
  const badges = anomalyLabels(line.findings);
  const marginNegative = line.margin !== null && line.margin.isNegative();
  const heldReason =
    line.findings.find((f) => f.kind === "MISSING_RATE" || f.kind === "UNKNOWN_PRODUCT_CODE")
      ?.message ?? "no rate on the card";

  return (
    <>
      <tr
        className={cn(
          "border-b border-slate-200",
          held && "bg-amber-50",
          (nfr || zeroUsage) && "opacity-60"
        )}
      >
        <td className="px-3 py-3 text-right align-top">
          <span className="tabular text-base font-bold" style={{ color: GOLD }}>
            {line.quantity.toLocaleString()}
          </span>
          {line.invoiceQuantity !== null && line.invoiceQuantity !== line.quantity && (
            <div className="text-[11px] text-amber-700 print:hidden">
              inv {line.invoiceQuantity.toLocaleString()}
            </div>
          )}
        </td>
        <td className="px-3 py-3 align-top">
          <div className="text-sm font-semibold text-slate-800">{line.productLabel}</div>
          <div className="font-mono text-[11px] text-slate-500">{line.vendorSku}</div>
          <div className="text-[11px] font-medium" style={{ color: GOLD_INK }}>
            Service: {service}
          </div>
          {(badges.length > 0 || line.customers.length > 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 print:hidden">
              {badges.map((label) => (
                <span
                  key={label}
                  className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                >
                  {label}
                </span>
              ))}
              {line.customers.length > 0 && (
                <button
                  data-testid={`toggle-customers-${line.vendorSku}`}
                  className="inline-flex items-center gap-0.5 text-[11px] text-slate-500 hover:text-slate-800"
                  onClick={() => setExpanded((v) => !v)}
                >
                  <ChevronRight
                    className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")}
                  />
                  {line.customers.length} customer{line.customers.length === 1 ? "" : "s"}
                </button>
              )}
            </div>
          )}
        </td>
        <td className="tabular px-3 py-3 text-right align-top text-sm text-slate-700">
          {line.unitL !== null ? money(line.unitL) : <span className="text-slate-400">—</span>}
          {line.teamClientPrice !== null &&
            line.unitL !== null &&
            !line.teamClientPrice.equalsCents(line.unitL) && (
              <div
                className="text-[11px] text-amber-700 print:hidden"
                title="The accounting team's workbook (Client Price column) bills this at a different rate than the special-pricing card. The draft uses the card; if the workbook price is the negotiated one, the card needs updating."
              >
                team {money(line.teamClientPrice)}
              </div>
            )}
        </td>
        <td className="tabular px-3 py-3 text-right align-top text-sm">
          {nfr ? (
            <span className="text-[11px] text-slate-500">not billed</span>
          ) : held ? (
            <div className="text-amber-800">
              <div className="text-[11px] font-semibold">HELD — {heldReason}</div>
              <div className="text-[11px]">excluded from total</div>
              {line.teamClientPrice !== null && (
                <div className="text-[11px] print:hidden">
                  team billed {money(line.teamClientPrice)}/unit in the manual workbook
                </div>
              )}
              <div className="text-[11px] text-slate-500 print:hidden">
                Fix: ask Coro billing to add this product to the partner's special pricing sheet.
              </div>
            </div>
          ) : zeroUsage ? (
            <span className="text-[11px] text-slate-500">no usage this month</span>
          ) : line.amountL !== null ? (
            <span className="font-bold text-slate-900">{money(line.amountL)}</span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="tabular px-3 py-3 text-right align-top text-sm text-slate-600 print:hidden">
          {(() => {
            const primary = line.actualHUnit ?? line.expectedHAdditive;
            if (primary === null) return <span className="text-slate-400">—</span>;
            const caption =
              line.actualHUnit !== null ? "actual (Coro invoice)" : "expected (additive)";
            const sheetNote =
              line.expectedHSheet !== null &&
              line.expectedHAdditive !== null &&
              !line.expectedHSheet.equalsCents(line.expectedHAdditive)
                ? money(line.expectedHSheet)
                : null;
            return (
              <div>
                <div>{money(primary)}</div>
                <div className="text-[11px] text-slate-400">{caption}</div>
                {sheetNote !== null && (
                  <div className="text-[11px] text-slate-400">sheet {sheetNote}</div>
                )}
              </div>
            );
          })()}
        </td>
        <td className="tabular px-3 py-3 text-right align-top text-sm print:hidden">
          {line.margin !== null ? (
            <div>
              <div className={marginNegative ? "text-red-600" : "text-emerald-700"}>
                {money(line.margin)}
              </div>
              <div className="text-[11px] text-slate-400">GM {gmPct(line.margin, line.amountL)}</div>
            </div>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
      </tr>
      {line.customers.length > 0 && (
        // Collapsed on screen until toggled; ALWAYS rendered in print — the MSP
        // wants the by-customer detail on the paper invoice.
        <tr className={cn("border-b border-slate-200 bg-slate-50", !expanded && "hidden print:table-row")}>
          <td />
          <td colSpan={5} className="px-3 py-2">
            <PaperLabel>By customer</PaperLabel>
            <div className="mt-1 max-w-md text-[11px] text-slate-600">
              {line.customers.map((c) => (
                <div
                  key={c.customer ?? "partner-workspace"}
                  className="flex justify-between gap-6 border-b border-slate-100 py-0.5 last:border-0"
                >
                  <span className={c.customer === null ? "italic text-slate-400" : undefined}>
                    {c.customer ?? "partner workspace"}
                  </span>
                  <span className="tabular">{c.quantity.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function InvoiceDoc({
  draft,
  period,
  invoiceNo,
  approved,
  demo,
}: {
  draft: PartnerDraft;
  period: Period;
  invoiceNo: string;
  approved: boolean;
  demo: boolean;
}) {
  const { contactName, contactEmail, address } = draft.contact;
  const service = monthRange(period);
  const today = new Date().toLocaleDateString("en-US");
  const negative = draft.totalMargin.isNegative();

  return (
    <div className="print-invoice overflow-hidden rounded-xl bg-white shadow-ledger-lift">
      <div className="border-l-[6px]" style={{ borderColor: GOLD }}>
        {/* ---- Navy masthead ---- */}
        <div className="px-7 pb-5 pt-6 md:px-9" style={{ backgroundColor: NAVY }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <span className="inline-flex items-center rounded-md bg-white px-3 py-2.5 shadow-sm">
              <img src="/brand/msphub-logo.jpeg" alt="MSP Hub" className="h-5 w-auto md:h-6" />
            </span>
            <div className="text-right">
              <div className="flex items-center justify-end gap-2">
                {!approved && (
                  <span className="rounded border border-white/40 px-2 py-0.5 text-[11px] font-semibold tracking-[0.15em] text-white/80">
                    DRAFT
                  </span>
                )}
                {demo && (
                  <span className="rounded border border-amber-300/60 bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold tracking-[0.15em] text-amber-200">
                    SYNTHETIC
                  </span>
                )}
                <span className="font-display text-3xl font-semibold tracking-[0.12em] text-white">
                  INVOICE
                </span>
              </div>
              <div className="mt-1 font-mono text-xs tracking-[0.2em] text-white/60">
                {invoiceNo}
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-10 gap-y-3 border-t border-white/15 pt-4">
            <Meta label="Date" value={today} />
            <Meta label="Invoice #" value={invoiceNo} />
            <Meta label="Due date" value={today} gold />
            <Meta label="Terms" value="Due on receipt" />
            <Meta label="Currency" value="USD" />
          </div>
        </div>

        {/* ---- Body ---- */}
        <div className="px-7 py-7 md:px-9">
          {/* Prepared for / by */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-r-md border-l-4 bg-slate-50 p-4" style={{ borderColor: GOLD }}>
              <PaperLabel>Prepared for</PaperLabel>
              <div className="mt-1.5 text-base font-bold text-slate-900">{draft.cardName}</div>
              <div className="mt-0.5 space-y-0.5 text-sm text-slate-600">
                {contactName !== null && <div>{contactName}</div>}
                {address !== null && <div>{address}</div>}
                {contactEmail !== null && <div className="text-sky-700">{contactEmail}</div>}
                <div className="font-mono text-[11px] text-slate-400">{draft.slug}</div>
              </div>
            </div>
            <div className="rounded-r-md border-l-4 bg-slate-50 p-4" style={{ borderColor: NAVY }}>
              <PaperLabel>Prepared by</PaperLabel>
              <div className="mt-1.5 text-base font-bold text-slate-900">MSP Hub Invoices</div>
              <div className="mt-0.5 space-y-0.5 text-sm text-slate-600">
                <div>MSP Hub, LLC · 11231 US Highway 1 #356</div>
                <div>North Palm Beach, FL 33408</div>
                <div className="text-sky-700">invoices@msphub.com</div>
              </div>
            </div>
          </div>

          {/* Line table */}
          <table className="mt-6 w-full border-collapse">
            <thead>
              <tr className="text-[0.625rem] font-medium uppercase tracking-[0.18em] text-white" style={{ backgroundColor: NAVY }}>
                <th className="w-16 px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5 text-left">Description</th>
                <th className="px-3 py-2.5 text-right">Unit price</th>
                <th className="px-3 py-2.5 text-right">Extended</th>
                <th className="px-3 py-2.5 text-right print:hidden">Cost / unit</th>
                <th className="px-3 py-2.5 text-right print:hidden">GP</th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line) => (
                <LineRow key={line.vendorSku} line={line} service={service.label} />
              ))}
            </tbody>
          </table>

          {/* Notes + totals */}
          <div className="mt-7 grid gap-6 md:grid-cols-[1fr_20rem]">
            <div className="space-y-3 text-xs leading-relaxed text-slate-500">
              <p>
                All amounts are in USD. Sales tax will be applied at time of invoice, if
                applicable.
              </p>
              <p>
                <span className="font-semibold text-slate-700">Service period.</span> All lines
                cover {service.label} per the Coro usage report for this month.
              </p>
              {draft.heldLines > 0 && (
                <p className="text-amber-800">
                  <span className="font-semibold">Held lines.</span> {draft.heldLines} line
                  {draft.heldLines === 1 ? "" : "s"} with consumption but no contracted rate{" "}
                  {draft.heldLines === 1 ? "is" : "are"} excluded from this invoice and will be
                  billed once pricing is confirmed.
                </p>
              )}
            </div>
            <div>
              <div className="flex justify-between border-b border-slate-200 px-4 py-2.5 text-sm">
                <span className="text-slate-600">Subtotal</span>
                <span className="tabular font-bold text-slate-900">{money(draft.totalL)}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 px-4 py-2.5 text-sm">
                <span className="text-slate-600">Sales Tax (0.0%)</span>
                <span className="tabular font-bold text-slate-900">$0.00</span>
              </div>
              <div className="flex items-stretch text-white" style={{ backgroundColor: NAVY }}>
                <div className="flex-1 border-r border-white/15 px-4 py-3">
                  <div className="text-[0.625rem] font-medium uppercase tracking-[0.18em] text-white/60">
                    Service period
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-[#E4B85C]">{service.short}</div>
                </div>
                <div className="px-4 py-3 text-right">
                  <div className="text-[0.625rem] font-medium uppercase tracking-[0.18em] text-white/60">
                    Monthly total
                  </div>
                  <div className="tabular mt-0.5 text-sm font-semibold">{money(draft.totalL)}</div>
                </div>
              </div>
              <div
                className="mt-1 flex items-center justify-between px-4 py-3.5 text-white"
                style={{ backgroundColor: NAVY }}
              >
                <span className="text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-white/70">
                  Total due
                </span>
                <span className="figure tabular text-2xl font-semibold">{money(draft.totalL)}</span>
              </div>
              {/* Screen-only margin readout — never printed, never sent. */}
              <div className="mt-3 space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 print:hidden">
                <div className="flex justify-between">
                  <span>Expected cost (additive rule)</span>
                  <span className="tabular">{money(draft.totalHExpected)}</span>
                </div>
                {draft.totalHActual !== null && (
                  <div className="flex justify-between">
                    <span>Actual cost (Coro invoice)</span>
                    <span className="tabular">{money(draft.totalHActual)}</span>
                  </div>
                )}
                <div className="flex justify-between font-medium">
                  <span>Gross profit (GP)</span>
                  <span className={cn("tabular", negative ? "text-red-600" : "text-emerald-700")}>
                    {money(draft.totalMargin)}
                  </span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Gross margin (GM)</span>
                  <span className={cn("tabular", negative ? "text-red-600" : "text-emerald-700")}>
                    {gmPct(draft.totalMargin, draft.totalL)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ---- Footer ---- */}
        <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 px-7 py-3 text-[11px] text-slate-400 md:px-9">
          <span>MSP Hub, LLC · 11231 US Highway 1 #356, North Palm Beach, FL 33408</span>
          <span>Invoice {invoiceNo}</span>
        </div>
      </div>
    </div>
  );
}
