/**
 * Synthetic demo packet for the RATE-CARD close (web demo mode + UI tests).
 *
 * Three loudly-fake partners exercising every interesting path the real August
 * packet has: a clean partner with a customer breakdown and an invoice match,
 * a partner with a MOD* (Modules Flex) line and a deliberate qty mismatch, and
 * a partner with a HELD line (blank col E) plus an NFR line. Obviously fake
 * names/contacts; nothing here resembles a real Coro partner or rate.
 *
 * Deterministic: pure literals, no clock, no randomness.
 */
import { SYNTHETIC_BANNER } from "./build.js";
import type { CoroInvoiceLine, Period, UsageLine } from "../../src/domain/types.js";
import { Money } from "../../src/lib/money.js";

export { SYNTHETIC_BANNER };

export const DEMO_PERIOD: Period = "2026-08";

export interface RateCardDemo {
  readonly pricingCsv: string;
  readonly usage: readonly UsageLine[];
  readonly coroInvoiceLines: readonly CoroInvoiceLine[];
  readonly period: Period;
}

function csvRow(...cells: string[]): string {
  const padded = [...cells];
  while (padded.length < 17) padded.push("");
  return padded.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",");
}

const PRICING_CSV: string = [
  csvRow(`${SYNTHETIC_BANNER} — DEMO RATE CARD`),
  csvRow("Not a real Coro document"),
  csvRow(
    "MSP", "Workspace ID", "Product", "List Price", "Net Price to MSP",
    "MSP Discount", "MSPHUB Discount", "Net Price to MSPHUB (5%)",
    "Total Discount From List", "Approximate Monthly Spend", "Active Users",
    "Total workspaces", "Contact Name", "Number", "Email", "Billing Contact", "Address"
  ),
  // Acme MSP — clean current-gen partner (invoice cross-check target).
  csvRow("Acme MSP", "acmemsp_DEMO_b", "Coro AI Complete", "$15.00", "$9.00", "40%", "5%", "$8.55", "45%",
    "$500", "60 users", "3", "Demo Contact", "555-0100", "demo@acme.example", "", "1 Fake St, Nowhere, ZZ 00000"),
  csvRow("", "", "Coro AI Essentials", "$7.50", "$4.50", "40%", "5%", "$4.28", "45%"),
  csvRow("", "", "Coro AI Endpoint", "$5.00", "$4.00", "20%", "25%", "$3.80", "45%"),
  // Globex Managed — legacy partner with a specific flex row and a generic modules row.
  csvRow("Globex Managed", "globexmanaged_DEMO_b", "Coro AI Complete", "$15.00", "$6.40", "58%", "5%", "$6.08", "63%",
    "$300", "40 users", "5", "Fake Person", "555-0101", "fake@globex.example"),
  csvRow("", "", "Essentials Flex", "$7.50", "$3.20", "58%", "5%", "$3.04", "63%"),
  csvRow("", "", "Network Flex", "$7.50", "$3.00", "60%", "5%", "$2.85", "65%"),
  csvRow("", "", "Modules Flex", "$7.50", "$3.00", "60%", "5%", "$2.63", "65%"),
  csvRow("Managed", "", "Coro Managed", "$5.00", "$2.50", "50%", "5%", "$2.38", "55%"),
  // Initech IT — HELD line (blank E on Classic Flex) + current-gen row for the NFR code.
  csvRow("Initech IT", "initechit_DEMO_b", "Coro AI Complete", "$15.00", "$12.00", "20%", "25%", "$11.40", "45%",
    "New Partner (Standard Tier Pricing)"),
  csvRow("", "", "Classic Flex", "$11.99"), // no Net Price to MSP — the close HOLDS this
].join("\r\n") + "\r\n";

let row = 100;
function usageLine(
  slug: string,
  customer: string | null,
  code: string,
  product: string,
  qty: number
): UsageLine {
  return {
    period: DEMO_PERIOD,
    partner: slug,
    customer,
    sku: {
      vendorSku: code,
      class: code.toLowerCase().endsWith("flex") ? "legacy" : "current",
      isLegacy: code.toLowerCase().endsWith("flex"),
      product,
    },
    quantity: qty,
    product,
    u: { raw: null, known: false },
    d: { raw: null, known: false },
    raw: { synthetic: SYNTHETIC_BANNER },
    sourceRow: row++,
  };
}

const USAGE: readonly UsageLine[] = [
  // Acme: two child customers + the partner's own workspace.
  usageLine("acmemsp_DEMO_b", null, "COR-COMP-C", "CORO_AI_COMPLETE", 10),
  usageLine("acmemsp_DEMO_b", "fakeco-one_DEMO_b", "COR-COMP-C", "CORO_AI_COMPLETE", 25),
  usageLine("acmemsp_DEMO_b", "fakeco-two_DEMO_b", "COR-COMP-C", "CORO_AI_COMPLETE", 25),
  usageLine("acmemsp_DEMO_b", "fakeco-one_DEMO_b", "COR-ENDP-C", "CORO_AI_ENDPOINT", 12),
  // Globex: legacy essentials + a MOD* line (prices from its specific "Network Flex" row).
  usageLine("globexmanaged_DEMO_b", "fakeshop_DEMO_b", "BUCOROflex", "CORO_ESSENTIALS", 30),
  usageLine("globexmanaged_DEMO_b", "fakeshop_DEMO_b", "MODNETWflex", "NETWORK", 30),
  usageLine("globexmanaged_DEMO_b", "fakebank_DEMO_b", "MODEMAILflex", "EMAIL_SECURITY", 8),
  // Initech: a HELD line (Classic Flex has no E) and an NFR line (never billed).
  usageLine("initechit_DEMO_b", null, "BUCOCLASSflex", "CORO_CLASSIC", 6),
  usageLine("initechit_DEMO_b", null, "COR-COMP-NFR", "NFR", 2),
];

let invLine = 1;
function invoiceLine(
  partner: string,
  sku: string,
  quantity: number,
  amount: string,
  servicePeriod: Period = DEMO_PERIOD
): CoroInvoiceLine {
  return {
    invoiceNumber: "DEMO-0000001",
    lineNumber: invLine++,
    sku,
    partner,
    quantity,
    unitPrice: Money.of(amount).div(quantity),
    amount: Money.of(amount),
    servicePeriod,
    raw: { synthetic: SYNTHETIC_BANNER },
  };
}

const INVOICE: readonly CoroInvoiceLine[] = [
  // Matches Acme COR-COMP-C usage (60) at the additive rate 8.25 → clean actual.
  invoiceLine("Acme MSP", "COR-COMP-C", 60, "495.00"),
  // Deliberate qty mismatch: Coro bills 28 Essentials, usage says 30.
  invoiceLine("Globex Managed", "BUCOROflex", 28, "77.28"),
];

/** Build the demo packet. NOTE: usage partner slugs are UNMAPPED on purpose —
 * the demo shows the UNMAPPED_PARTNER warning path too. */
export function buildRateCardDemo(): RateCardDemo {
  return {
    pricingCsv: PRICING_CSV,
    usage: USAGE,
    coroInvoiceLines: INVOICE,
    period: DEMO_PERIOD,
  };
}
