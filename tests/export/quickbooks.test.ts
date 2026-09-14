/**
 * Tests for src/export/quickbooks.ts — the QuickBooks export module.
 *
 * These lock the contract Dane asked for: "plug the output into QuickBooks. And
 * Lindita has her invoices." (README). The MSP (partner) is the QuickBooks
 * Customer; the end customer / workspace is carried in ItemDescription so the
 * partner bill is "broken down by customer" (Dane's Amplivity example).
 *
 * TDD: written before the implementation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  toQuickBooksCsv,
  toIif,
  CsvQuickBooksAdapter,
  ApiQuickBooksAdapter,
} from "../../src/export/quickbooks.js";
import { Money } from "../../src/lib/money.js";
import type { QbInvoice, QbInvoiceLine } from "../../src/domain/types.js";

// --- fixture builders -------------------------------------------------------

function line(over: Partial<QbInvoiceLine> = {}): QbInvoiceLine {
  const rate = over.rate ?? Money.of("10.00");
  const quantity = over.quantity ?? 3;
  return {
    customer: over.customer ?? "Customer A",
    sku: over.sku ?? "SKU-1",
    description: over.description ?? "Coro Endpoint Protection",
    quantity,
    rate,
    amount: over.amount ?? rate.mul(quantity),
  };
}

function invoice(over: Partial<QbInvoice> = {}): QbInvoice {
  const lines = over.lines ?? [line()];
  const subtotalCharge = over.subtotalCharge ?? lines.reduce((a, l) => a.add(l.amount), Money.zero());
  return {
    partner: over.partner ?? "Acme MSP",
    period: over.period ?? "2026-08",
    lines,
    subtotalCharge,
    subtotalCost: over.subtotalCost ?? Money.zero(),
    margin: over.margin ?? Money.zero(),
  };
}

// --- toQuickBooksCsv --------------------------------------------------------

describe("toQuickBooksCsv", () => {
  const HEADER =
    "InvoiceNo,Customer,InvoiceDate,DueDate,Item(Product/Service),ItemDescription,ItemQuantity,ItemRate,ItemAmount";

  it("emits the QBO multi-line invoice import header row", () => {
    const csv = toQuickBooksCsv([invoice()]);
    const rows = csv.trim().split(/\r?\n/);
    expect(rows[0]).toBe(HEADER);
  });

  it("emits exactly one CSV row per invoice line (plus the header)", () => {
    const inv = invoice({
      lines: [
        line({ customer: "Cust A", sku: "SKU-1" }),
        line({ customer: "Cust B", sku: "SKU-2" }),
        line({ customer: "Cust C", sku: "SKU-3" }),
      ],
    });
    const csv = toQuickBooksCsv([inv]);
    const rows = csv.trim().split(/\r?\n/);
    // header + 3 line rows
    expect(rows).toHaveLength(4);
  });

  it("uses the MSP (partner) as Customer and the end customer/workspace in ItemDescription", () => {
    const inv = invoice({
      partner: "Amplivity",
      lines: [line({ customer: "Bright Dental", description: "Coro Managed EDR" })],
    });
    const csv = toQuickBooksCsv([inv]);
    const dataRow = csv.trim().split(/\r?\n/)[1]!;
    const cells = parseCsvRow(dataRow);
    // Customer column = the MSP
    expect(cells[1]).toBe("Amplivity");
    // ItemDescription carries the by-customer breakdown (workspace + product)
    expect(cells[5]).toContain("Bright Dental");
    expect(cells[5]).toContain("Coro Managed EDR");
  });

  it("ItemRate equals the unit L and ItemAmount equals L*qty, both toFixed2", () => {
    const inv = invoice({
      lines: [line({ rate: Money.of("12.5"), quantity: 4 })], // amount = 50.00
    });
    const csv = toQuickBooksCsv([inv]);
    const cells = parseCsvRow(csv.trim().split(/\r?\n/)[1]!);
    expect(cells[6]).toBe("4"); // ItemQuantity
    expect(cells[7]).toBe("12.50"); // ItemRate = unit L, toFixed2
    expect(cells[8]).toBe("50.00"); // ItemAmount = L * qty, toFixed2
  });

  it("escapes commas, quotes and newlines in customer / description fields (RFC-4180)", () => {
    const inv = invoice({
      partner: 'Smith, Jones & Co "Partners"',
      lines: [line({ customer: 'Acme, Inc. "HQ"', description: "line1\nline2" })],
    });
    const csv = toQuickBooksCsv([inv]);
    // A field with a comma/quote must be wrapped in quotes with quotes doubled.
    // Customer (the MSP) stands alone in its own column, so we can match it whole.
    expect(csv).toContain('"Smith, Jones & Co ""Partners"""');
    // The end-customer name is concatenated with the product inside ItemDescription,
    // so assert the escaped customer fragment appears within a quoted field.
    expect(csv).toContain('"Acme, Inc. ""HQ"" — line1');
    // Re-parse the full record and confirm round-trip of the embedded newline.
    const record = parseCsvRecords(csv)[1]!;
    expect(record[1]).toBe('Smith, Jones & Co "Partners"');
    expect(record[5]).toContain("line1\nline2");
    expect(record[5]).toContain('Acme, Inc. "HQ"');
  });

  it("injects InvoiceDate and DueDate only from opts (never from the clock)", () => {
    const csv = toQuickBooksCsv([invoice()], {
      invoiceDate: "2026-08-31",
      dueDate: "2026-09-30",
    });
    const cells = parseCsvRow(csv.trim().split(/\r?\n/)[1]!);
    expect(cells[2]).toBe("2026-08-31");
    expect(cells[3]).toBe("2026-09-30");
  });

  it("derives DueDate from InvoiceDate + termsDays when dueDate is not given", () => {
    const csv = toQuickBooksCsv([invoice()], {
      invoiceDate: "2026-08-31",
      termsDays: 30,
    });
    const cells = parseCsvRow(csv.trim().split(/\r?\n/)[1]!);
    expect(cells[2]).toBe("2026-08-31");
    expect(cells[3]).toBe("2026-09-30");
  });

  it("gives a deterministic InvoiceNo per partner+period (HUB-<PERIOD>-<n>)", () => {
    const a = invoice({ partner: "Acme MSP", period: "2026-08" });
    const b = invoice({ partner: "Globex MSP", period: "2026-08" });
    const csv1 = toQuickBooksCsv([a, b]);
    const csv2 = toQuickBooksCsv([a, b]);
    // byte-identical across runs (no clock, no randomness)
    expect(csv1).toBe(csv2);

    const rows = csv1.trim().split(/\r?\n/);
    const first = parseCsvRow(rows[1]!)[0];
    const second = parseCsvRow(rows[2]!)[0];
    expect(first).toMatch(/^HUB-2026-08-\d+$/);
    expect(second).toMatch(/^HUB-2026-08-\d+$/);
    // distinct partners get distinct invoice numbers
    expect(first).not.toBe(second);
    // all lines of one invoice share the same InvoiceNo
    const multi = invoice({ lines: [line(), line({ customer: "Other" })] });
    const mrows = toQuickBooksCsv([multi]).trim().split(/\r?\n/);
    expect(parseCsvRow(mrows[1]!)[0]).toBe(parseCsvRow(mrows[2]!)[0]);
  });

  it("sorts partners deterministically regardless of input order", () => {
    const a = invoice({ partner: "Zeta MSP", period: "2026-08" });
    const b = invoice({ partner: "Acme MSP", period: "2026-08" });
    const forward = toQuickBooksCsv([a, b]);
    const reversed = toQuickBooksCsv([b, a]);
    expect(forward).toBe(reversed);
    // Acme sorts before Zeta -> Acme's row appears first
    const firstCustomer = parseCsvRow(forward.trim().split(/\r?\n/)[1]!)[1];
    expect(firstCustomer).toBe("Acme MSP");
  });

  it("returns only the header for an empty invoice list", () => {
    const csv = toQuickBooksCsv([]);
    expect(csv.trim()).toBe(HEADER);
  });
});

// --- toIif ------------------------------------------------------------------

describe("toIif", () => {
  it("emits IIF header directives (!TRNS / !SPL / !ENDTRNS)", () => {
    const iif = toIif([invoice()]);
    expect(iif).toContain("!TRNS");
    expect(iif).toContain("!SPL");
    expect(iif).toContain("!ENDTRNS");
  });

  it("balances debits and credits for every transaction (TRNS + SPLs sum to zero)", () => {
    const inv = invoice({
      lines: [
        line({ rate: Money.of("10.00"), quantity: 2 }), // 20.00
        line({ customer: "B", rate: Money.of("5.50"), quantity: 3 }), // 16.50
      ],
    });
    const iif = toIif([inv], { invoiceDate: "2026-08-31" });
    const amounts = extractIifAmounts(iif);
    // Sum of all TRNS + SPL amounts on each transaction must be zero.
    const total = amounts.reduce((a, b) => a + b, 0);
    expect(Math.abs(total)).toBeLessThan(0.005);
  });

  it("is deterministic (byte-identical across runs)", () => {
    const inv = invoice();
    expect(toIif([inv], { invoiceDate: "2026-08-31" })).toBe(
      toIif([inv], { invoiceDate: "2026-08-31" })
    );
  });
});

// --- CsvQuickBooksAdapter ---------------------------------------------------

describe("CsvQuickBooksAdapter", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qbcsv-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a CSV file into outDir and returns the count + [filename]", async () => {
    const adapter = new CsvQuickBooksAdapter(dir, { invoiceDate: "2026-08-31" });
    const res = await adapter.createInvoices([invoice(), invoice({ partner: "Globex MSP" })]);
    expect(res.created).toBe(2);
    expect(res.ids).toHaveLength(1);
    const file = res.ids[0]!;
    expect(existsSync(join(dir, file))).toBe(true);
    const written = readFileSync(join(dir, file), "utf8");
    expect(written).toBe(toQuickBooksCsv([invoice(), invoice({ partner: "Globex MSP" })], { invoiceDate: "2026-08-31" }));
  });

  it("creates outDir if it does not exist (mkdir -p)", async () => {
    const nested = join(dir, "a", "b", "c");
    const adapter = new CsvQuickBooksAdapter(nested);
    const res = await adapter.createInvoices([invoice()]);
    expect(res.created).toBe(1);
    expect(readdirSync(nested).length).toBe(1);
  });
});

// --- ApiQuickBooksAdapter ---------------------------------------------------

describe("ApiQuickBooksAdapter", () => {
  it("createInvoices rejects with a NotConfigured error (never silently no-ops)", async () => {
    const adapter = new ApiQuickBooksAdapter();
    await expect(adapter.createInvoices([invoice()])).rejects.toThrow(/not configured/i);
  });
});

// --- tiny RFC-4180 CSV parser (test-only) -----------------------------------

/** Parse one simple CSV row that contains no embedded newline. */
function parseCsvRow(row: string): string[] {
  return parseCsvRecords(row)[0]!;
}

