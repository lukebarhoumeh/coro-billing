#!/usr/bin/env node
/**
 * Coro billing CLI — the one place clock reads and filesystem writes live.
 *
 * Wires the pure pipeline (ingest → rating → invoicing → reconcile → export) that
 * lives behind `src/index.ts`. Dane's perfect-world pipeline (README): "We get a
 * usage report from Coro, we plug it into this, it plugs the output into
 * QuickBooks. And Lindita has her invoices." That is what `run`/`reconcile`/
 * `export` do here.
 *
 * Commands (docs/ARCHITECTURE.md §"src/cli/index.ts"):
 *   run       --data <dir> --month YYYY-MM [--out out/]
 *             ingest all present files → applyRates → buildInvoices → print an
 *             exception summary → write the QuickBooks CSV to out/.
 *   reconcile --data <dir> --month YYYY-MM
 *             also parse Lindita's workbook and print the DiscrepancyReport (the
 *             acceptance test).
 *   export    --data <dir> --month YYYY-MM --format csv|iif [--out out/]
 *
 * Robustness: missing files are SKIPPED WITH A WARNING (the pipeline still runs on
 * what is present) — the CLI must not crash a close because one optional file is
 * absent. It never fabricates data.
 *
 * Determinism boundary: this module is the only place `Date` and fs writes are
 * allowed (ARCHITECTURE "Coding standards"). Dates are computed here and INJECTED
 * into the otherwise-pure export functions.
 */
import { Command } from "commander";
import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type { WorkbookInput } from "../index.js";

import {
  parseUsage,
  parseRateCard,
  parseLinditaWorkbook,
  parseMsrp,
  parseCoroInvoice,
  reduceUsage,
  closeFromInvoice,
  buildRateCard,
  applyRates,
  buildInvoices,
  runChecks,
  reconcileAgainstLindita,
  toQuickBooksCsv,
  toIif,
  defaultConfig,
  isOk,
  Money,
} from "../index.js";
import type { CloseReport } from "../index.js";
import type {
  CoroInvoiceLine,
  DiscrepancyReport,
  Exception,
  LinditaLine,
  PipelineConfig,
  QbInvoice,
  RateCardEntry,
  RatedLine,
  UsageLine,
} from "../index.js";

// ---------------------------------------------------------------------------
// File discovery — match known packet files by filename (README source table).
// ---------------------------------------------------------------------------

/** All `.xlsx` files directly under `dir` (non-recursive), sorted for determinism. */
function xlsxFilesIn(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith("~$")) // skip Excel lock files
    .sort()
    .map((f) => join(dir, f));
}

/** First file whose basename matches the pattern, or null. */
function findFile(files: readonly string[], pattern: RegExp): string | null {
  return files.find((f) => pattern.test(baseName(f))) ?? null;
}

