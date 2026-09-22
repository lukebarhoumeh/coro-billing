/**
 * Tests for the Excel close-workbook builder (web/src/lib/exportWorkbook.ts).
 * Built over the synthetic demo model so tab names and cell values are stable.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildCloseWorkbook, sheetName } from "../../web/src/lib/exportWorkbook.js";
import { buildRateCardDemo } from "../../fixtures/synthetic/rateCardDemo.js";
import { parseSpecialPricing } from "../../src/ingest/specialPricing.js";
import { closeFromRateCard } from "../../src/close/rateCardClose.js";
import { unwrap } from "../../src/lib/result.js";
import { Money } from "../../src/lib/money.js";

function demoModel() {
  const d = buildRateCardDemo();
  return closeFromRateCard({
    pricing: unwrap(parseSpecialPricing(d.pricingCsv, d.period)),
    usage: d.usage,
    coroInvoiceLines: d.coroInvoiceLines,
    period: d.period,
  });
}

describe("sheetName", () => {
  it("strips illegal chars, caps at 31, and uniquifies", () => {
    const taken = new Set<string>();
    expect(sheetName("A/B:C*D?E[F]G", taken)).toBe("A B C D E F G");
    expect(sheetName("TechLead Professional Services LLC", taken)).toBe(
      "TechLead Professional Services "
    );
    expect(sheetName("TechLead Professional Services LLC", taken)).toBe(
      "TechLead Professional Servi (2)"
    );
  });
});

describe("buildCloseWorkbook", () => {
  const model = demoModel();
  const wb = buildCloseWorkbook(
    model,
    { acmemsp_demo_b: { status: "approved", note: "checked vs Coro" } },
    { pricingFile: "DEMO pricing.csv", usageFile: "DEMO usage" }
  );

  it("has Summary, one tab per partner, Exceptions, Review", () => {
    expect(wb.SheetNames).toEqual([
      "Summary",
      "Acme MSP",
      "Globex Managed",
      "Initech IT",
      "Exceptions",
      "Review",
    ]);
  });

  it("Summary carries totals, review status and held counts", () => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Summary"]!);
    expect(rows).toHaveLength(3);
    const acme = rows.find((r) => r["Partner"] === "Acme MSP")!;
    expect(acme["Status"]).toBe("approved");
    expect(acme["Billed L"]).toBeCloseTo(588, 2); // 60×9.00 + 12×4.00
    // GP/GM tracked explicitly for MSP Hub (Luke, 2026-09-21).
    expect(acme["GP (margin)"]).toBeCloseTo(60, 2); // 45.00 actual-basis + 15.00 expected-basis
    expect(acme["GM %"]).toBeCloseTo(10.2, 1); // 60 / 588
    const initech = rows.find((r) => r["Partner"] === "Initech IT")!;
    expect(initech["Held lines"]).toBe(1);
    expect(initech["Status"]).toBe("unreviewed");
    expect(initech["GM %"]).toBeNull(); // zero billed — no GM
  });

  it("partner tabs include customer breakdown rows and a TOTAL row", () => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Acme MSP"]!);
    expect(rows.some((r) => r["Customer"] === "fakeco-one_DEMO_b")).toBe(true);
    expect(rows.some((r) => r["Customer"] === "(partner workspace)")).toBe(true);
    const total = rows[rows.length - 1]!;
    expect(total["Product"]).toBe("TOTAL");
    expect(total["Amount L"]).toBeCloseTo(588, 2);
  });

  it("Exceptions tab mirrors the model findings", () => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Exceptions"]!);
    expect(rows.length).toBe(model.findings.length);
    expect(rows.some((r) => r["Kind"] === "MISSING_RATE")).toBe(true);
  });

  it("Review tab records the file provenance", () => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Review"]!);
    expect(rows.some((r) => r["Partner"] === "Pricing file" && r["Workspace"] === "DEMO pricing.csv")).toBe(true);
  });

  it("carries Credit Expected on line rows, TOTAL rows and the Summary (Coro 2026-09-22)", () => {
    // Minimal over-billed legacy scenario: card additive $9.00, Coro billed $11.00×10.
    const creditModel = closeFromRateCard({
      pricing: {
        partners: [
          {
            name: "TechLead",
            workspaceId: "techleadcom_aaaa_b",
            rows: [
              {
                product: "Complete Managed Flex",
                listPrice: Money.of("20.00"),
                netMsp: Money.of("10.00"),
                mspDiscountPct: 50,
                hubDiscountPct: 5,
                netHubStated: Money.of("9.00"),
                totalDiscountPct: 55,
                sourceRow: 10,
              },
            ],
            approxMonthlySpend: null,
            activeUsers: null,
            totalWorkspaces: null,
            contactName: null,
            contactPhone: null,
            contactEmail: null,
            address: null,
            sourceRow: 1,
          },
        ],
        findings: [],
      },
      usage: [
        {
          period: "2026-08",
          partner: "techleadcom_AAAA_b",
          customer: null,
          sku: { vendorSku: "BUCOMMNGflex", class: "legacy", isLegacy: true },
          quantity: 10,
          u: { raw: null, known: false },
          d: { raw: null, known: false },
          raw: {},
          sourceRow: 100,
        },
      ],
      coroInvoiceLines: [
        {
          invoiceNumber: "INVCUS2026-0002193",
          lineNumber: 1,
          sku: "BUCOMMNGflex",
          partner: "TechLead",
          quantity: 10,
          unitPrice: Money.of("11.00"),
          amount: Money.of("110.00"),
          servicePeriod: "2026-08",
          raw: {},
        },
      ],
      period: "2026-08",
    });
    expect(creditModel.totalCreditExpected.toFixed2()).toBe("20.00");
    const cwb = buildCloseWorkbook(creditModel, {});
    const summary = XLSX.utils.sheet_to_json<Record<string, unknown>>(cwb.Sheets["Summary"]!);
    expect(summary[0]!["Credit Expected"]).toBeCloseTo(20, 2);
    const tab = XLSX.utils.sheet_to_json<Record<string, unknown>>(cwb.Sheets["TechLead"]!);
    const line = tab.find((r) => r["SKU"] === "BUCOMMNGflex" && r["Product"] !== "")!;
    expect(line["Credit Expected"]).toBeCloseTo(20, 2);
    expect(String(line["Findings"])).toContain("CREDIT_EXPECTED");
    const total = tab[tab.length - 1]!;
    expect(total["Credit Expected"]).toBeCloseTo(20, 2);
  });
});