/** Parse a full CSV string into records, honoring quotes, doubled-quotes and embedded newlines. */
function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (c === "\r") {
      // ignore; handled by \n
    } else {
      field += c;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/** Extract every numeric AMOUNT column from IIF TRNS/SPL lines (tab-delimited). */
function extractIifAmounts(iif: string): number[] {
  const out: number[] = [];
  for (const rawLine of iif.split(/\r?\n/)) {
    if (rawLine.startsWith("TRNS") || rawLine.startsWith("SPL")) {
      const cells = rawLine.split("\t");
      // AMOUNT is the last numeric-looking cell in a standard IIF invoice export.
      for (const cell of cells) {
        const n = Number(cell);
        if (cell.trim() !== "" && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(cell.trim())) {
          // keep only cells that are pure numbers (skip dates like 08/31/2026)
        }
      }
    }
  }
  // Delegated to a dedicated parser below for clarity.
  return parseIifTransactionAmounts(iif);
}

/**
 * Sum the AMOUNT field of TRNS + SPL lines. AMOUNT is a fixed column position in
 * the header we emit; find it from the !TRNS / !SPL directive rows.
 */
function parseIifTransactionAmounts(iif: string): number[] {
  const lines = iif.split(/\r?\n/);
  let trnsAmountIdx = -1;
  let splAmountIdx = -1;
  for (const l of lines) {
    const cells = l.split("\t");
    if (cells[0] === "!TRNS") trnsAmountIdx = cells.indexOf("AMOUNT");
    if (cells[0] === "!SPL") splAmountIdx = cells.indexOf("AMOUNT");
  }
  const amounts: number[] = [];
  for (const l of lines) {
    const cells = l.split("\t");
    if (cells[0] === "TRNS" && trnsAmountIdx >= 0) {
      const n = Number(cells[trnsAmountIdx]);
      if (Number.isFinite(n)) amounts.push(n);
    } else if (cells[0] === "SPL" && splAmountIdx >= 0) {
      const n = Number(cells[splAmountIdx]);
      if (Number.isFinite(n)) amounts.push(n);
    }
  }
  return amounts;
}
