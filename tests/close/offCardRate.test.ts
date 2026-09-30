/**
 * Off-card confirmed rates (src/config/offCardRates.ts) — Coro/accounting has
 * supplied a bill-out rate for a product that has NO row on the partner's card,
 * so the line would otherwise HOLD ("never invents a product"). The curated
 * off-card entry makes it billable at the confirmed sell rate, with the
 * confirmed additive cost feeding the credit cross-check.
 *
 * Ground truth: S-3's MANAGED CORO ESSENTIALS Flex (BUCORMNGflex). S-3's card
 * carries no managed-essentials row; Coro invoice 2512 bills 94 × $5.78 =
 * $542.85. Brandon Udischas (Coro), 2026-09-30 email: $5.50 to the partner
 * ($3.00 Essentials + $2.50 Managed), $4.88 to MSP Hub. Credit due on the
 * $5.78→$4.88 cost gap: 542.85 − 4.88×94 = 84.13.
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

function prow(product: string, e: string | null, sourceRow: number): PricingRow {
  return {
    product,
    listPrice: null,
    netMsp: e === null ? null : Money.of(e),
    mspDiscountPct: null,
    hubDiscountPct: null,
    netHubStated: null,
    totalDiscountPct: null,
    sourceRow,
  };
}

// S-3's real workspace slug; card has an unrelated row but NO managed-essentials.
const S3: PricingPartner = {
  name: "S-3",
  workspaceId: "s3svccom_vi55_b",
  rows: [prow("Coro AI Complete", "5.55", 42)],
  approxMonthlySpend: null,
  activeUsers: null,
  totalWorkspaces: null,
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  address: null,
  sourceRow: 1,
};

const pricing: SpecialPricingResult = { partners: [S3], findings: [] };

const usage: UsageLine[] = [
  {
    period: "2026-08",
    partner: "s3svccom_VI55_b",
    customer: null,
    sku: { vendorSku: "BUCORMNGflex", class: "legacy", isLegacy: true },
    quantity: 94,
    u: { raw: null, known: false },
    d: { raw: null, known: false },
    raw: {},
    sourceRow: 100,
  },
];

const invoice: CoroInvoiceLine[] = [
  {
    invoiceNumber: "INVCUS2026-0002512",
    lineNumber: 1,
    sku: "BUCORMNGflex",
    partner: "S-3",
    quantity: 94,
    unitPrice: Money.of("542.85").div(94),
    amount: Money.of("542.85"),
    servicePeriod: "2026-08",
    raw: {},
  },
];

describe("closeFromRateCard — off-card confirmed rate (product absent from the card)", () => {
  it("bills S-3's managed-essentials at the off-card 5.50 (was held), cost from the invoice, credit on the gap", () => {
    const model = closeFromRateCard({ pricing, usage, coroInvoiceLines: invoice, period: "2026-08" });
    const partner = model.partners.find((p) => p.cardName === "S-3")!;
    const line = partner.lines.find((l) => l.vendorSku === "BUCORMNGflex")!;

    expect(line.matchKind).toBe("off-card");
    expect(line.unitL!.toFixed2()).toBe("5.50");
    expect(line.amountL!.toFixed2()).toBe("517.00");
    expect(line.actualHAmount!.toFixed2()).toBe("542.85");
    expect(line.expectedHAdditive!.toFixed2()).toBe("4.88");
    expect(line.creditExpected!.toFixed2()).toBe("84.13");
    expect(line.margin!.toFixed2()).toBe("-25.85");
    expect(line.marginBasis).toBe("actual");

    expect(partner.heldLines).toBe(0);
    expect(line.findings.some((f) => f.kind === "RATE_OVERRIDE_APPLIED")).toBe(true);
    expect(line.findings.some((f) => f.kind === "UNKNOWN_PRODUCT_CODE")).toBe(false);
  });
});
