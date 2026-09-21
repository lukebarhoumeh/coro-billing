/**
 * Tests for the special-pricing CSV parser (src/ingest/specialPricing.ts).
 *
 * Fixture rows are cut from the REAL "Coro Special MSP Pricing(Special Pricing).csv"
 * (Sep 2026): Net-Tech, Seven Star Systems, TechLead, Evolve (+ its "Managed"
 * sub-block), the stray "XTB" alias line, MC Squared (no $ signs). Numbers are
 * the real ones so a parser regression fails against ground truth, not toys.
 *
 * Column semantics (spec 2026-09-21): E "Net Price to MSP" = L, the partner's
 * cost — what the MSP pays Hub. Col H is validated, never trusted.
 */
import { describe, it, expect } from "vitest";
import {
  parseSpecialPricing,
  validateListPrices,
} from "../../src/ingest/specialPricing.js";
import { isOk, unwrap } from "../../src/lib/result.js";
import type { PricingPartner } from "../../src/domain/types.js";

/** CSV-quote a cell when needed. */
function q(cell: string): string {
  return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
/** Build one 17-column CSV row from sparse cells. */
function row(...cells: string[]): string {
  const padded = [...cells];
  while (padded.length < 17) padded.push("");
  return padded.map(q).join(",");
}

const LETTERHEAD = [
  row("CORONET CYBER SECURITY, INC."),
  row("169 Madison Avenue"),
  row("New York, NY 10016"),
  row("phone: 872-264-4991"),
  row("Email: billing@coro.net"),
];

const HEADER = row(
  "MSP", "Workspace ID", "Product", "List Price", "Net Price to MSP",
  "MSP Discount", "MSPHUB Discount", "Net Price to MSPHUB (5%)",
  "Total Discount From List", "Approximate Monthly Spend", "Active Users",
  "Total workspaces", "Contact Name", "Number", "Email", "Billing Contact", "Address"
);

/** The real Net-Tech block (first row carries partner + first product + contact). */
const NET_TECH = [
  row("Net-Tech", "net-techUS_JWIA_b", "Coro AI Complete", "$15.00", "$6.00", "60%", "5%", "$5.70", "65%",
    "$1,000.00", "310 users/406 dev.", "4", "Zach Kinder", "+1 877-449-8324", "zachary.kinder@net-tech.us",
    "", "6090 Surety Dr Ste 295 El Paso, TX 79905"),
  row("", "", "Coro AI Essentials", "$7.50", "$3.00", "60%", "5%", "$2.85", "65%", "", "", "", "B:"),
  row("", "", "Coro AI Endpoint", "$5.00", "$3.00", "40%", "5%", "$2.85", "45%"),
  row("", "", "Coro Managed/Monthly", "$5.00", "$4.00", "20%", "25%", "$3.80", "45%"),
  row("", "", "Coro Managed Flex"), // real blank-price row — kept with null prices
  row(), // spacer
];

/** Real Seven Star block: col H = 6.08 = E×0.95 (consistent); col I = 61 ≠ 58+5 (inconsistent). */
const SEVEN_STAR = [
  row("Seven Star Systems", "sevenstarsystemscom_X8E3_b", "Coro AI Complete", "15.00", "$6.40", "58%", "5%", "$6.08", "61%",
    "Awaiting sig. **Does not want to be sold on anything but Coro"),
  row("", "", "Coro AI Essentials", "7.50", "$3.20", "58%", "5%", "$3.04", "61%"),
];

/** Real TechLead row where col H diverges from E×0.95: 6.00×0.95 = 5.70, sheet says 5.25. */
const TECHLEAD = [
  row("TechLead Professional Services LLC", "techlpcom_CKC5_b", "Complete Flex", "15.00", "$6.00", "60%", "5%", "$5.25", "65%"),
];

/** Real Evolve block + its "Managed" sub-block (folds into Evolve). */
const EVOLVE = [
  row("Evolve Technologies", "evolvewithuscom_XXMA_b", "Coro AI Complete", "15.00", "$7.50", "50%", "5%", "$7.13", "55%",
    "$300", "34", "5", "Doug Hanson"),
  row("", "", "SAT Flex", "2.00", "$1.40", "30%", "15%", "$1.10", "45%"),
  row("Managed", "", "Coro Managed", "5.00", "$2.50", "50%", "5%", "$2.38", "55%"),
];

/** The real stray alias line, then the real partner. */
const XTB = [
  row("XTB"),
  row("XTB Solutions", "xtbsolutionscom_PL3O_b", "Coro AI Complete", "15.00", "$7.50", "50%", "5%", "$7.13", "55%",
    "$850", "63", "15", "Opher Mizarachi"),
];

/** Real MC Squared block — list prices carry no $ sign. */
const MC_SQUARED = [
  row("MC Squared Computing", "mc2computingcom_UQNU_b", "Coro AI Complete", "15.00", "$12.00", "20%", "25%", "$11.40", "45%",
    "New Partner (Standard Tier Pricing)"),
];

function parse(blocks: string[][]): { partners: readonly PricingPartner[]; findings: readonly import("../../src/domain/types.js").Exception[] } {
  const csv = [...LETTERHEAD, HEADER, ...blocks.flat()].join("\r\n") + "\r\n";
  const r = parseSpecialPricing(csv, "2026-08");
  expect(isOk(r)).toBe(true);
  return unwrap(r);
}

describe("parseSpecialPricing — structure", () => {
  it("skips the letterhead, finds the header, and reads partner blocks", () => {
    const { partners } = parse([NET_TECH, SEVEN_STAR]);
    expect(partners.map((p) => p.name)).toEqual(["Net-Tech", "Seven Star Systems"]);
  });

  it("reads the Net-Tech block: contact on first row, 5 product rows, blank-price row kept", () => {
    const { partners } = parse([NET_TECH]);
    const nt = partners[0]!;
    expect(nt.workspaceId).toBe("net-techus_jwia_b"); // trimmed + lowercased
    expect(nt.contactName).toBe("Zach Kinder");
    expect(nt.contactEmail).toBe("zachary.kinder@net-tech.us");
    expect(nt.address).toBe("6090 Surety Dr Ste 295 El Paso, TX 79905");
    expect(nt.approxMonthlySpend).toBe("$1,000.00");
    expect(nt.rows).toHaveLength(5);
    const complete = nt.rows[0]!;
    expect(complete.product).toBe("Coro AI Complete");
    expect(complete.listPrice!.toFixed2()).toBe("15.00");
    expect(complete.netMsp!.toFixed2()).toBe("6.00"); // col E — the partner's cost (L)
    expect(complete.mspDiscountPct).toBe(60);
    expect(complete.hubDiscountPct).toBe(5);
    expect(complete.netHubStated!.toFixed2()).toBe("5.70");
    expect(complete.totalDiscountPct).toBe(65);
    const flex = nt.rows[4]!;
    expect(flex.product).toBe("Coro Managed Flex");
    expect(flex.listPrice).toBeNull();
    expect(flex.netMsp).toBeNull(); // held later, never invented
  });

  it("parses money cells without $ signs (MC Squared idiom)", () => {
    const { partners } = parse([MC_SQUARED]);
    expect(partners[0]!.rows[0]!.listPrice!.toFixed2()).toBe("15.00");
    expect(partners[0]!.rows[0]!.netMsp!.toFixed2()).toBe("12.00");
  });

  it("folds 'Managed' sub-blocks into the enclosing partner", () => {
    const { partners } = parse([EVOLVE]);
    expect(partners).toHaveLength(1);
    const evolve = partners[0]!;
    expect(evolve.name).toBe("Evolve Technologies");
    expect(evolve.rows.map((r) => r.product)).toEqual(["Coro AI Complete", "SAT Flex", "Coro Managed"]);
    expect(evolve.rows[2]!.netMsp!.toFixed2()).toBe("2.50");
  });

  it("drops name-only stray rows (XTB) with an EMPTY_PARTNER_BLOCK finding", () => {
    const { partners, findings } = parse([XTB]);
    expect(partners.map((p) => p.name)).toEqual(["XTB Solutions"]);
    const stray = findings.filter((f) => f.kind === "EMPTY_PARTNER_BLOCK");
    expect(stray).toHaveLength(1);
    expect(stray[0]!.partner).toBe("XTB");
    expect(stray[0]!.severity).toBe("info");
  });
});

describe("parseSpecialPricing — in-file validations", () => {
  it("flags col I ≠ F+G (Seven Star: 61 vs 58+5=63) but NOT its consistent col H", () => {
    const { findings } = parse([SEVEN_STAR]);
    const math = findings.filter((f) => f.kind === "SHEET_MATH_INCONSISTENT");
    // Two rows, each I=61 vs 63 — but col H (6.08 = 6.40×0.95, 3.04 = 3.20×0.95) is consistent.
    expect(math).toHaveLength(2);
    expect(math[0]!.message).toMatch(/61/);
    expect(math[0]!.message).toMatch(/63/);
    expect(math[0]!.severity).toBe("info");
  });

  it("flags col H ≠ E×0.95 (TechLead Complete Flex: 5.25 vs 5.70)", () => {
    const { findings } = parse([TECHLEAD]);
    const math = findings.filter((f) => f.kind === "SHEET_MATH_INCONSISTENT");
    expect(math).toHaveLength(1);
    expect(math[0]!.message).toMatch(/5\.25/);
    expect(math[0]!.message).toMatch(/5\.70/);
  });

  it("keeps the FIRST row and flags DUPLICATE_RATE_ROW on a repeated product", () => {
    const dupe = [
      row("Dupe MSP", "dupemspcom_AAAA_b", "Coro AI Complete", "15.00", "$6.00", "60%", "5%", "$5.70", "65%"),
      row("", "", "Coro AI Complete", "15.00", "$9.00", "40%", "5%", "$8.55", "45%"),
    ];
    const { partners, findings } = parse([dupe]);
    expect(partners[0]!.rows).toHaveLength(1);
    expect(partners[0]!.rows[0]!.netMsp!.toFixed2()).toBe("6.00"); // first kept
    expect(findings.filter((f) => f.kind === "DUPLICATE_RATE_ROW")).toHaveLength(1);
  });

  it("flags MISSING_WORKSPACE_ID on a real block with products but no slug", () => {
    const noWs = [row("Ghost MSP", "", "Coro AI Complete", "15.00", "$12.00", "20%", "25%", "$11.40", "45%")];
    const { partners, findings } = parse([noWs]);
    expect(partners[0]!.workspaceId).toBeNull();
    expect(findings.filter((f) => f.kind === "MISSING_WORKSPACE_ID")).toHaveLength(1);
  });

  it("flags DUPLICATE_WORKSPACE_ID when two blocks share a slug", () => {
    const a = [row("First MSP", "sharedcom_AAAA_b", "Coro AI Complete", "15.00", "$6.00", "60%", "5%", "$5.70", "65%")];
    const b = [row("Second MSP", "SHAREDcom_AAAA_b", "Coro AI Lite", "5.00", "$4.00", "20%", "25%", "$3.80", "45%")];
    const { findings } = parse([a, b]);
    expect(findings.filter((f) => f.kind === "DUPLICATE_WORKSPACE_ID")).toHaveLength(1);
  });

  it("errs when no header row exists", () => {
    const r = parseSpecialPricing("just,some,garbage\nrows,here,too\n", "2026-08");
    expect(isOk(r)).toBe(false);
  });
});

describe("validateListPrices — Danny's cross-partner check", () => {
  it("is quiet when every partner shows the same list price per product", () => {
    const { partners } = parse([NET_TECH, SEVEN_STAR]);
    expect(validateListPrices(partners, "2026-08")).toEqual([]);
  });

  it("flags LIST_PRICE_DIVERGES when the same product lists differently across partners", () => {
    const a = [row("A MSP", "amspcom_AAAA_b", "Coro AI Complete", "15.00", "$6.00", "60%", "5%", "$5.70", "65%")];
    const b = [row("B MSP", "bmspcom_BBBB_b", "Coro AI Complete", "14.00", "$6.00", "60%", "5%", "$5.70", "65%")];
    const { partners } = parse([a, b]);
    const findings = validateListPrices(partners, "2026-08");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("LIST_PRICE_DIVERGES");
    expect(findings[0]!.severity).toBe("warn");
    expect(findings[0]!.message).toMatch(/15\.00/);
    expect(findings[0]!.message).toMatch(/14\.00/);
    expect(findings[0]!.message).toMatch(/A MSP/);
    expect(findings[0]!.message).toMatch(/B MSP/);
  });
});
