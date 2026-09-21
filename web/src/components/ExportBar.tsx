/**
 * Export actions for the close: Excel workbook (always), QuickBooks CSV / IIF
 * (approval-gated — Dane's endpoint: "put that into QuickBooks").
 *
 * Gating rule: QuickBooks exports include APPROVED partners only. If unapproved
 * drafts exist the user is told exactly which and may include them explicitly —
 * a deliberate speed bump, not a lock.
 */
import { FileDown, FileSpreadsheet, BookText } from "lucide-react";
import { useClose } from "@/lib/closeStore";
import { buildCloseWorkbook } from "@/lib/exportWorkbook";
import { downloadWorkbook, downloadText } from "@/lib/download";
import { buildInvoices } from "@pipeline/invoicing/buildInvoices.js";
import { toQuickBooksCsv, toIif } from "@pipeline/export/quickbooks.js";
import { Button } from "@/components/ui/button";

export function ExportBar() {
  const { model, review, files, period } = useClose();
  if (model === null) return null;

  const unapproved = model.partners.filter((p) => review[p.slug]?.status !== "approved");

  const exportExcel = () => {
    const wb = buildCloseWorkbook(model, review, {
      pricingFile: files.pricing?.fileName,
      usageFile: files.usage?.fileName,
      invoiceFile: files.invoice?.fileName,
    });
    downloadWorkbook(wb, `coro-close-${period}.xlsx`);
  };

  /** Approved partners' rated lines, or — after an explicit confirm — everything. */
  const gatedRatedLines = () => {
    if (unapproved.length === 0) return model.ratedLines;
    const names = unapproved.map((p) => p.cardName).join(", ");
    const includeDrafts = window.confirm(
      `${unapproved.length} draft(s) are not approved yet: ${names}.\n\n` +
        `OK = include them anyway (drafts). Cancel = export approved partners only.`
    );
    if (includeDrafts) return model.ratedLines;
    const approvedNames = new Set(
      model.partners.filter((p) => review[p.slug]?.status === "approved").map((p) => p.cardName)
    );
    return model.ratedLines.filter((l) => approvedNames.has(l.partner));
  };

  const exportQuickBooks = (format: "csv" | "iif") => {
    const lines = gatedRatedLines();
    if (lines.length === 0) {
      window.alert("Nothing to export — approve at least one draft (or include drafts).");
      return;
    }
    const invoices = buildInvoices([...lines], period);
    if (format === "csv") {
      downloadText(`coro-close-${period}-quickbooks.csv`, "text/csv", toQuickBooksCsv(invoices));
    } else {
      downloadText(`coro-close-${period}-quickbooks.iif`, "text/plain", toIif(invoices));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" data-testid="export-excel" onClick={exportExcel}>
        <FileSpreadsheet className="h-4 w-4" />
        Excel workbook
      </Button>
      <Button variant="outline" data-testid="export-qb-csv" onClick={() => exportQuickBooks("csv")}>
        <FileDown className="h-4 w-4" />
        QuickBooks CSV
      </Button>
      <Button variant="outline" data-testid="export-qb-iif" onClick={() => exportQuickBooks("iif")}>
        <BookText className="h-4 w-4" />
        IIF
      </Button>
      {unapproved.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {unapproved.length} of {model.partners.length} drafts unapproved — QuickBooks exports are
          gated
        </span>
      )}
    </div>
  );
}
