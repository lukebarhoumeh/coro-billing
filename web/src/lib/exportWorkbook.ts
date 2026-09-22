/**
 * Excel close workbook — the accounting archive artifact.
 *
 * Mirrors the shape of Lindita's manual workbook (H/L/margin per partner) plus
 * everything the manual file never had: the finding log and the account team's
 * review trail. Pure WorkBook builder (no DOM) so the root Vitest suite covers
 * it; the browser wraps it with XLSX.write → download (see download.ts).
 *
 * Money lands as NUMBERS (2-dp exact via Money.toNumber) — this is a data
 * export for Excel, not a display surface.
 */
import * as XLSX from "xlsx";
import type { CloseModel } from "../../../src/domain/types.js";

/** Review state shape mirrored from closeStore (kept structural to stay DOM-free). */
export interface ReviewEntryLike {
  readonly status: "approved" | "needs_review";
  readonly note: string;
}
export type ReviewStateLike = Readonly<Record<string, ReviewEntryLike>>;

export interface WorkbookMeta {
  readonly pricingFile?: string;
  readonly usageFile?: string;
  readonly invoiceFile?: string;
}

/** Excel sheet names: ≤31 chars, no []:*?/\ — and unique within the workbook. */
export function sheetName(raw: string, taken: Set<string>): string {
  const cleaned = raw.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Sheet";
  let name = cleaned.slice(0, 31);
  let i = 2;
  while (taken.has(name)) {
    const suffix = ` (${i++})`;
    name = cleaned.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(name);
  return name;
}

function num(m: { toNumber(): number } | null): number | null {
  return m === null ? null : m.toNumber();
}

export function buildCloseWorkbook(
  model: CloseModel,
  review: ReviewStateLike,
  meta: WorkbookMeta = {}
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const taken = new Set<string>();

  // --- Summary ---------------------------------------------------------------
  const summaryRows = model.partners.map((p) => ({
    Partner: p.cardName,
    Workspace: p.slug,
    "Billed L": num(p.totalL),
    "Expected H (additive)": num(p.totalHExpected),
    "Actual H (Coro invoice)": num(p.totalHActual),
    "GP (margin)": num(p.totalMargin),
    "GM %": p.totalL.isZero()
      ? null
      : Math.round((p.totalMargin.toNumber() / p.totalL.toNumber()) * 1000) / 10,
    "Held lines": p.heldLines,
    Status: review[p.slug]?.status ?? "unreviewed",
    Note: review[p.slug]?.note ?? "",
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summaryRows),
    sheetName("Summary", taken)
  );

  // --- One tab per partner (Lindita-workbook shape: qty, L, H, margin) -------
  for (const p of model.partners) {
    const rows: Record<string, string | number | null>[] = [];
    for (const line of p.lines) {
      rows.push({
        Product: line.productLabel,
        SKU: line.vendorSku,
        Customer: "(all)",
        Qty: line.quantity,
        "Unit L (partner pays)": num(line.unitL),
        "Amount L": num(line.amountL),
        "Expected H sheet": num(line.expectedHSheet),
        "Expected H additive": num(line.expectedHAdditive),
        "Actual H (invoice)": num(line.actualHAmount),
        "Invoice qty": line.invoiceQuantity,
        "Team Client Price": num(line.teamClientPrice),
        Margin: num(line.margin),
        Basis: line.marginBasis,
        Match: line.matchKind,
        Findings: line.findings.map((f) => f.kind).join(", "),
      });
      for (const c of line.customers) {
        rows.push({
          Product: "",
          SKU: line.vendorSku,
          Customer: c.customer ?? "(partner workspace)",
          Qty: c.quantity,
          "Unit L (partner pays)": num(line.unitL),
          "Amount L": line.unitL === null ? null : line.unitL.mul(c.quantity).toNumber(),
          "Expected H sheet": null,
          "Expected H additive": null,
          "Actual H (invoice)": null,
          "Invoice qty": null,
          "Team Client Price": null,
          Margin: null,
          Basis: "",
          Match: "",
          Findings: "",
        });
      }
    }
    rows.push({
      Product: "TOTAL",
      SKU: "",
      Customer: "",
      Qty: null,
      "Unit L (partner pays)": null,
      "Amount L": num(p.totalL),
      "Expected H sheet": null,
      "Expected H additive": num(p.totalHExpected),
      "Actual H (invoice)": num(p.totalHActual),
      "Invoice qty": null,
      Margin: num(p.totalMargin),
      "GM %": p.totalL.isZero()
        ? null
        : Math.round((p.totalMargin.toNumber() / p.totalL.toNumber()) * 1000) / 10,
      Basis: "",
      Match: "",
      Findings: p.heldLines > 0 ? `${p.heldLines} HELD line(s) excluded` : "",
    });
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows),
      sheetName(p.cardName, taken)
    );
  }

  // --- Exceptions ------------------------------------------------------------
  const exceptionRows = model.findings.map((f) => ({
    Severity: f.severity,
    Kind: f.kind,
    Partner: f.partner,
    SKU: f.sku,
    Message: f.message,
    Row: f.sourceRow ?? null,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(exceptionRows),
    sheetName("Exceptions", taken)
  );

  // --- Review trail ----------------------------------------------------------
  const reviewRows: Record<string, string>[] = model.partners.map((p) => ({
    Partner: p.cardName,
    Workspace: p.slug,
    Status: review[p.slug]?.status ?? "unreviewed",
    Note: review[p.slug]?.note ?? "",
  }));
  reviewRows.push(
    { Partner: "", Workspace: "", Status: "", Note: "" },
    { Partner: "Period", Workspace: model.period, Status: "", Note: "" },
    { Partner: "Pricing file", Workspace: meta.pricingFile ?? "", Status: "", Note: "" },
    { Partner: "Usage file", Workspace: meta.usageFile ?? "", Status: "", Note: "" },
    { Partner: "Coro invoice", Workspace: meta.invoiceFile ?? "", Status: "", Note: "" }
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(reviewRows),
    sheetName("Review", taken)
  );

  return wb;
}
