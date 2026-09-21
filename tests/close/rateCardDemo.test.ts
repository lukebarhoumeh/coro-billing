/**
 * The synthetic demo packet must exercise every interesting close path —
 * it is what the hosted dashboard shows before real files are dropped, and
 * what Playwright walks in CI. If the demo goes quiet, the demo lies.
 */
import { describe, it, expect } from "vitest";
import { buildRateCardDemo, DEMO_PERIOD } from "../../fixtures/synthetic/rateCardDemo.js";
import { parseSpecialPricing } from "../../src/ingest/specialPricing.js";
import { closeFromRateCard } from "../../src/close/rateCardClose.js";
import { isOk, unwrap } from "../../src/lib/result.js";
import type { CloseModel } from "../../src/domain/types.js";

function buildModel(): CloseModel {
  const demo = buildRateCardDemo();
  const pricing = parseSpecialPricing(demo.pricingCsv, demo.period);
  expect(isOk(pricing)).toBe(true);
  return closeFromRateCard({
    pricing: unwrap(pricing),
    usage: demo.usage,
    coroInvoiceLines: demo.coroInvoiceLines,
    period: demo.period,
  });
}

describe("rate-card demo packet", () => {
  const model = buildModel();

  it("drafts all three fake partners", () => {
    expect(model.partners.map((p) => p.cardName)).toEqual([
      "Acme MSP",
      "Globex Managed",
      "Initech IT",
    ]);
    expect(model.period).toBe(DEMO_PERIOD);
  });

  it("matches the demo invoice to Acme (actual-basis margin, no qty finding)", () => {
    const acme = model.partners[0]!;
    const complete = acme.lines.find((l) => l.vendorSku === "COR-COMP-C")!;
    expect(complete.quantity).toBe(60);
    expect(complete.actualHAmount!.toFixed2()).toBe("495.00");
    expect(complete.marginBasis).toBe("actual");
    expect(complete.margin!.toFixed2()).toBe("45.00"); // 9.00×60 − 495.00
    expect(complete.customers).toHaveLength(3); // own workspace + two fake children
  });

  it("shows the deliberate qty mismatch on Globex Essentials", () => {
    expect(model.findings.filter((f) => f.kind === "INVOICE_QTY_DISAGREES")).toHaveLength(1);
  });

  it("prices Globex MODNETWflex from its specific 'Network Flex' row and MODEMAILflex from 'Modules Flex'", () => {
    const globex = model.partners[1]!;
    expect(globex.lines.find((l) => l.vendorSku === "MODNETWflex")!.matchKind).toBe("specific-flex");
    expect(globex.lines.find((l) => l.vendorSku === "MODEMAILflex")!.matchKind).toBe("modules-flex");
  });

  it("HOLDS exactly one line (Initech Classic Flex, blank col E) and lists one NFR", () => {
    expect(model.findings.filter((f) => f.kind === "MISSING_RATE")).toHaveLength(1);
    expect(model.findings.filter((f) => f.kind === "NFR_LINE")).toHaveLength(1);
    expect(model.partners[2]!.heldLines).toBe(1);
  });

  it("is deterministic", () => {
    expect(buildModel()).toEqual(model);
  });
});
