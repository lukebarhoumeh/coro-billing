/**
 * QuickBooks export — the last step of Dane's pipeline.
 *
 * Dane's "perfect-world pipeline" (README): "We get a usage report from Coro, we
 * plug it into this, it plugs the output into QuickBooks. And Lindita has her
 * invoices." This module turns priced, per-customer-broken-down QbInvoice[]
 * (one per MSP partner) into the two formats QuickBooks actually ingests:
 *
 *   - toQuickBooksCsv : the common QuickBooks Online (QBO) multi-line invoice
 *                       import CSV — one row per invoice LINE.
 *   - toIif           : QuickBooks Desktop IIF (TRNS / SPL / ENDTRNS).
 *
 * Plus the QuickBooksAdapter port and its stub:
 *   - ApiQuickBooksAdapter : a documented STUB for the QBO Invoice REST API,
 *                            throwing NotConfigured until real OAuth2 wiring lands.
 * The filesystem-bound CsvQuickBooksAdapter lives in ./csvAdapter.ts (kept separate
 * so this module stays browser-importable — no node:fs here).
 *
 * Business rules encoded here (README / DATA_CONTRACTS / ARCHITECTURE):
 *   - Customer on the invoice = the MSP (partner). Hub bills the partner, not the
 *     end customer (README "Commercial model": "Hub's customer is the partner").
 *   - The end customer / workspace is carried in ItemDescription so the partner
 *     bill is "broken down by customer" (Dane's Amplivity example).
 *   - ItemRate = unit L ("what we're charging"); ItemAmount = L * qty. Money is
 *     rendered with Money.toFixed2 — never a raw float.
 *   - Determinism (ARCHITECTURE rule 9): no Date.now()/randomness. Dates are
 *     INJECTED via opts at this export boundary; invoices are sorted stably.
 */
import type { QbInvoice, QbInvoiceLine } from "../domain/types.js";
import { Money } from "../lib/money.js";

// --- shared date / numbering options ---------------------------------------

/**
 * Options injected at the export boundary. Per ARCHITECTURE rule 9, dates come
 * from the CLI (the only place `Date` lives), never from the clock inside this
 * pure module — so the same invoices always render byte-identically.
 */
export interface QbExportOptions {
  /** YYYY-MM-DD stamped onto every invoice's InvoiceDate. */
  readonly invoiceDate?: string;
  /** YYYY-MM-DD due date; if omitted, derived from invoiceDate + termsDays. */
  readonly dueDate?: string;
  /** Payment terms in days; used to derive DueDate when dueDate is not supplied. */
  readonly termsDays?: number;
}

// --- deterministic invoice numbering ----------------------------------------

/**
 * Deterministic InvoiceNo per partner+period: `HUB-<PERIOD>-<n>`, where <n> is a
 * stable 1-based index over partners sorted alphabetically. Same inputs → same
 * numbers on every run (no clock, no randomness), so a re-close is reproducible.
 */
function invoiceNo(period: string, index: number): string {
  return `HUB-${period}-${index + 1}`;
}

/**
 * Sort invoices deterministically (partner, then period) so output ordering — and
 * therefore the assigned InvoiceNo — is stable regardless of input order.
 */
function sortInvoices(invoices: readonly QbInvoice[]): QbInvoice[] {
  return [...invoices].sort(
    (a, b) => a.partner.localeCompare(b.partner) || a.period.localeCompare(b.period)
  );
}

/**
 * Sort an invoice's lines deterministically (customer, then sku). Mirrors the
 * invoicing module's ordering so the by-customer breakdown reads the same way in
 * QuickBooks as it does internally.
 */
function sortLines(lines: readonly QbInvoiceLine[]): QbInvoiceLine[] {
  return [...lines].sort(
    (a, b) => (a.customer ?? "").localeCompare(b.customer ?? "") || a.sku.localeCompare(b.sku)
  );
}

// --- date helper (pure; no clock) -------------------------------------------

/**
 * Add whole days to a YYYY-MM-DD date and return YYYY-MM-DD. Uses UTC so the
 * result never depends on the host timezone (determinism). Returns "" for a
 * missing/invalid input rather than throwing across the boundary.
 */
