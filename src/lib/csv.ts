/**
 * Minimal RFC4180 CSV parser.
 *
 * Exists for the Coro special-pricing rate card, which arrives as a raw CSV
 * (unlike every other Coro artifact, which is xlsx). Requirements that rule out
 * a naive split(","):
 *   - quoted fields carry embedded commas ("6090 Surety Dr Ste 295 El Paso, TX 79905");
 *   - Excel doubles quotes inside quoted fields ("" -> ");
 *   - quoted fields may carry embedded newlines (multi-line address cells).
 *
 * Behavior:
 *   - `\r` OUTSIDE quotes is ignored (CRLF and LF files parse identically);
 *     inside quotes it is data and survives verbatim.
 *   - Rows are NOT padded to equal length — the rate-card parser pads to its
 *     own column count, so ragged trailing cells are the caller's business.
 *   - A terminal newline does not produce a trailing empty row.
 *
 * Deterministic, single pass, no regex backtracking.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  /** True once the current row has any content (field chars, a comma, or quotes). */
  let rowStarted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the doubled quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    switch (ch) {
      case '"':
        inQuotes = true;
        rowStarted = true;
        break;
      case ",":
        row.push(field);
        field = "";
        rowStarted = true;
        break;
      case "\n":
        if (rowStarted || field.length > 0) {
          row.push(field);
          rows.push(row);
        }
        row = [];
        field = "";
        rowStarted = false;
        break;
      case "\r":
        break; // CRLF normalization; the \n case ends the row
      default:
        field += ch;
        rowStarted = true;
    }
  }

  // Flush the final row when the file has no terminal newline.
  if (rowStarted || field.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
