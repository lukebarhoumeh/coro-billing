/**
 * Shared spreadsheet ingestion helper (SheetJS wrapper).
 *
 * Real Coro/Hub workbooks have title rows, merged cells and inconsistent headers.
 * This helper:
 *   - loads a workbook from a path, a buffer, or an already-parsed WorkBook
 *     (buffer/workbook inputs let tests build fixtures in-memory — no committed
 *     binary xlsx needed);
 *   - finds the real header row by scoring candidate rows against a ColumnMap;
 *   - resolves canonical fields -> concrete headers so parsers are "plug and play"
 *     (add a header alias in pipeline.config.ts, not code, when a real file drifts).
 *
 * Parsers (usage/rateCard/lindita/msrp/coroInvoice) build ON TOP of this — they
 * never call SheetJS directly.
 */
import * as XLSX from "xlsx";
import { type ColumnMap, normalizeHeader, resolveColumn } from "../config/pipeline.config.js";
import { type Result, ok, err } from "../lib/result.js";

export type CellValue = string | number | boolean | null;
export type RowObject = Record<string, CellValue>;

export type WorkbookInput =
  | { readonly path: string }
  | { readonly buffer: Buffer | Uint8Array }
  | { readonly workbook: XLSX.WorkBook };

export interface IngestError {
  readonly stage: string;
  readonly message: string;
  readonly detail?: unknown;
}

export function ingestError(stage: string, message: string, detail?: unknown): IngestError {
  return { stage, message, detail };
}

/** Parsed tabular view of one worksheet. */
export interface SheetData {
  readonly name: string;
  /** Concrete headers as they appear in the file (post header-row detection). */
  readonly headers: readonly string[];
  /** Data rows keyed by concrete header. */
  readonly rows: readonly RowObject[];
  /** 1-based source row number in the sheet for each data row (for audit/errors). */
  readonly sourceRows: readonly number[];
}

export function loadWorkbook(input: WorkbookInput): Result<XLSX.WorkBook, IngestError> {
  try {
    if ("workbook" in input) return ok(input.workbook);
    if ("buffer" in input) {
      return ok(XLSX.read(input.buffer, { type: "buffer", cellDates: true }));
    }
    return ok(XLSX.readFile(input.path, { cellDates: true }));
  } catch (e) {
    return err(ingestError("loadWorkbook", `failed to read workbook: ${(e as Error).message}`, e));
  }
}

/** List sheet names. Handy for parsers that must find "legacy" vs "current" tabs. */
export function sheetNames(wb: XLSX.WorkBook): readonly string[] {
  return wb.SheetNames;
}

/** Pick a sheet by exact name, else by normalized-name contains, else the first sheet. */
export function pickSheet(wb: XLSX.WorkBook, want?: string): Result<string, IngestError> {
  if (wb.SheetNames.length === 0) return err(ingestError("pickSheet", "workbook has no sheets"));
  if (!want) return ok(wb.SheetNames[0]!);
  const exact = wb.SheetNames.find((n) => n === want);
  if (exact) return ok(exact);
  const wn = normalizeHeader(want);
  const fuzzy = wb.SheetNames.find((n) => normalizeHeader(n).includes(wn));
  if (fuzzy) return ok(fuzzy);
  return err(
    ingestError("pickSheet", `no sheet matching "${want}"; have: ${wb.SheetNames.join(", ")}`)
  );
}

/**
 * Read a sheet into a raw array-of-arrays (each inner array = one row's cells).
 * Blank trailing cells are preserved as null so column positions stay stable.
 */
function toMatrix(wb: XLSX.WorkBook, sheetName: string): CellValue[][] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const aoa = XLSX.utils.sheet_to_json<CellValue[]>(ws, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });
  return aoa.map((r) => (Array.isArray(r) ? r : []));
}

/**
 * Score how well a matrix row looks like a header row for the given ColumnMap:
 * the number of canonical fields whose aliases appear in that row.
 */
function scoreHeaderRow(row: CellValue[], columnMap: ColumnMap): number {
  const headers = row.map((c) => (c == null ? "" : String(c)));
  let score = 0;
  for (const aliases of Object.values(columnMap)) {
    if (resolveColumn(headers, aliases) !== null) score += 1;
  }
  return score;
}

/**
 * Turn a worksheet into SheetData, auto-detecting the header row.
 *
 * @param columnMap used only to locate the header row (the row that matches the
 *        most canonical fields). Parsing/validation of specific fields is the
 *        caller's job via resolveColumn + the cell accessors below.
 * @param scanRows how many leading rows to consider as potential headers.
 */
export function readSheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  columnMap: ColumnMap,
  scanRows = 15
): Result<SheetData, IngestError> {
  const matrix = toMatrix(wb, sheetName);
  if (matrix.length === 0) {
    return err(ingestError("readSheet", `sheet "${sheetName}" is empty`));
  }

  let bestRow = 0;
  let bestScore = -1;
  const limit = Math.min(scanRows, matrix.length);
  for (let i = 0; i < limit; i++) {
    const score = scoreHeaderRow(matrix[i]!, columnMap);
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }

  if (bestScore <= 0) {
    return err(
      ingestError(
        "readSheet",
        `could not find a header row in "${sheetName}" matching any expected column ` +
          `(checked first ${limit} rows). Update the column map aliases in pipeline.config.ts.`
      )
    );
  }

  const headerRow = matrix[bestRow]!;
  const headers = headerRow.map((c, i) => (c == null || String(c).trim() === "" ? `__col${i}` : String(c).trim()));

  const rows: RowObject[] = [];
  const sourceRows: number[] = [];
  for (let r = bestRow + 1; r < matrix.length; r++) {
    const cells = matrix[r]!;
    // skip fully-blank rows
    if (cells.every((c) => c == null || String(c).trim() === "")) continue;
    const obj: RowObject = {};
    headers.forEach((h, i) => {
      obj[h] = i < cells.length ? cells[i]! : null;
    });
    rows.push(obj);
    sourceRows.push(r + 1); // 1-based
  }

  return ok({ name: sheetName, headers, rows, sourceRows });
}

// ---- Cell accessors -------------------------------------------------------

/** Read a required string cell by concrete header. */
export function str(row: RowObject, header: string | null): string | null {
  if (!header) return null;
  const v = row[header];
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Read a numeric cell, tolerating currency symbols, commas, parentheses-negatives
 * and percent signs. Returns null when the cell is blank/non-numeric.
 */
export function num(row: RowObject, header: string | null): number | null {
  if (!header) return null;
  const v = row[header];
  if (v == null) return null;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  if (s === "") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,%\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n * sign : null;
}

/** True when a cell is truthy-ish ("yes", "true", "y", "1", "legacy", "x"). */
export function bool(row: RowObject, header: string | null): boolean {
  const s = str(row, header);
  if (s == null) return false;
  return ["yes", "y", "true", "1", "x", "legacy"].includes(s.toLowerCase());
}
