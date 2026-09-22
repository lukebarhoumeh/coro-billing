/**
 * Tests for the rate-card close (src/close/rateCardClose.ts).
 *
 * Pinned numbers are GROUND TRUTH from the real files (verified 2026-09-21):
 *   - Seven Star Systems, Coro AI Complete: E=$6.40, 58%+5% ⇒ additive cost
 *     15×0.37 = $5.55 (what Coro actually bills — invoice 2193 Rocker/Viener
 *     lines), while the sheet's col H says $6.08 (E×0.95). BOTH are carried.
 *   - Meeting Tree Computer, COR-COMP-C on invoice 2193: qty 59, Subtotal
 *     $486.75 (rate 8.25 = additive 15×0.55), client price $9.00 ⇒ margin
 *     531.00 − 486.75 = $44.25.
 */
import { describe, it, expect } from "vitest";
import { closeFromRateCard } from "../../src/close/rateCardClose.js";
import { Money } from "../../src/lib/money.js";
import type {
  CoroInvoiceLine,
  PricingPartner,
  PricingRow,
  SpecialPricingResult,
  UsageLine,
} from "../../src/domain/types.js";

let rowNo = 10;
function prow(
  product: string,
  cells: {
    list?: string | null;
    e?: string | null;
    f?: number | null;
    g?: number | null;
    h?: string | null;
    i?: number | null;
  }
): PricingRow {
  return {
    product,
    listPrice: cells.list == null ? null : Money.of(cells.list),
    netMsp: cells.e == null ? null : Money.of(cells.e),
    mspDiscountPct: cells.f ?? null,
    hubDiscountPct: cells.g ?? null,
    netHubStated: cells.h == null ? null : Money.of(cells.h),
    totalDiscountPct: cells.i ?? null,
    sourceRow: rowNo++,
  };
}

function pp(name: string, workspaceId: string | null, rows: PricingRow[]): PricingPartner {
  return {
    name,
    workspaceId,
    rows,
    approxMonthlySpend: null,
    activeUsers: null,
    totalWorkspaces: null,
    contactName: "Test Contact",
    contactPhone: null,
    contactEmail: null,
    address: null,
    sourceRow: 1,
  };
}

function pricing(...partners: PricingPartner[]): SpecialPricingResult {
  return { partners, findings: [] };
}

let usageRow = 100;
function ul(slug: string, customer: string | null, code: string, qty: number): UsageLine {
  return {
    period: "2026-08",
    partner: slug,
    customer,
    sku: { vendorSku: code, class: "current", isLegacy: false },
    quantity: qty,
    u: { raw: null, known: false },
    d: { raw: null, known: false },
    raw: {},
    sourceRow: usageRow++,
  };
}

let invRow = 1;
function inv(
  partner: string,
  sku: string,
  quantity: number,
  amount: string,
  servicePeriod = "2026-08",
  clientPrice?: string
): CoroInvoiceLine {
  return {
    invoiceNumber: "INVCUS2026-0002193",
    lineNumber: invRow++,
    sku,
    partner,
    quantity,
    unitPrice: Money.of(amount).div(quantity),
    amount: Money.of(amount),
    servicePeriod,
    ...(clientPrice !== undefined ? { clientPrice: Money.of(clientPrice) } : {}),
    raw: {},
  };
}

const SEVEN_STAR = pp("Seven Star Systems", "sevenstarsystemscom_x8e3_b", [
  prow("Coro AI Complete", { list: "15.00", e: "6.40", f: 58, g: 5, h: "6.08", i: 61 }),
  prow("Coro AI Essentials", { list: "7.50", e: "3.20", f: 58, g: 5, h: "3.04", i: 61 }),
]);

const MEETING_TREE = pp("Meeting Tree Computer", "meetingtreecomputercom_u8tu_b", [
  prow("Coro AI Complete", { list: "15.00", e: "9.00", f: 40, g: 5, h: "8.55", i: 45 }),
  prow("Coro AI Endpoint", { list: "5.00", e: "4.00", f: 20, g: 25, h: "3.80", i: 45 }),
]);

