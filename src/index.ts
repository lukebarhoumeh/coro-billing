/**
 * Public API barrel for the Coro billing pipeline.
 *
 * This is the single import surface for the whole "magic sauce" loop Dane
 * described (README §"The magic sauce"):
 *
 *   Coro usage in → attach H (our cost) + L (what we charge the MSP) per
 *   partner×SKU → break the partner bill down by customer → recreate August and
 *   diff it against Lindita → emit QuickBooks invoices.
 *
 * The CLI (src/cli/index.ts) and the end-to-end golden test both consume the
 * pipeline exclusively through this barrel, so the composed contract stays in
 * one place. Nothing here reads a clock or touches the filesystem — side effects
 * live only in the CLI and the CsvQuickBooksAdapter (ARCHITECTURE "Coding
 * standards").
 */

// --- Foundation (types, money, result, config) -----------------------------
export type {
  Period,
  SkuClass,
  UnknownField,
  Sku,
  UsageLine,
  MsrpEntry,
  CoroInvoiceLine,
  RateCardEntry,
  RateCard,
  LinditaLine,
  ExceptionKind,
  Exception,
  RatedLine,
  QbInvoiceLine,
  QbInvoice,
  RatingResult,
  CheckResult,
  Discrepancy,
  DiscrepancyReport,
} from "./domain/types.js";

export { Money, sum } from "./lib/money.js";
export type { MoneyInput } from "./lib/money.js";

export {
  ok,
  err,
  isOk,
  isErr,
  map,
  all,
  unwrap,
} from "./lib/result.js";
export type { Result, Ok, Err } from "./lib/result.js";

export {
  BUSINESS,
  USAGE_COLUMN_MAP,
  RATE_CARD_COLUMN_MAP,
  LINDITA_COLUMN_MAP,
  MSRP_COLUMN_MAP,
  CORO_INVOICE_COLUMN_MAP,
  defaultConfig,
  normalizeHeader,
  resolveColumn,
} from "./config/pipeline.config.js";
export type {
  BusinessConstants,
  ColumnMap,
  PipelineConfig,
} from "./config/pipeline.config.js";

// --- Ingest (SheetJS wrapper + parsers) -------------------------------------
export {
  loadWorkbook,
  readSheet,
  pickSheet,
  sheetNames,
  str,
  num,
  bool,
  ingestError,
} from "./ingest/xlsx.js";
export type {
  WorkbookInput,
  SheetData,
  IngestError,
  CellValue,
  RowObject,
} from "./ingest/xlsx.js";

export { parseUsage } from "./ingest/usage.js";
export { parseRateCard } from "./ingest/rateCard.js";
export { parseLinditaWorkbook } from "./ingest/lindita.js";
export { parseMsrp } from "./ingest/msrp.js";
export { parseCoroInvoice, parseDateCell } from "./ingest/coroInvoice.js";
export { reduceUsage, parseAuditEntry } from "./ingest/usageReduce.js";
export type { ReducedUsage } from "./ingest/usageReduce.js";

// --- Partner identity (usage workspace slugs → invoice names) ----------------
export { canonicalPartner, stripWorkspaceSuffix, PARTNER_SLUG_MAP } from "./config/partners.js";
export type { CanonicalPartner } from "./config/partners.js";

// --- Rating (rate-card index + buffer + applyRates) -------------------------
export { buildRateCard } from "./rating/rateCardIndex.js";
export { applyHubBuffer, legacyHubCostFromList } from "./rating/buffer.js";
export { applyRates } from "./rating/applyRates.js";

// --- Invoicing --------------------------------------------------------------
export { buildInvoices } from "./invoicing/buildInvoices.js";

// --- Invoice-driven close (docs/AUGUST_CLOSE_PLAN.md) ------------------------
export { closeFromInvoice, classifyInvoiceSku } from "./close/invoiceClose.js";
export type { CloseOptions, CloseReport, CloseReportLine, CloseResult } from "./close/invoiceClose.js";
export { allocateInteger, allocateCents } from "./lib/allocate.js";

// --- Reconciliation (checks + August acceptance test) -----------------------
export { runChecks } from "./reconcile/checks.js";
export type { ChecksContext } from "./reconcile/checks.js";
export { reconcileAgainstLindita } from "./reconcile/august.js";

// --- QuickBooks export ------------------------------------------------------
// Pure renderers + the API stub live in quickbooks.ts (browser-importable). The
// filesystem-bound CsvQuickBooksAdapter is in csvAdapter.ts (Node only).
export {
  toQuickBooksCsv,
  toIif,
  ApiQuickBooksAdapter,
} from "./export/quickbooks.js";
export type {
  QuickBooksAdapter,
  QbExportOptions,
} from "./export/quickbooks.js";
export { CsvQuickBooksAdapter } from "./export/csvAdapter.js";
