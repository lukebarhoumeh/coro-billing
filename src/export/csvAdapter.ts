/**
 * CsvQuickBooksAdapter — the filesystem-bound QuickBooks adapter.
 *
 * Split out of quickbooks.ts so the pure renderers (toQuickBooksCsv / toIif) and the
 * ApiQuickBooksAdapter stub stay browser-importable: this file is the ONLY module in
 * export/ that touches node:fs, so a browser bundle (the internal web dashboard) can
 * import the CSV renderer without pulling Node's fs in.
 *
 * It writes the "clean export Lindita can post" the ARCHITECTURE roadmap calls for,
 * and is one of the two places (with cli/) allowed filesystem side effects.
 */
import type { QbInvoice } from "../domain/types.js";
import { type QuickBooksAdapter, type QbExportOptions, toQuickBooksCsv } from "./quickbooks.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class CsvQuickBooksAdapter implements QuickBooksAdapter {
  private readonly outDir: string;
  private readonly opts?: QbExportOptions;

  /**
   * @param outDir directory the CSV is written into (created if missing).
   * @param opts   injected export dates (kept off the clock for determinism).
   */
  constructor(outDir: string, opts?: QbExportOptions) {
    this.outDir = outDir;
    this.opts = opts;
  }

  async createInvoices(invoices: QbInvoice[]): Promise<{ created: number; ids: string[] }> {
    const csv = toQuickBooksCsv(invoices, this.opts);
    // mkdir -p: create the (possibly nested) output directory.
    await mkdir(this.outDir, { recursive: true });

    // Deterministic filename from the invoices' period (falls back to "output").
    // No timestamp — same close writes the same filename, so re-runs overwrite
    // rather than pile up.
    const period = derivePeriod(invoices);
    const fileName = period ? `coro-invoices-${period}.csv` : "coro-invoices.csv";
    await writeFile(join(this.outDir, fileName), csv, "utf8");

    return { created: invoices.length, ids: [fileName] };
  }
}

/** The common period across the invoices, or "" if they disagree / list is empty. */
function derivePeriod(invoices: readonly QbInvoice[]): string {
  if (invoices.length === 0) return "";
  const first = invoices[0]!.period;
  return invoices.every((i) => i.period === first) ? first : "";
}
