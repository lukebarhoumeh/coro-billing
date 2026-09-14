/**
 * parseCoroInvoice — Coro -> Hub invoice ingestion (invoices 1914 and 2193).
 *
 * Non-negotiable rule #7 (docs/ARCHITECTURE.md): "Two Coro invoices stay two
 * (1914 and 2193) until proven otherwise." README source table warns of 2193:
 * "do not drop or double-count." This parser therefore treats ONE workbook as
 * ONE invoice: it never merges across files and `lineNumber` restarts at 1 for
 * each invoice. Merging/rollup (if ever justified) is a downstream decision, not
 * something the parser silently does.
 *
 * Grain (DATA_CONTRACTS.md): `sku`, `quantity`, `unitPrice`, `amount`
 * (+ `invoiceNumber` from filename if absent). The invoice number is taken from
 * cfg (filenames encode 1914/2193) OR an in-sheet column when present. If
 * neither yields one, we return an IngestError rather than fabricate a number.
 *
 * Money: `unitPrice`/`amount` are exact via the Money class; `quantity` via the
 * tolerant `num` accessor. Builds on the shared xlsx helper; never touches
 * SheetJS directly; returns Result — never throws across the boundary.
 */
import type { ColumnMap } from "../config/pipeline.config.js";
import { CORO_INVOICE_COLUMN_MAP, resolveColumn } from "../config/pipeline.config.js";
import type { CoroInvoiceLine, Period } from "../domain/types.js";
import { Money } from "../lib/money.js";
import type { Result } from "../lib/result.js";
import { err, ok } from "../lib/result.js";
import type { IngestError, WorkbookInput } from "./xlsx.js";
import { ingestError, loadWorkbook, num, pickSheet, readSheet, str } from "./xlsx.js";

const STAGE = "parseCoroInvoice";

/**
 * Header aliases for an in-sheet invoice-number column. Not part of the shared
 * CORO_INVOICE_COLUMN_MAP (which drives header-row detection); the invoice
 * number usually rides on the filename, so it is resolved separately and is
 * optional.
 */
const INVOICE_NUMBER_ALIASES: readonly string[] = [
  "invoice number",
  "invoice no",
  "invoice #",
  "invoice",
  "inv no",
  "inv #",
  "invoicenumber",
];

/** Customer/workspace aliases (optional on an invoice line). */
const CUSTOMER_ALIASES: readonly string[] = [
  "customer",
  "workspace",
  "child account",
  "account",
  "tenant",
  "end customer",
];

export function parseCoroInvoice(
  input: WorkbookInput,
  cfg?: { columns?: ColumnMap; invoiceNumber?: string; period?: Period }
): Result<CoroInvoiceLine[], IngestError> {
  const columns = cfg?.columns ?? CORO_INVOICE_COLUMN_MAP;

  const wbRes = loadWorkbook(input);
  if (!wbRes.ok) return wbRes;
  const wb = wbRes.value;

  const sheetRes = pickSheet(wb);
  if (!sheetRes.ok) return err(ingestError(STAGE, sheetRes.error.message, sheetRes.error));

  const sheetDataRes = readSheet(wb, sheetRes.value, columns);
  if (!sheetDataRes.ok) return err(ingestError(STAGE, sheetDataRes.error.message, sheetDataRes.error));
  const sheet = sheetDataRes.value;

  const skuHeader = resolveColumn(sheet.headers, columns.sku ?? []);
  const quantityHeader = resolveColumn(sheet.headers, columns.quantity ?? []);
  const unitPriceHeader = resolveColumn(sheet.headers, columns.unitPrice ?? []);
  const amountHeader = resolveColumn(sheet.headers, columns.amount ?? []);
  const partnerHeader = resolveColumn(sheet.headers, columns.partner ?? []);
  const customerHeader = resolveColumn(sheet.headers, CUSTOMER_ALIASES);
  const invoiceNumberHeader = resolveColumn(sheet.headers, INVOICE_NUMBER_ALIASES);

  if (!skuHeader) {
    return err(
      ingestError(
        STAGE,
        `no SKU/item column found in "${sheet.name}"; headers: ${sheet.headers.join(", ")}. ` +
          `Add an alias in CORO_INVOICE_COLUMN_MAP.sku (pipeline.config.ts).`
      )
    );
  }

  // Invoice number must be resolvable for AT LEAST ONE line, from either the
  // sheet or cfg. We never fabricate an invoice number (rule #7 — two stay two).
  if (!cfg?.invoiceNumber && !invoiceNumberHeader) {
    return err(
      ingestError(
        STAGE,
        `no invoice number available: neither cfg.invoiceNumber (filenames encode ` +
          `1914/2193) nor an invoice-number column in "${sheet.name}". ` +
          `headers: ${sheet.headers.join(", ")}.`
      )
    );
  }

  const lines: CoroInvoiceLine[] = [];
  let lineNumber = 0; // 1-based, restarts per invoice/workbook — never merged.

  for (const row of sheet.rows) {
    const sku = str(row, skuHeader);
    // A row with no SKU is not an invoice line — skip, never price a blank line.
    if (sku == null) continue;

    // Prefer the in-sheet invoice number; fall back to cfg (filename-derived).
    const rowInvoiceNumber = str(row, invoiceNumberHeader) ?? cfg?.invoiceNumber ?? null;
    if (rowInvoiceNumber == null) {
      // A row that carries neither a column value nor a cfg default cannot be
      // attributed to an invoice — surface it rather than guess.
      return err(
        ingestError(
          STAGE,
          `row without an invoice number and no cfg.invoiceNumber fallback (sku "${sku}").`
        )
      );
    }

    lineNumber += 1;

    const quantity = num(row, quantityHeader) ?? 0;
    const unitNum = num(row, unitPriceHeader);
    const amountNum = num(row, amountHeader);
    const unitPrice = unitNum == null ? Money.zero() : Money.of(unitNum);
    const amount = amountNum == null ? Money.zero() : Money.of(amountNum);

    const partner = str(row, partnerHeader);
    const customer = str(row, customerHeader);

    const line: CoroInvoiceLine = {
      invoiceNumber: rowInvoiceNumber,
      lineNumber,
      sku,
      quantity,
      unitPrice,
      amount,
      raw: { ...row },
      // Optional fields only included when present, keeping lines lean.
      ...(partner != null ? { partner } : {}),
      ...(customerHeader != null ? { customer } : {}),
      ...(cfg?.period != null ? { period: cfg.period } : {}),
    };

    lines.push(line);
  }

  return ok(lines);
}

// Re-export the type for convenient single-import at call sites.
export type { CoroInvoiceLine };