/** All files whose basename matches the pattern (e.g. the two Coro invoices). */
function findAll(files: readonly string[], pattern: RegExp): string[] {
  return files.filter((f) => pattern.test(baseName(f)));
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/**
 * Read a workbook file into an in-memory buffer WorkbookInput.
 *
 * The CLI is the fs boundary, so it reads bytes here and hands the parsers a
 * `{ buffer }` rather than a `{ path }`. This keeps the parsers pure (no fs) and
 * side-steps the ESM `XLSX.readFile` binding (which needs a wired-up fs backend);
 * `loadWorkbook` reads buffers with `XLSX.read`, which works everywhere.
 */
function workbookFrom(path: string): WorkbookInput {
  return { buffer: readFileSync(path) };
}

/** Filename heuristics grounded in the README "Source files" table. */
const PATTERNS = {
  usage: /usage/i,
  rateCard: /(special\s*pricing|rate\s*card|pricing)/i,
  lindita: /(lindit|lita|manual|billing)/i,
  msrp: /msrp/i,
  coroInvoice: /(coro[_-]?invoice|invcus|invoice)/i,
} as const;

/** Extract a Coro invoice number from a filename (e.g. "...0001914..." → "1914"). */
function invoiceNumberFromName(path: string): string | undefined {
  const m = /INVCUS\d{4}-?0*([0-9]+)/i.exec(baseName(path)) ?? /(\d{3,})/.exec(baseName(path));
  return m?.[1];
}

// ---------------------------------------------------------------------------
// Ingest orchestration (shared by all three commands)
// ---------------------------------------------------------------------------

interface IngestedPacket {
  readonly usage: UsageLine[];
  readonly rateCardEntries: RateCardEntry[];
  readonly lindita: LinditaLine[] | null;
  readonly coroInvoices: CoroInvoiceLine[];
  readonly warnings: string[];
}

/**
 * Ingest every present file in the data dir. Missing OPTIONAL files are skipped
 * with a warning. Usage and the rate card are required to price anything; if usage
 * is missing we still return an empty packet (with a loud warning) rather than
 * crash — but a caller that needs to price will see zero rated lines.
 */
function ingestPacket(dataDir: string, cfg: PipelineConfig, wantLindita: boolean): IngestedPacket {
  const warnings: string[] = [];
  const files = xlsxFilesIn(dataDir);

  if (files.length === 0) {
    warnings.push(`no .xlsx files found in ${dataDir} — nothing to ingest`);
  }

  // --- Usage (the driver) ---
  let usage: UsageLine[] = [];
  const usageFile = findFile(files, PATTERNS.usage);
  if (!usageFile) {
    // README operating cadence: "If usage is late: do not bill as if usage were
    // zero." We warn loudly; the caller decides what to do with an empty close.
    warnings.push(
      "usage file not found — do NOT bill as if usage were zero (README). Skipping pricing."
    );
  } else {
    const r = parseUsage(workbookFrom(usageFile), { period: cfg.period });
    if (isOk(r)) usage = r.value;
    else warnings.push(`failed to parse usage (${baseName(usageFile)}): ${r.error.message}`);
  }

  // --- Rate card (special pricing: current + legacy tabs) ---
  // Exclude the MSRP file explicitly: "Copy of 2607-MSRP Pricing.xlsx" also matches the
  // rateCard pattern (…"pricing"), and MSRP is NEVER the rate card (it has no partner or
  // MSP-price column). Picking it would silently hide the real special-pricing file.
  let rateCardEntries: RateCardEntry[] = [];
  const rateFile = findFile(
    files.filter((f) => !PATTERNS.msrp.test(baseName(f))),
    PATTERNS.rateCard
  );
  if (!rateFile) {
    warnings.push(
      "special-pricing/rate-card file not found — every priced line will flag " +
        "MISSING_RATE_CARD_ROW (rates are never invented). Waiting on Jack's export."
    );
  } else {
    const r = parseRateCard(workbookFrom(rateFile), { period: cfg.period });
    if (isOk(r)) {
      rateCardEntries = r.value;
      if (rateCardEntries.length === 0) {
        // A file matched but yielded no partner+price rows — almost certainly the wrong
        // file (e.g. MSRP) rather than "Jack's rates haven't landed". Say so distinctly
        // so the operator is not misled into waiting for a file that is already present.
        warnings.push(
          `matched "${baseName(rateFile)}" as the rate card but it produced ZERO ` +
            `partner+price rows — is this actually MSRP or the wrong file? ` +
            `Every priced line will flag MISSING_RATE_CARD_ROW until a real special-pricing file is present.`
        );
      }
    } else {
      warnings.push(`failed to parse rate card (${baseName(rateFile)}): ${r.error.message}`);
    }
  }

  // --- Lindita's workbook (recreation target) — only for reconcile ---
  let lindita: LinditaLine[] | null = null;
  if (wantLindita) {
    // Prefer a file that looks like Lindita's manual workbook, but never the
    // usage/rate-card/MSRP/Coro-invoice files (avoid mis-selecting "billing" in
    // an unrelated name). We exclude those explicitly.
    const candidates = files.filter(
      (f) =>
        !PATTERNS.usage.test(baseName(f)) &&
        !PATTERNS.rateCard.test(baseName(f)) &&
        !PATTERNS.msrp.test(baseName(f)) &&
        !PATTERNS.coroInvoice.test(baseName(f))
    );
    const linditaFile = findFile(candidates, PATTERNS.lindita);
    if (!linditaFile) {
      warnings.push(
        "Lindita's manual workbook not found — cannot run the August recreation " +
          "(the acceptance test). Drop it into the data dir."
      );
    } else {
      const r = parseLinditaWorkbook(workbookFrom(linditaFile), { period: cfg.period });
      if (isOk(r)) lindita = r.value;
      else warnings.push(`failed to parse Lindita workbook (${baseName(linditaFile)}): ${r.error.message}`);
    }
  }

  // --- MSRP (reference only; parsed to validate presence, never used as cost) ---
  const msrpFile = findFile(files, PATTERNS.msrp);
  if (msrpFile) {
    const r = parseMsrp(workbookFrom(msrpFile));
    if (!isOk(r)) warnings.push(`failed to parse MSRP (${baseName(msrpFile)}): ${r.error.message}`);
    // MSRP is never Hub cost — we do not attach it to rating. Presence check only.
  }

  // --- Coro invoices (two stay two — never merged) ---
  const coroInvoices: CoroInvoiceLine[] = [];
  const invoiceFiles = findAll(files, PATTERNS.coroInvoice).filter(
    (f) => !PATTERNS.usage.test(baseName(f)) && !PATTERNS.rateCard.test(baseName(f))
  );
  for (const f of invoiceFiles) {
    const r = parseCoroInvoice(
      workbookFrom(f),
      { invoiceNumber: invoiceNumberFromName(f), period: cfg.period }
    );
    if (isOk(r)) coroInvoices.push(...r.value);
    else warnings.push(`failed to parse Coro invoice (${baseName(f)}): ${r.error.message}`);
  }

  return { usage, rateCardEntries, lindita, coroInvoices, warnings };
}

// ---------------------------------------------------------------------------
// Printing helpers (stdout only; no business logic)
// ---------------------------------------------------------------------------

function printWarnings(warnings: readonly string[]): void {
  for (const w of warnings) process.stderr.write(`WARN: ${w}\n`);
}

/** Print a compact exception summary grouped by kind + severity (Dane wants exceptions surfaced, not every SKU). */
function printExceptionSummary(exceptions: readonly Exception[]): void {
  if (exceptions.length === 0) {
    process.stdout.write("Exceptions: none — every usage line priced cleanly.\n");
    return;
  }
  const byKind = new Map<string, { severity: string; count: number }>();
  for (const e of exceptions) {
    const cur = byKind.get(e.kind);
    if (cur) cur.count += 1;
    else byKind.set(e.kind, { severity: e.severity, count: 1 });
  }
  process.stdout.write(`Exceptions: ${exceptions.length} (accounting accepts / reclasses / holds — never silently fixed)\n`);
  for (const [kind, { severity, count }] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    process.stdout.write(`  - ${kind} [${severity}]: ${count}\n`);
  }
}

/** Print the per-partner invoice summary (broken down by customer). */
function printInvoiceSummary(invoices: readonly QbInvoice[]): void {
  process.stdout.write(`Invoices: ${invoices.length} (one per MSP partner)\n`);
  for (const inv of invoices) {
    process.stdout.write(
      `  ${inv.partner} — ${inv.lines.length} line(s), ` +
        `charge $${inv.subtotalCharge.toFixed2()}, cost $${inv.subtotalCost.toFixed2()}, ` +
        `margin $${inv.margin.toFixed2()}\n`
    );
  }
}

/** Print the DiscrepancyReport (the acceptance test result). */
function printDiscrepancyReport(report: DiscrepancyReport): void {
  process.stdout.write(`\nAugust recreation vs Lindita (${report.period}):\n`);
  process.stdout.write(`  matched: ${report.matched ? "YES — ties cent-exact" : "NO"}\n`);
  // Signed variance (ours − Lindita): direction matters to accounting. A positive
  // number means we billed MORE than Lindita; negative means we billed LESS (e.g. the
  // $6-vs-$9 legacy case leaves us UNDER). The absolute cent diff is shown alongside.
  const signed = report.totalOurs.sub(report.totalLindita);
  const absCents = report.totalOurs.centsDiff(report.totalLindita).toCents();
  const direction = signed.isZero() ? "even" : signed.isNegative() ? "ours UNDER Lindita" : "ours OVER Lindita";
  process.stdout.write(
    `  totals: ours $${report.totalOurs.toFixed2()} vs Lindita $${report.totalLindita.toFixed2()} ` +
      `(variance $${signed.toFixed2()} — ${direction}; ${absCents} cents)\n`
  );
  process.stdout.write(`  discrepancies: ${report.discrepancies.length}\n`);
  for (const d of report.discrepancies) {
    const where = `${d.partner}/${d.customer ?? "(partner-level)"}/${d.sku}`;
    const explanation = d.explanation ? `  [${d.explanation}]` : "";
    process.stdout.write(`    - ${where} ${d.field}: ours=${d.ours} vs lindita=${d.lindita}${explanation}\n`);
  }
  process.stdout.write(`  only in ours: ${report.onlyInOurs.length}; only in Lindita: ${report.onlyInLindita.length}\n`);
}

// ---------------------------------------------------------------------------
// Date injection (the only clock read in the whole codebase)
// ---------------------------------------------------------------------------

/** Today as YYYY-MM-DD (UTC). This is the sole wall-clock read, at the CLI boundary. */
function todayIso(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString().padStart(4, "0");
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Shared: run the pure pipeline to rated lines + invoices for a given data dir.
// ---------------------------------------------------------------------------

interface PricedClose {
  readonly rated: RatedLine[];
  readonly invoices: QbInvoice[];
  readonly exceptions: readonly Exception[];
  readonly packet: IngestedPacket;
}

function priceClose(dataDir: string, cfg: PipelineConfig, wantLindita: boolean): PricedClose {
  const packet = ingestPacket(dataDir, cfg, wantLindita);
  const rateCard = buildRateCard(packet.rateCardEntries);
  const { rated, exceptions } = applyRates(packet.usage, rateCard, cfg);
  const invoices = buildInvoices([...rated], cfg.period);
  return { rated: [...rated], invoices, exceptions, packet };
}

/**
 * Split rated lines into billable vs held. A line carrying any BLOCK-severity
 * exception (missing rate row, missing H/L, unclassifiable SKU) must NOT be posted to
 * QuickBooks — otherwise we would bill a $0 line for unpriced usage, understating the
 * bill (README: "do not bill as if usage were zero"; the system flags, it never
 * silently fixes). Held lines are reported and written to a separate held file.
 */
function splitBlocking(rated: readonly RatedLine[]): { billable: RatedLine[]; held: RatedLine[] } {
  const billable: RatedLine[] = [];
  const held: RatedLine[] = [];
  for (const r of rated) {
    if (r.exceptions.some((e) => e.severity === "block")) held.push(r);
    else billable.push(r);
  }
  return { billable, held };
}

/** Minimal CSV cell quoting (RFC 4180) for the held report. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A held-lines report: what was NOT exported and why (for accounting to accept/reclass/hold). */
function heldReportCsv(held: readonly RatedLine[]): string {
  const rows: string[] = ["Partner,Customer,SKU,Quantity,BlockingReasons,SourceRow"];
  for (const r of held) {
    const reasons = r.exceptions
      .filter((e) => e.severity === "block")
      .map((e) => e.kind)
      .join("; ");
    rows.push(
      [
        r.partner,
        r.customer ?? "(partner-level)",
        r.sku.vendorSku,
        String(r.quantity),
        reasons,
        String(r.sourceRow),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return rows.join("\r\n") + "\r\n";
}

/**
 * Run the reconciliation checks and print a summary. Returns the number of FAILING
 * checks so the caller can set a non-zero exit. Reports the coro-invoice-vs-cost check
 * as SKIPPED (not silently absent) when no Coro invoice files were present, so an
 * operator never mistakes "4 run" for full coverage.
 */
function runAndPrintChecks(close: PricedClose): number {
  const hasCoro = close.packet.coroInvoices.length > 0;
  const checks = runChecks({
    rated: close.rated,
    invoices: close.invoices,
    coroInvoices: hasCoro ? close.packet.coroInvoices : undefined,
    usage: close.packet.usage,
  });
  const failed = checks.filter((c) => c.status !== "pass");
  const skippedNote = hasCoro ? "" : ", 1 skipped (coro-invoice-vs-cost: no Coro invoice files present)";
  process.stdout.write(`Checks: ${checks.length} run, ${failed.length} failing${skippedNote}.\n`);
  for (const c of failed) process.stdout.write(`  - ${c.title}: ${c.detail}\n`);
  return failed.length;
}

/**
 * Build billable invoices (held lines excluded), write them in the requested format,
 * and write a held report when any line was held. Returns counts so the caller can set
 * the exit code. Dates are injected (never read from the clock inside export).
 */
function exportBillable(
  close: PricedClose,
  cfg: PipelineConfig,
  outDir: string,
  format: "csv" | "iif",
  dates: { invoiceDate: string; dueDate?: string }
): { heldCount: number; outFile: string; heldFile?: string } {
  const { billable, held } = splitBlocking(close.rated);
  const invoices = buildInvoices([...billable], cfg.period);
  printInvoiceSummary(invoices);

  mkdirSync(outDir, { recursive: true });
  const exportOpts = { invoiceDate: dates.invoiceDate, dueDate: dates.dueDate, termsDays: 30 };

  let outFile: string;
  if (format === "iif") {
    outFile = join(outDir, `coro-invoices-${cfg.period}.iif`);
    writeFileSync(outFile, toIif([...invoices], exportOpts), "utf8");
    process.stdout.write(`Wrote QuickBooks Desktop IIF: ${outFile}\n`);
  } else {
    outFile = join(outDir, `coro-invoices-${cfg.period}.csv`);
    writeFileSync(outFile, toQuickBooksCsv([...invoices], exportOpts), "utf8");
    process.stdout.write(`Wrote QuickBooks CSV: ${outFile}\n`);
  }

  let heldFile: string | undefined;
  if (held.length > 0) {
    heldFile = join(outDir, `coro-held-${cfg.period}.csv`);
    writeFileSync(heldFile, heldReportCsv(held), "utf8");
    process.stdout.write(
      `HELD: ${held.length} usage line(s) had BLOCKING exceptions and were NOT exported ` +
        `(never post a $0 line). See ${heldFile}\n`
    );
  }
  return heldFile ? { heldCount: held.length, outFile, heldFile } : { heldCount: held.length, outFile };
}

/** Print the invoice-driven close report (the recreate-vs-invoice tie-out). */
function printCloseReport(report: CloseReport): void {
  const w = (s: string) => process.stdout.write(s + "\n");
  w(`\nInvoice-driven close — ${report.period} vs INVCUS2026-${report.invoiceNumber}:`);
  w(
    `  H tie: allocated $${report.allocatedH.toFixed2()} + out-of-period $${report.outOfPeriodH.toFixed2()}` +
      ` = $${report.allocatedH.add(report.outOfPeriodH).toFixed2()} vs invoice total $${report.invoiceTotalH.toFixed2()}` +
      ` — ${report.grandTieOk ? "TIES CENT-EXACT" : "DOES NOT TIE (do not bill)"}`
  );
  w(`  billable L (goes out to MSPs): $${report.billableL.toFixed2()}; held H (unresolved L): $${report.heldH.toFixed2()}`);

  const ties = report.lines.filter((l) => l.qtyTies).length;
  const withUsage = report.lines.filter((l) => l.usageQty !== null).length;
  w(
    `  lines: ${report.lines.length} partner×SKU (${withUsage} with usage detail, ` +
      `${ties} qty-tie exactly, ${report.lines.filter((l) => l.held).length} held)`
  );
  for (const l of report.lines) {
    const qty =
      l.usageQty === null
        ? `qty ${l.invoiceQty} (no usage detail)`
        : l.qtyTies
          ? `qty ${l.invoiceQty} ✓`
          : `qty invoice ${l.invoiceQty} vs usage ${l.usageQty} ⚠`;
    const money =
      `H $${l.hTotal.toFixed2()}` +
      (l.lTotal !== null ? `, L $${l.lTotal.toFixed2()}, margin $${l.margin!.toFixed2()}` : ", L UNRESOLVED — HELD");
    const flags = l.flags.length > 0 ? `  [${l.flags.join("; ")}]` : "";
    w(`    ${l.partner} / ${l.sku} (${l.skuClass}): ${qty}; ${money}${flags}`);
  }

  if (report.outOfPeriod.length > 0) {
    w(`  out-of-period lines EXCLUDED from this close (still in the invoice total):`);
    for (const o of report.outOfPeriod) {
      w(
        `    ${o.partner} / ${o.sku}: ${o.quantity} × → $${o.amount.toFixed2()} (${o.servicePeriod})` +
          (o.note ? ` — "${o.note}"` : "")
      );
    }
  }
  if (report.usageOnly.length > 0) {
    w(`  consumed per usage but NOT billed by Coro (raise with Coro; not billed to MSPs):`);
    for (const u of report.usageOnly) w(`    ${u.partner} / ${u.sku}: usage qty ${u.usageQty}`);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const program = new Command();
program
  .name("coro-billing")
  .description(
    "MSP Hub — Coro billing automation. Usage in → H (our cost) & L (partner price) " +
      "applied → per-customer breakdown → QuickBooks invoices."
  );

program
  .command("run")
  .description("ingest → applyRates → buildInvoices → exception summary → write QuickBooks CSV")
  .requiredOption("--data <dir>", "directory holding the Coro packet (.xlsx files)")
  .requiredOption("--month <YYYY-MM>", "accounting period, e.g. 2026-08")
  .option("--out <dir>", "output directory for the QuickBooks CSV", "out")
  .option("--invoice-date <YYYY-MM-DD>", "invoice date stamped on every invoice (default: today, UTC)")
  .option("--due-date <YYYY-MM-DD>", "explicit due date (default: invoice date + 30-day terms)")
  .action((opts: { data: string; month: string; out: string; invoiceDate?: string; dueDate?: string }) => {
    const cfg = defaultConfig(opts.month);
    const dataDir = resolve(opts.data);
    const outDir = resolve(opts.out);

    const close = priceClose(dataDir, cfg, false);
    printWarnings(close.packet.warnings);

    // Reconciliation checks (the README table) surfaced before export.
    const failedChecks = runAndPrintChecks(close);
    printExceptionSummary(close.exceptions);

    // Export only BILLABLE lines (held/blocking lines excluded, written to a held file).
    // Date is injected: --invoice-date makes a re-close byte-reproducible; default is today.
    const invoiceDate = opts.invoiceDate ?? todayIso();
    const { heldCount } = exportBillable(close, cfg, outDir, "csv", {
      invoiceDate,
      dueDate: opts.dueDate,
    });

    // Non-zero exit when the close is not clean: a failing check or a held (blocking)
    // line must be visible to CI/operators, never a silent success (do not bill $0).
    if (failedChecks > 0 || heldCount > 0) process.exitCode = 1;
  });

program
  .command("reconcile")
  .description("recreate the month vs Lindita's manual workbook and print the DiscrepancyReport (the acceptance test)")
  .requiredOption("--data <dir>", "directory holding the Coro packet + Lindita's workbook")
  .requiredOption("--month <YYYY-MM>", "accounting period, e.g. 2026-08")
  .action((opts: { data: string; month: string }) => {
    const cfg = defaultConfig(opts.month);
    const dataDir = resolve(opts.data);

    const close = priceClose(dataDir, cfg, true);
    printWarnings(close.packet.warnings);
    printExceptionSummary(close.exceptions);

    if (close.packet.lindita === null) {
      process.stderr.write(
        "Cannot reconcile: Lindita's manual workbook is missing. Drop it into the data dir " +
          "(README §3: recreate August vs Lindita is the acceptance test).\n"
      );
      process.exitCode = 1;
      return;
    }

    const report = reconcileAgainstLindita(close.rated, close.packet.lindita, cfg);
    printDiscrepancyReport(report);
    // A failed acceptance test is a non-zero exit so CI/operators notice.
    if (!report.matched) process.exitCode = 1;
  });

program
  .command("export")
  .description("ingest → price → write invoices in the requested QuickBooks format")
  .requiredOption("--data <dir>", "directory holding the Coro packet (.xlsx files)")
  .requiredOption("--month <YYYY-MM>", "accounting period, e.g. 2026-08")
  .requiredOption("--format <csv|iif>", "output format: csv (QBO import) or iif (QuickBooks Desktop)")
  .option("--out <dir>", "output directory", "out")
  .option("--invoice-date <YYYY-MM-DD>", "invoice date stamped on every invoice (default: today, UTC)")
  .option("--due-date <YYYY-MM-DD>", "explicit due date (default: invoice date + 30-day terms)")
  .action((opts: { data: string; month: string; format: string; out: string; invoiceDate?: string; dueDate?: string }) => {
    const format = opts.format.toLowerCase();
    if (format !== "csv" && format !== "iif") {
      process.stderr.write(`Unknown --format "${opts.format}". Use csv or iif.\n`);
      process.exitCode = 1;
      return;
    }
    const cfg = defaultConfig(opts.month);
    const dataDir = resolve(opts.data);
    const outDir = resolve(opts.out);

    const close = priceClose(dataDir, cfg, false);
    printWarnings(close.packet.warnings);
    const failedChecks = runAndPrintChecks(close);
    printExceptionSummary(close.exceptions);

    const invoiceDate = opts.invoiceDate ?? todayIso();
    const { heldCount } = exportBillable(close, cfg, outDir, format, {
      invoiceDate,
      dueDate: opts.dueDate,
    });

    // Same honesty gate as `run`: never exit 0 with a failing check or a held line.
    if (failedChecks > 0 || heldCount > 0) process.exitCode = 1;
  });

program
  .command("close")
  .description(
    "invoice-driven monthly close: the Coro invoice IS the pricing authority (H = Subtotal, " +
      "L = Client Price); usage breaks each line down by customer and flags disagreements. " +
      "See docs/AUGUST_CLOSE_PLAN.md."
  )
  .requiredOption("--data <dir>", "directory holding the month's packet (usage + Coro invoices)")
  .requiredOption("--month <YYYY-MM>", "accounting period, e.g. 2026-08")
  .requiredOption("--invoice <number>", "the Coro invoice number that IS this month's close (e.g. 2193)")
  .option("--out <dir>", "output directory", "out")
  .option("--format <csv|iif>", "QuickBooks output format", "csv")
  .option("--invoice-date <YYYY-MM-DD>", "invoice date stamped on every outbound invoice (default: today, UTC)")
  .option("--due-date <YYYY-MM-DD>", "explicit due date (default: invoice date + 30-day terms)")
  .action(
    (opts: {
      data: string;
      month: string;
      invoice: string;
      out: string;
      format: string;
      invoiceDate?: string;
      dueDate?: string;
    }) => {
      const format = opts.format.toLowerCase();
      if (format !== "csv" && format !== "iif") {
        process.stderr.write(`Unknown --format "${opts.format}". Use csv or iif.\n`);
        process.exitCode = 1;
        return;
      }
      const cfg = defaultConfig(opts.month);
      const dataDir = resolve(opts.data);
      const outDir = resolve(opts.out);
      const files = xlsxFilesIn(dataDir);
      const warnings: string[] = [];

      // --- Usage → reduce (metric model → billed qty; partner slugs → invoice names) ---
      let billed: ReturnType<typeof reduceUsage>["billed"] = [];
      let reduceExceptions: ReturnType<typeof reduceUsage>["exceptions"] = [];
      const usageFile = findFile(files, PATTERNS.usage);
      if (!usageFile) {
        warnings.push(
          "usage file not found — the close will bill every invoice line partner-level " +
            "(no by-customer breakdown). Dane wants the breakdown; drop the usage file in."
        );
      } else {
        const r = parseUsage(workbookFrom(usageFile), { period: cfg.period });
        if (isOk(r)) {
          const reduced = reduceUsage(r.value);
          billed = reduced.billed;
          reduceExceptions = reduced.exceptions;
        } else {
          warnings.push(`failed to parse usage (${baseName(usageFile)}): ${r.error.message}`);
        }
      }

      // --- Coro invoices (all of them; the close selects --invoice) ---
      const coroInvoices: CoroInvoiceLine[] = [];
      const invoiceFiles = findAll(files, PATTERNS.coroInvoice).filter(
        (f) => !PATTERNS.usage.test(baseName(f)) && !PATTERNS.rateCard.test(baseName(f))
      );
      if (invoiceFiles.length === 0) {
        process.stderr.write(
          `No Coro invoice files found in ${dataDir} — the invoice IS the close; cannot continue.\n`
        );
        process.exitCode = 1;
        return;
      }
      for (const f of invoiceFiles) {
        const r = parseCoroInvoice(workbookFrom(f), {
          invoiceNumber: invoiceNumberFromName(f),
          period: cfg.period,
        });
        if (isOk(r)) coroInvoices.push(...r.value);
        else warnings.push(`failed to parse Coro invoice (${baseName(f)}): ${r.error.message}`);
      }
      if (!coroInvoices.some((l) => l.invoiceNumber === opts.invoice)) {
        process.stderr.write(
          `No lines found for invoice "${opts.invoice}". Present: ` +
            `${[...new Set(coroInvoices.map((l) => l.invoiceNumber))].join(", ") || "(none)"}.\n`
        );
        process.exitCode = 1;
        return;
      }

      // --- The close ---
      const { rated, exceptions, report } = closeFromInvoice(coroInvoices, billed, {
        period: cfg.period,
        invoiceNumber: opts.invoice,
      });

      printWarnings(warnings);
      printCloseReport(report);
      printExceptionSummary([...reduceExceptions, ...exceptions]);

      // --- Export billable lines through the standard QuickBooks path ---
      const invoiceDate = opts.invoiceDate ?? todayIso();
      const shim: PricedClose = {
        rated,
        invoices: [],
        exceptions,
        packet: { usage: [], rateCardEntries: [], lindita: null, coroInvoices, warnings },
      };
      const { heldCount } = exportBillable(shim, cfg, outDir, format, {
        invoiceDate,
        dueDate: opts.dueDate,
      });

      // Honesty gate: a broken tie or held lines must never exit 0.
      if (!report.grandTieOk || heldCount > 0) process.exitCode = 1;
    }
  );

// Ensure Money is referenced so tree-shaking never drops the import used for
// potential future totals in this boundary module (keeps the import intentional).
void Money;

program.parseAsync(process.argv).catch((e: unknown) => {
  process.stderr.write(`coro-billing failed: ${(e as Error).message}\n`);
  process.exitCode = 1;
});
