/**
 * Browser-safe pipeline runner.
 *
 * Runs the REAL Coro billing pipeline (the exact same modules the CLI and tests use)
 * entirely in the browser over the loudly-labeled SYNTHETIC fixtures. It imports only
 * the pure modules — never the fs-bound CsvQuickBooksAdapter or the CLI — so nothing
 * here touches Node. When real files eventually land in data/, this same code path
 * would run against them; the dashboard is an honest window onto the pipeline, not a
 * reimplementation of it.
 *
 * NOTHING is faked: H/L come from the synthetic rate card, the reconciliation is the
 * real reconcileAgainstLindita, and the CSV is the real toQuickBooksCsv output.
 */
import { parseUsage } from "@pipeline/ingest/usage.js";
import { parseRateCard } from "@pipeline/ingest/rateCard.js";
import { parseLinditaWorkbook } from "@pipeline/ingest/lindita.js";
import { buildRateCard } from "@pipeline/rating/rateCardIndex.js";
import { applyRates } from "@pipeline/rating/applyRates.js";
import { buildInvoices } from "@pipeline/invoicing/buildInvoices.js";
import { runChecks } from "@pipeline/reconcile/checks.js";
import { reconcileAgainstLindita } from "@pipeline/reconcile/august.js";
import { toQuickBooksCsv, toIif } from "@pipeline/export/quickbooks.js";
import { defaultConfig } from "@pipeline/config/pipeline.config.js";
import { isOk } from "@pipeline/lib/result.js";
import {
  buildConsistentTrio,
  buildDiscrepancyTrio,
  SYNTHETIC_BANNER,
  type SyntheticRow,
} from "@fixtures/synthetic/build.js";
import type {
  RatedLine,
  Exception,
  QbInvoice,
  CheckResult,
  DiscrepancyReport,
} from "@pipeline/domain/types.js";

export type DatasetKey = "consistent" | "discrepancy";

export interface DatasetMeta {
  readonly key: DatasetKey;
  readonly label: string;
  readonly blurb: string;
}

export const DATASETS: readonly DatasetMeta[] = [
  {
    key: "consistent",
    label: "Clean month",
    blurb: "A self-consistent close — the pipeline reproduces Lindita's workbook cent-exact (matched).",
  },
  {
    key: "discrepancy",
    label: "Month with issues",
    blurb:
      "The same close with two deliberate faults: a legacy $6-vs-$9 charge mismatch and an unpriced SKU (missing rate).",
  },
];

/** Everything the dashboard needs for one synthetic close. */
export interface DemoResult {
  readonly dataset: DatasetKey;
  readonly period: string;
  readonly seedRows: readonly SyntheticRow[];
  readonly rated: readonly RatedLine[];
  readonly exceptions: readonly Exception[];
  /** Billable invoices (blocking-exception lines held out — same as the CLI export). */
  readonly invoices: readonly QbInvoice[];
  /** Usage lines held out of the export because they carry a blocking exception. */
  readonly held: readonly RatedLine[];
  readonly checks: readonly CheckResult[];
  readonly report: DiscrepancyReport;
  readonly csv: string;
  readonly iif: string;
  /** Ingest problems, if any (should be none for the synthetic fixtures). */
  readonly ingestErrors: readonly string[];
}

export const BANNER = SYNTHETIC_BANNER;

/**
 * Run the whole pipeline for a dataset and return a fully-computed result.
 * Deterministic — the invoiceDate is injected (defaults to a fixed demo date), never
 * read from the clock, so the CSV/IIF are stable across renders.
 */
export function runDemo(dataset: DatasetKey, invoiceDate = "2026-09-01"): DemoResult {
  const trio = dataset === "discrepancy" ? buildDiscrepancyTrio("2026-08") : buildConsistentTrio("2026-08");
  const cfg = defaultConfig(trio.period);
  const ingestErrors: string[] = [];

  const usageRes = parseUsage(trio.usage, { period: trio.period });
  const rateRes = parseRateCard(trio.rateCard, { period: trio.period });
  const linditaRes = parseLinditaWorkbook(trio.lindita, { period: trio.period });

  if (!isOk(usageRes)) ingestErrors.push(`usage: ${usageRes.error.message}`);
  if (!isOk(rateRes)) ingestErrors.push(`rate card: ${rateRes.error.message}`);
  if (!isOk(linditaRes)) ingestErrors.push(`lindita: ${linditaRes.error.message}`);

  const usage = isOk(usageRes) ? usageRes.value : [];
  const rateEntries = isOk(rateRes) ? rateRes.value : [];
  const lindita = isOk(linditaRes) ? linditaRes.value : [];

  const rateCard = buildRateCard(rateEntries);
  const { rated, exceptions } = applyRates(usage, rateCard, cfg);

  // Mirror the CLI's honest export behavior: a line carrying a BLOCKING exception is
  // HELD out of the billable invoices and the QuickBooks export — never billed as a
  // $0 line for unpriced usage (README: "do not bill as if usage were zero"). We still
  // build the FULL invoice set for the reconciliation checks (so the child-rollup check
  // sees every line), exactly as the CLI does.
  const isBlocked = (r: RatedLine): boolean => r.exceptions.some((e) => e.severity === "block");
  const held = rated.filter(isBlocked);
  const billable = rated.filter((r) => !isBlocked(r));

  const fullInvoices = buildInvoices([...rated], trio.period);
  const invoices = buildInvoices([...billable], trio.period); // shown + exported
  const checks = runChecks({ rated: [...rated], invoices: fullInvoices, usage, coroInvoices: undefined });
  const report = reconcileAgainstLindita([...rated], lindita, cfg);

  const exportOpts = { invoiceDate, termsDays: 30 };
  const csv = toQuickBooksCsv([...invoices], exportOpts);
  const iif = toIif([...invoices], exportOpts);

  return {
    dataset,
    period: trio.period,
    seedRows: trio.rows,
    rated,
    exceptions,
    invoices,
    held,
    checks,
    report,
    csv,
    iif,
    ingestErrors,
  };
}

/** Trigger a browser download of a text artifact (the "clean export Lindita can post"). */
export function downloadText(filename: string, contents: string, mime = "text/csv"): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