describe("closeFromRateCard — pricing both cost rules", () => {
  it("prices Seven Star Complete: L=6.40, sheet H=6.08, additive H=5.55, expected-basis margin", () => {
    const model = closeFromRateCard({
      pricing: pricing(SEVEN_STAR),
      usage: [ul("sevenstarsystemscom_X8E3_b", null, "COR-COMP-C", 10)],
      period: "2026-08",
    });
    expect(model.partners).toHaveLength(1);
    const draft = model.partners[0]!;
    expect(draft.cardName).toBe("Seven Star Systems");
    expect(draft.slug).toBe("sevenstarsystemscom_x8e3_b");
    const line = draft.lines[0]!;
    expect(line.unitL!.toFixed2()).toBe("6.40");
    expect(line.amountL!.toFixed2()).toBe("64.00");
    expect(line.expectedHSheet!.toFixed2()).toBe("6.08");
    expect(line.expectedHAdditive!.toFixed2()).toBe("5.55");
    expect(line.actualHAmount).toBeNull();
    expect(line.marginBasis).toBe("expected-additive");
    expect(line.margin!.toFixed2()).toBe("8.50"); // 64.00 − 55.50
    expect(draft.totalL.toFixed2()).toBe("64.00");
    expect(draft.totalHExpected.toFixed2()).toBe("55.50");
    expect(draft.totalHActual).toBeNull();
  });

  it("falls back expectedHSheet to E×0.95 when col H is blank", () => {
    const p = pp("Blank H", "blankhcom_aaaa_b", [
      prow("Coro AI Complete", { list: "15.00", e: "6.00", f: 60, g: 5, h: null, i: 65 }),
    ]);
    const model = closeFromRateCard({
      pricing: pricing(p),
      usage: [ul("blankhcom_AAAA_b", null, "COR-COMP-C", 1)],
      period: "2026-08",
    });
    expect(model.partners[0]!.lines[0]!.expectedHSheet!.toFixed2()).toBe("5.70");
  });
});