function addDays(isoDate: string | undefined, days: number): string {
  if (!isoDate) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return "";
  const [, y, mo, d] = m;
  const base = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const shifted = new Date(base + days * 86_400_000);
  const yy = shifted.getUTCFullYear().toString().padStart(4, "0");
  const mm = (shifted.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = shifted.getUTCDate().toString().padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Resolve the DueDate: explicit `dueDate` wins, else invoiceDate + termsDays, else "". */
function resolveDueDate(opts: QbExportOptions | undefined): string {
  if (opts?.dueDate) return opts.dueDate;
  if (opts?.invoiceDate && opts?.termsDays != null) {
    return addDays(opts.invoiceDate, opts.termsDays);
  }
  return "";
}

// --- CSV quoting (RFC 4180) -------------------------------------------------

/**
 * Quote a CSV field per RFC 4180: wrap in double quotes and double any embedded
 * quote when the value contains a comma, quote, CR or LF; otherwise emit as-is.
 * This is what keeps partner names like `Smith, Jones & Co "Partners"` from
 * corrupting the import.
 */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Join a row's fields with commas after quoting each. */
function csvRow(fields: readonly string[]): string {
  return fields.map(csvField).join(",");
}

// --- toQuickBooksCsv --------------------------------------------------------

/** The QBO multi-line invoice import header, in the exact column order QBO expects. */
const QBO_CSV_HEADER = [
  "InvoiceNo",
  "Customer",
  "InvoiceDate",
  "DueDate",
  "Item(Product/Service)",
  "ItemDescription",
  "ItemQuantity",
  "ItemRate",
  "ItemAmount",
] as const;

/**
 * Render invoices as the common QuickBooks Online multi-line invoice import CSV.
 *
 * Layout (ARCHITECTURE): one CSV row per invoice LINE; QBO groups consecutive
 * rows sharing an InvoiceNo + Customer into a single invoice. Therefore every
 * line of one partner's invoice repeats InvoiceNo/Customer/dates and differs only
 * in the Item columns — that is how the per-customer breakdown lands in QBO.
 *
 *   Customer         = the MSP (partner) — Hub bills the partner (README).
 *   ItemDescription  = "<end customer> — <product>" (the by-customer breakdown).
 *   Item             = the SKU (Product/Service name in QuickBooks).
 *   ItemRate         = unit L (Money.toFixed2). ItemAmount = L * qty (toFixed2).
 *
 * @param opts injected InvoiceDate/DueDate/termsDays (never read from the clock).
 */
export function toQuickBooksCsv(invoices: QbInvoice[], opts?: QbExportOptions): string {
  const invoiceDate = opts?.invoiceDate ?? "";
  const dueDate = resolveDueDate(opts);

  const sorted = sortInvoices(invoices);
  const rows: string[] = [csvRow(QBO_CSV_HEADER)];

  sorted.forEach((inv, i) => {
    const no = invoiceNo(inv.period, i);
    for (const line of sortLines(inv.lines)) {
      // The by-customer breakdown Dane asked for lives in ItemDescription:
      // "<end customer / workspace> — <product>". Partner-level (null customer)
      // rows fall back to just the product description.
      const description =
        line.customer != null ? `${line.customer} — ${line.description}` : line.description;
      rows.push(
        csvRow([
          no,
          inv.partner, // Customer = the MSP
          invoiceDate,
          dueDate,
          line.sku, // Item (Product/Service)
          description, // by-customer breakdown
          formatQty(line.quantity),
          line.rate.toFixed2(), // ItemRate = unit L
          line.amount.toFixed2(), // ItemAmount = L * qty
        ])
      );
    }
  });

  // Trailing newline so the file ends cleanly; QBO tolerates it.
  return rows.join("\r\n") + "\r\n";
}

/**
 * Render a quantity. QBO accepts a plain integer ("3") or a decimal; we render the
 * number as-is (never scientific notation — quantities here are small counts).
 */
function formatQty(qty: number): string {
  return String(qty);
}

// --- toIif (QuickBooks Desktop) ---------------------------------------------

/**
 * Render invoices as QuickBooks Desktop IIF.
 *
 * IIF invoice structure: one transaction per invoice, framed by TRNS ... SPL ...
 * ENDTRNS. Accounting identity: the TRNS line posts the total to Accounts
 * Receivable (a DEBIT, positive) and each SPL line posts a customer/income split
 * (a CREDIT, negative). For a balanced transaction the TRNS amount plus all SPL
 * amounts sum to zero — which the tests assert.
 *
 *   TRNS  TRNSTYPE=INVOICE  ACCNT="Accounts Receivable"  NAME=<MSP>  AMOUNT=+total
 *   SPL   ACCNT="Sales Income"  NAME=<end customer — product>  AMOUNT=-(L*qty)
 *
 * Fields are TAB-delimited (IIF is tab-separated). Dates are injected via opts
 * and formatted MM/DD/YYYY (QuickBooks Desktop's default). No clock is read.
 */
export function toIif(invoices: QbInvoice[], opts?: QbExportOptions): string {
  const trnsDate = toIifDate(opts?.invoiceDate);
  const dueDate = toIifDate(resolveDueDate(opts));

  const lines: string[] = [];

  // Header directive block. Column order is fixed and referenced by the tests.
  lines.push(tsv(["!TRNS", "TRNSTYPE", "DATE", "ACCNT", "NAME", "AMOUNT", "DOCNUM", "DUEDATE", "MEMO"]));
  lines.push(tsv(["!SPL", "TRNSTYPE", "DATE", "ACCNT", "NAME", "AMOUNT", "MEMO", "QNTY", "PRICE"]));
  lines.push(tsv(["!ENDTRNS"]));

  const sorted = sortInvoices(invoices);
  sorted.forEach((inv, i) => {
    const no = invoiceNo(inv.period, i);
    // Total this invoice charges the partner = sum of line L*qty. We recompute
    // from lines (not subtotalCharge) so the TRNS ties to the SPL splits exactly.
    const total = inv.lines.reduce<Money>((acc, l) => acc.add(l.amount), Money.zero());

    // TRNS: debit Accounts Receivable for the full invoice total (positive).
    lines.push(
      tsv([
        "TRNS",
        "INVOICE",
        trnsDate,
        "Accounts Receivable",
        inv.partner, // the MSP we bill
        total.toFixed2(),
        no,
        dueDate,
        `Coro usage ${inv.period}`,
      ])
    );

    // One SPL per invoice line: credit Sales Income (negative), carrying the
    // by-customer breakdown in NAME/MEMO. Sorted for determinism.
    for (const line of sortLines(inv.lines)) {
      const memo =
        line.customer != null ? `${line.customer} — ${line.description}` : line.description;
      lines.push(
        tsv([
          "SPL",
          "INVOICE",
          trnsDate,
          "Sales Income",
          inv.partner,
          line.amount.mul(-1).toFixed2(), // credit = negative
          memo,
          formatQty(line.quantity),
          line.rate.toFixed2(),
        ])
      );
    }

    lines.push(tsv(["ENDTRNS"]));
  });

  return lines.join("\r\n") + "\r\n";
}

/** Tab-separated row for IIF. */
function tsv(fields: readonly string[]): string {
  // IIF is tab-delimited; strip any stray tabs/newlines from field values so the
  // structure can't be broken by dirty data.
  return fields.map((f) => f.replace(/[\t\r\n]+/g, " ")).join("\t");
}

/** Convert YYYY-MM-DD to QuickBooks Desktop's MM/DD/YYYY, or "" if absent. */
function toIifDate(isoDate: string | undefined): string {
  if (!isoDate) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${mo}/${d}/${y}`;
}

// --- adapter port -----------------------------------------------------------

/**
 * The single port both QuickBooks integrations implement. The CLI depends on this
 * interface, not on a concrete adapter — so swapping the CSV export for the live
 * QBO API later is a one-line change and requires no pipeline rewrite.
 */
export interface QuickBooksAdapter {
  /**
   * Push invoices into QuickBooks. Returns how many invoices were created and a
   * list of identifiers (filenames for the CSV adapter; QBO Invoice Ids for the
   * API adapter).
   */
  createInvoices(invoices: QbInvoice[]): Promise<{ created: number; ids: string[] }>;
}

// --- ApiQuickBooksAdapter (documented stub) ---------------------------------

/**
 * ApiQuickBooksAdapter — DOCUMENTED STUB for the QuickBooks Online Invoice API.
 *
 * This adapter is intentionally NOT wired: it throws `NotConfigured` so no close
 * ever silently thinks it pushed to QBO. It exists to pin the exact call shape so
 * that wiring it later is mechanical, and it holds NO secrets (OAuth2 tokens and
 * realmId must be injected by the caller when this is implemented).
 *
 * ── QBO create-Invoice call shape (verified via Context7 `/websites/
 *    developer_intuit_app_developer_qbo`, 2026-09-14) ────────────────────────
 *
 *   POST {baseUrl}/v3/company/{realmId}/invoice
 *   Authorization: Bearer {oauth2AccessToken}
 *   Accept: application/json ; Content-Type: application/json
 *
 *   Request body (one QbInvoice → one QBO Invoice):
 *     {
 *       "CustomerRef": { "value": "<QBO Customer Id for the MSP partner>" },
 *       "TxnDate":  "<invoiceDate YYYY-MM-DD>",   // from opts, not the clock
 *       "DueDate":  "<dueDate YYYY-MM-DD>",       // from opts / termsDays
 *       "DocNumber": "HUB-<period>-<n>",          // our deterministic InvoiceNo
 *       "Line": [
 *         {
 *           "DetailType": "SalesItemLineDetail",
 *           "Amount": <L * qty>,                  // == QbInvoiceLine.amount
 *           "Description": "<end customer — product>",  // by-customer breakdown
 *           "SalesItemLineDetail": {
 *             "ItemRef":   { "value": "<QBO Item Id for the SKU>" },
 *             "Qty":       <quantity>,
 *             "UnitPrice": <L unit rate>          // == QbInvoiceLine.rate
 *           }
 *         }
 *         // ...one Line per QbInvoiceLine (the per-customer breakdown)
 *       ]
 *     }
 *
 *   Response (201): { "Invoice": { "Id": "<id>", "DocNumber": "...",
 *                                  "TotalAmt": <sum>, ... } }
 *   → createInvoices returns { created, ids: [Invoice.Id, ...] }.
 *
 *   Notes verified against the docs:
 *     • There can be exactly one CustomerRef per invoice (== our one MSP/partner).
 *     • Each Line uses DetailType "SalesItemLineDetail" with an ItemRef; Qty +
 *       UnitPrice live inside SalesItemLineDetail; Amount == Qty * UnitPrice.
 *     • TotalAmt is server-computed; we should NOT trust a client-sent total.
 *
 *   Auth / tenancy requirements (must be injected, never hardcoded):
 *     • OAuth2 authorization-code flow → access token (Bearer) + refresh token.
 *     • realmId identifies the QBO company; it scopes the URL path above.
 *     • Sandbox baseUrl:    https://sandbox-quickbooks.api.intuit.com
 *       Production baseUrl: https://quickbooks.api.intuit.com
 *
 *   Before wiring, also resolve (SKUs/partners are strings in our model, but QBO
 *   Line/CustomerRef need QBO ids):
 *     • Map partner name → QBO Customer Id (query/create Customer entity).
 *     • Map SKU → QBO Item Id (query/create Item entity).
 *
 * TODO(verify): confirm the current minimum-viable Invoice payload + minor
 *   version query param against the live docs before enabling:
 *   https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice
 */
export class ApiQuickBooksAdapter implements QuickBooksAdapter {
  /**
   * @param _config placeholder for injected { baseUrl, realmId, accessToken,
   *   customerIdByPartner, itemIdBySku }. Typed as unknown so no secret shape is
   *   baked in yet. Never populated in tests.
   */
  constructor(private readonly _config?: unknown) {}

  async createInvoices(_invoices: QbInvoice[]): Promise<{ created: number; ids: string[] }> {
    // Fail loudly and specifically: a close must never believe it reached QBO
    // when it did not. Wire the POST described in the class doc block, then
    // replace this throw with the real request/response handling.
    throw new Error(
      "QBO API adapter not configured: ApiQuickBooksAdapter is a documented stub. " +
        "Provide OAuth2 access token + realmId and implement the POST /v3/company/{realmId}/invoice " +
        "call described in the class doc block, or use CsvQuickBooksAdapter to produce an import file."
    );
  }
}