describe("closeFromRateCard — Coro invoice cross-check", () => {
  it("uses the invoice Subtotal as actual cost and margin basis (Meeting Tree 2193)", () => {
    const model = closeFromRateCard({
      pricing: pricing(MEETING_TREE),
      usage: [ul("meetingtreecomputercom_U8TU_b", null, "COR-COMP-C", 59)],
      coroInvoiceLines: [inv("Meeting Tree Computer", "COR-COMP-C", 59, "486.75")],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    expect(line.actualHAmount!.toFixed2()).toBe("486.75");
    expect(line.actualHUnit!.toFixed2()).toBe("8.25");
    expect(line.invoiceQuantity).toBe(59);
    expect(line.marginBasis).toBe("actual");
    expect(line.margin!.toFixed2()).toBe("44.25"); // 9.00×59 − 486.75
    // 8.25 equals the additive rule exactly → rate is EXPECTED, no finding.
    expect(line.findings.filter((f) => f.kind === "INVOICE_RATE_UNEXPECTED")).toHaveLength(0);
    expect(line.findings.filter((f) => f.kind === "INVOICE_QTY_DISAGREES")).toHaveLength(0);
    expect(model.partners[0]!.totalHActual!.toFixed2()).toBe("486.75");
  });

  it("flags INVOICE_QTY_DISAGREES when audit qty ≠ invoice qty", () => {
    const model = closeFromRateCard({
      pricing: pricing(MEETING_TREE),
      usage: [ul("meetingtreecomputercom_U8TU_b", null, "COR-COMP-C", 59)],
      coroInvoiceLines: [inv("Meeting Tree Computer", "COR-COMP-C", 55, "453.75")],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    expect(line.invoiceQuantity).toBe(55);
    expect(line.findings.filter((f) => f.kind === "INVOICE_QTY_DISAGREES")).toHaveLength(1);
    expect(line.margin!.toFixed2()).toBe("77.25"); // 531.00 − 453.75, bases stated
  });

  it("flags INVOICE_RATE_UNEXPECTED when the billed unit matches neither rule", () => {
    const model = closeFromRateCard({
      pricing: pricing(MEETING_TREE),
      usage: [ul("meetingtreecomputercom_U8TU_b", null, "COR-COMP-C", 59)],
      coroInvoiceLines: [inv("Meeting Tree Computer", "COR-COMP-C", 59, "400.00")],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    const f = line.findings.filter((x) => x.kind === "INVOICE_RATE_UNEXPECTED");
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toMatch(/8\.25/); // additive
    expect(f[0]!.message).toMatch(/8\.55/); // sheet
  });

  it("excludes out-of-period invoice lines from actuals and flags them", () => {
    const model = closeFromRateCard({
      pricing: pricing(MEETING_TREE),
      usage: [ul("meetingtreecomputercom_U8TU_b", null, "COR-COMP-C", 59)],
      coroInvoiceLines: [
        inv("Meeting Tree Computer", "COR-COMP-C", 59, "486.75"),
        inv("Meeting Tree Computer", "COR-COMP-C", 55, "453.75", "2026-07"),
      ],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    expect(line.actualHAmount!.toFixed2()).toBe("486.75"); // July line NOT summed
    expect(model.findings.filter((f) => f.kind === "OUT_OF_PERIOD_LINE")).toHaveLength(1);
  });

  it("surfaces invoice lines with no usage this month (NO_USAGE_BREAKDOWN)", () => {
    const model = closeFromRateCard({
      pricing: pricing(MEETING_TREE),
      usage: [ul("meetingtreecomputercom_U8TU_b", null, "COR-COMP-C", 59)],
      coroInvoiceLines: [
        inv("Meeting Tree Computer", "COR-COMP-C", 59, "486.75"),
        inv("Meeting Tree Computer", "COR-ENDP-C", 11, "30.25"),
      ],
      period: "2026-08",
    });
    expect(model.findings.filter((f) => f.kind === "NO_USAGE_BREAKDOWN")).toHaveLength(1);
  });
});

describe("closeFromRateCard — held, NFR, join gaps", () => {
  it("HOLDS a line whose pricing row has no Net Price to MSP", () => {
    const p = pp("Holdy", "holdycom_aaaa_b", [
      prow("Coro AI Complete", { list: "15.00", e: null, f: 58, g: 5 }),
    ]);
    const model = closeFromRateCard({
      pricing: pricing(p),
      usage: [ul("holdycom_AAAA_b", null, "COR-COMP-C", 4)],
      period: "2026-08",
    });
    const draft = model.partners[0]!;
    const line = draft.lines[0]!;
    expect(line.unitL).toBeNull();
    expect(line.findings.filter((f) => f.kind === "MISSING_RATE")).toHaveLength(1);
    expect(line.findings[0]!.severity).toBe("block");
    expect(draft.heldLines).toBe(1);
    expect(draft.totalL.toFixed2()).toBe("0.00");
    expect(model.ratedLines).toHaveLength(0); // held lines never reach QuickBooks
  });

  it("HOLDS an unknown product code with UNKNOWN_PRODUCT_CODE", () => {
    const model = closeFromRateCard({
      pricing: pricing(SEVEN_STAR),
      usage: [ul("sevenstarsystemscom_X8E3_b", null, "XYZZYflex", 3)],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    expect(line.findings.filter((f) => f.kind === "UNKNOWN_PRODUCT_CODE")).toHaveLength(1);
    expect(model.partners[0]!.heldLines).toBe(1);
  });

  it("lists NFR lines informationally, excluded from totals and QuickBooks", () => {
    const model = closeFromRateCard({
      pricing: pricing(SEVEN_STAR),
      usage: [
        ul("sevenstarsystemscom_X8E3_b", null, "COR-COMP-NFR", 2),
        ul("sevenstarsystemscom_X8E3_b", null, "COR-COMP-C", 10),
      ],
      period: "2026-08",
    });
    const draft = model.partners[0]!;
    expect(draft.lines).toHaveLength(2);
    expect(model.findings.filter((f) => f.kind === "NFR_LINE")).toHaveLength(1);
    expect(draft.totalL.toFixed2()).toBe("64.00"); // only the Complete line
    expect(model.ratedLines).toHaveLength(1);
  });

  it("reports usage-only slugs (USAGE_NOT_ON_CARD) and card-only partners", () => {
    const model = closeFromRateCard({
      pricing: pricing(SEVEN_STAR, MEETING_TREE),
      usage: [
        ul("sevenstarsystemscom_X8E3_b", null, "COR-COMP-C", 10),
        ul("mysteryco_ZZZZ_b", null, "COR-COMP-C", 5),
      ],
      period: "2026-08",
    });
    expect(model.usageOnly).toEqual([{ slug: "mysteryco_zzzz_b", partner: "mysteryco" }]);
    expect(model.findings.filter((f) => f.kind === "USAGE_NOT_ON_CARD")).toHaveLength(1);
    expect(model.cardOnly.map((p) => p.name)).toEqual(["Meeting Tree Computer"]);
  });
});

describe("closeFromRateCard — team Client Price cross-check (Coro August Billing workbook)", () => {
  // The accounting team keys their bill-out rate into the invoice workbook's
  // "Client Price" column. When it disagrees with the rate card's col E, the
  // close must say so — that keyed price is what was ACTUALLY billed in the
  // manual process (audit of 2026-09-21: 33 legacy lines diverged, $2,234.66).
  it("carries teamClientPrice and stays quiet when it matches the card", () => {
    const model = closeFromRateCard({
      pricing: pricing(MEETING_TREE),
      usage: [ul("meetingtreecomputercom_U8TU_b", null, "COR-COMP-C", 59)],
      coroInvoiceLines: [inv("Meeting Tree Computer", "COR-COMP-C", 59, "486.75", "2026-08", "9.00")],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    expect(line.teamClientPrice!.toFixed2()).toBe("9.00");
    expect(line.findings.filter((f) => f.kind === "CLIENT_PRICE_DIFFERS")).toHaveLength(0);
  });

  it("flags CLIENT_PRICE_DIFFERS when the team keyed a different bill-out rate", () => {
    const model = closeFromRateCard({
      pricing: pricing(SEVEN_STAR),
      usage: [ul("sevenstarsystemscom_X8E3_b", null, "COR-COMP-C", 10)],
      coroInvoiceLines: [inv("Seven Star Systems", "COR-COMP-C", 10, "55.50", "2026-08", "8.90")],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    expect(line.teamClientPrice!.toFixed2()).toBe("8.90");
    const f = line.findings.filter((x) => x.kind === "CLIENT_PRICE_DIFFERS");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("warn");
    expect(f[0]!.message).toMatch(/8\.90/); // team's keyed price
    expect(f[0]!.message).toMatch(/6\.40/); // the card's col E
  });

  it("surfaces the team's price on HELD lines (their cost-pass-through practice)", () => {
    const p = pp("Holdy", "holdycom_aaaa_b", [
      prow("Coro AI Complete", { list: "15.00", e: null, f: 58, g: 5 }),
    ]);
    const model = closeFromRateCard({
      pricing: pricing(p),
      usage: [ul("holdycom_AAAA_b", null, "COR-COMP-C", 4)],
      coroInvoiceLines: [inv("Holdy", "COR-COMP-C", 4, "22.20", "2026-08", "5.55")],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    expect(line.unitL).toBeNull(); // still HELD — the team's price is context, not a rate source
    expect(line.teamClientPrice!.toFixed2()).toBe("5.55");
    expect(line.findings.filter((f) => f.kind === "MISSING_RATE")).toHaveLength(1);
  });

  it("leaves teamClientPrice null when invoice lines carry no client price", () => {
    const model = closeFromRateCard({
      pricing: pricing(MEETING_TREE),
      usage: [ul("meetingtreecomputercom_U8TU_b", null, "COR-COMP-C", 59)],
      coroInvoiceLines: [inv("Meeting Tree Computer", "COR-COMP-C", 59, "486.75")],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    expect(line.teamClientPrice).toBeNull();
    expect(line.findings.filter((f) => f.kind === "CLIENT_PRICE_DIFFERS")).toHaveLength(0);
  });
});

describe("closeFromRateCard — Classic-family forced cost (Coro 2026-09-22 answer c)", () => {
  // "Partner discounts do apply to legacy, with the exception of Coro Classic
  // and Managed Classic (40% to the partner and 45% to MSP Hub regardless)."
  it("forces Managed Classic cost to list×0.55 and flags a non-40/5 card row", () => {
    const techlead = pp("TechLead", "techleadcom_aaaa_b", [
      prow("Managed Classic Flex", { list: "16.99", e: "8.50", f: 50, g: 5, h: "7.65", i: 55 }),
    ]);
    const model = closeFromRateCard({
      pricing: pricing(techlead),
      usage: [ul("techleadcom_AAAA_b", null, "BUCOCLASSMNflex", 10)],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    expect(line.expectedHAdditive!.toFixed2()).toBe("9.34"); // 16.99×0.55, NOT 16.99×0.45
    const f = line.findings.filter((x) => x.kind === "CLASSIC_RATE_RULE_DISAGREES");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("info");
    expect(f[0]!.message).toMatch(/45%/);
    // margin (no invoice loaded) uses the forced additive at full precision:
    // 85.00 − 16.99×0.55×10 = 85.00 − 93.445 = −8.445 → −8.44 displayed
    expect(line.marginBasis).toBe("expected-additive");
    expect(line.margin!.toFixed2()).toBe("-8.44");
  });

  it("stays quiet on a compliant 40/5 Classic row (same number both ways)", () => {
    const cc = pp("Cyber Construction", "cyber-constructioncom_x3e7_b", [
      prow("Managed Coro Classic", { list: "16.99", e: "10.20", f: 40, g: 5, h: "9.35", i: 45 }),
    ]);
    const model = closeFromRateCard({
      pricing: pricing(cc),
      usage: [ul("cyber-constructioncom_X3E7_b", null, "BUCOCLASSMNflex", 10)],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    expect(line.unitL!.toFixed2()).toBe("10.20");
    expect(line.expectedHAdditive!.toFixed2()).toBe("9.34");
    expect(line.findings.filter((x) => x.kind === "CLASSIC_RATE_RULE_DISAGREES")).toHaveLength(0);
  });

  it("does not force non-Classic legacy codes", () => {
    const p = pp("Evolve", "evolvecom_aaaa_b", [
      prow("Complete Flex", { list: "15.00", e: "7.90", f: 47, g: 5, h: "7.51", i: 52 }),
    ]);
    const model = closeFromRateCard({
      pricing: pricing(p),
      usage: [ul("evolvecom_AAAA_b", null, "BUCOMflex", 4)],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    expect(line.expectedHAdditive!.toFixed2()).toBe("7.20"); // 15×0.48 — card F+G as-is
    expect(line.findings.filter((x) => x.kind === "CLASSIC_RATE_RULE_DISAGREES")).toHaveLength(0);
  });
});

describe("closeFromRateCard — customer breakdown, rated lines, determinism", () => {
  it("keeps per-customer shares and emits per-customer rated lines", () => {
    const model = closeFromRateCard({
      pricing: pricing(SEVEN_STAR),
      usage: [
        ul("sevenstarsystemscom_X8E3_b", "childa_AAAA_b", "COR-COMP-C", 3),
        ul("sevenstarsystemscom_X8E3_b", "childb_BBBB_b", "COR-COMP-C", 7),
      ],
      period: "2026-08",
    });
    const line = model.partners[0]!.lines[0]!;
    expect(line.quantity).toBe(10);
    expect(line.customers).toEqual([
      { customer: "childa_AAAA_b", quantity: 3 },
      { customer: "childb_BBBB_b", quantity: 7 },
    ]);
    expect(model.ratedLines).toHaveLength(2);
    expect(model.ratedLines.map((r) => r.quantity)).toEqual([3, 7]);
    expect(model.ratedLines[0]!.mspPrice.toFixed2()).toBe("6.40");
    expect(model.ratedLines[0]!.amountCharge.toFixed2()).toBe("19.20");
  });

  it("is deterministic — two runs produce deep-equal models", () => {
    const args = {
      pricing: pricing(SEVEN_STAR, MEETING_TREE),
      usage: [
        ul("meetingtreecomputercom_U8TU_b", null, "COR-COMP-C", 59),
        ul("sevenstarsystemscom_X8E3_b", "childa_AAAA_b", "COR-ESS-C", 4),
      ],
      coroInvoiceLines: [inv("Meeting Tree Computer", "COR-COMP-C", 59, "486.75")],
      period: "2026-08",
    };
    expect(closeFromRateCard(args)).toEqual(closeFromRateCard(args));
  });
});
