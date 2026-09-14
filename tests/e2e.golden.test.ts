/**
 * End-to-end GOLDEN test — the whole pipeline over the synthetic trio.
 *
 * This is the automated stand-in for Dane's acceptance test (README §3): "recreate
 * the August invoice and see any discrepancies we have against Lita's manual one."
 * It runs ingest → rating → invoicing → reconcile → export against
 * `fixtures/synthetic/build.ts` (SYNTHETIC — not real Coro/partner data) and asserts:
 *
 *   (a) the consistent trio reconciles CENT-EXACT: matched === true, total cents
 *       diff === 0;
 *   (b) the discrepancy trio does NOT match: matched === false, with the expected
 *       legacy "$6 vs $9" `charge` Discrepancy AND a MISSING_RATE_CARD_ROW exception;
 *   plus invoicing groups by partner and breaks down by customer, and the QuickBooks
 *   CSV row count equals the total number of invoice lines.
 */
import { describe, it, expect } from "vitest";

import {
  parseUsage,
  parseRateCard,
  parseLinditaWorkbook,
  buildRateCard,
  applyRates,
  buildInvoices,
  reconcileAgainstLindita,
  toQuickBooksCsv,
  defaultConfig,
  isOk,
} from "../src/index.js";
import type { QbInvoice } from "../src/index.js";
import { buildConsistentTrio, buildDiscrepancyTrio } from "../fixtures/synthetic/build.js";

/** Total invoice lines across all invoices (the per-customer breakdown lines). */
function totalInvoiceLines(invoices: readonly QbInvoice[]): number {
  return invoices.reduce((n, inv) => n + inv.lines.length, 0);
}

/** Count the CSV data rows (everything after the header line), tolerant of a trailing newline. */
function csvDataRowCount(csv: string): number {
  const lines = csv.split(/\r\n|\n/).filter((l) => l.length > 0);
  // First line is the header; the rest are one-per-invoice-line data rows.
  return Math.max(0, lines.length - 1);
}

describe("e2e golden — pipeline over the synthetic trio", () => {
  it("(a) reproduces Lindita CENT-EXACT: matched === true, diff total cents === 0", () => {
    const trio = buildConsistentTrio("2026-08");
    const cfg = defaultConfig(trio.period);

    // --- Ingest -------------------------------------------------------------
    const usageRes = parseUsage(trio.usage, { period: trio.period });
    const rateRes = parseRateCard(trio.rateCard, { period: trio.period });
    const linditaRes = parseLinditaWorkbook(trio.lindita, { period: trio.period });
    expect(isOk(usageRes)).toBe(true);
    expect(isOk(rateRes)).toBe(true);
    expect(isOk(linditaRes)).toBe(true);
    if (!isOk(usageRes) || !isOk(rateRes) || !isOk(linditaRes)) return;

    // --- Rate + invoice -----------------------------------------------------
    const rateCard = buildRateCard(rateRes.value);
    const { rated, exceptions } = applyRates(usageRes.value, rateCard, cfg);

    // The consistent trio carries NO blocking exceptions — every line prices cleanly.
    const blocking = exceptions.filter((e) => e.severity === "block");
    expect(blocking).toEqual([]);

    // --- Reconcile (the acceptance test) ------------------------------------
    const report = reconcileAgainstLindita([...rated], linditaRes.value, cfg);

    expect(report.matched).toBe(true);
    expect(report.discrepancies).toEqual([]);
    expect(report.onlyInOurs).toEqual([]);
    expect(report.onlyInLindita).toEqual([]);
    // Diff total cents === 0: our extended charge total ties to Lindita's cent-exact.
    expect(report.totalOurs.centsDiff(report.totalLindita).toCents()).toBe(0);
    expect(report.totalOurs.equalsCents(report.totalLindita)).toBe(true);
  });

  it("(a) invoicing groups by partner and breaks down by customer; CSV row count === total invoice lines", () => {
    const trio = buildConsistentTrio("2026-08");
    const cfg = defaultConfig(trio.period);

    const usageRes = parseUsage(trio.usage, { period: trio.period });
    const rateRes = parseRateCard(trio.rateCard, { period: trio.period });
    expect(isOk(usageRes) && isOk(rateRes)).toBe(true);
    if (!isOk(usageRes) || !isOk(rateRes)) return;

    const rateCard = buildRateCard(rateRes.value);
    const { rated } = applyRates(usageRes.value, rateCard, cfg);
    const invoices = buildInvoices([...rated], trio.period);

    // One invoice per partner (MSP). Our consistent trio has Acme + Globex = 2.
    const partners = new Set(invoices.map((i) => i.partner));
    expect(partners).toEqual(new Set(["Acme MSP", "Globex MSP"]));
    expect(invoices).toHaveLength(2);

    // Broken down by customer: at least one Acme invoice line names each Acme workspace.
    const acme = invoices.find((i) => i.partner === "Acme MSP")!;
    const acmeCustomers = new Set(acme.lines.map((l) => l.customer));
    expect(acmeCustomers).toEqual(new Set(["Acme Retail", "Acme Logistics"]));

    // QuickBooks CSV: one row per invoice line (plus a header).
    const csv = toQuickBooksCsv([...invoices], { invoiceDate: "2026-09-01", termsDays: 30 });
    expect(csvDataRowCount(csv)).toBe(totalInvoiceLines(invoices));
    // Sanity: the banner-free CSV names the MSP (partner) as the QuickBooks Customer.
    expect(csv).toContain("Acme MSP");
    expect(csv).toContain("Globex MSP");
    // Regression: the by-customer breakdown in ItemDescription names the workspace
    // exactly ONCE — never double-prefixed (e.g. "Acme Retail — Acme Retail — ...").
    expect(csv).toContain("Acme Retail");
    expect(csv).not.toContain("Acme Retail — Acme Retail");
  });

  it("(b) flags the legacy $6-vs-$9 charge Discrepancy and a MISSING_RATE_CARD_ROW exception; matched === false", () => {
    const trio = buildDiscrepancyTrio("2026-08");
    const cfg = defaultConfig(trio.period);

    const usageRes = parseUsage(trio.usage, { period: trio.period });
    const rateRes = parseRateCard(trio.rateCard, { period: trio.period });
    const linditaRes = parseLinditaWorkbook(trio.lindita, { period: trio.period });
    expect(isOk(usageRes) && isOk(rateRes) && isOk(linditaRes)).toBe(true);
    if (!isOk(usageRes) || !isOk(rateRes) || !isOk(linditaRes)) return;

    const rateCard = buildRateCard(rateRes.value);
    const { rated, exceptions } = applyRates(usageRes.value, rateCard, cfg);

    // Fault (ii): the unpriced Initech SKU has no rate-card row → MISSING_RATE_CARD_ROW.
    const missing = exceptions.filter((e) => e.kind === "MISSING_RATE_CARD_ROW");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.partner).toBe("Initech MSP");
    expect(missing[0]!.sku).toBe("CORO-UNPRICED-NEW");
    expect(missing[0]!.severity).toBe("block");

    // --- Reconcile ----------------------------------------------------------
    const report = reconcileAgainstLindita([...rated], linditaRes.value, cfg);
    expect(report.matched).toBe(false);

    // Fault (i): exactly the legacy SIEM `charge` discrepancy — $6 (ours, from the
    // rate card) vs $9 (Lindita). It is a legacy line, so it is EXPLAINED, not bare.
    const chargeDiscs = report.discrepancies.filter((d) => d.field === "charge");
    expect(chargeDiscs).toHaveLength(1);
    const disc = chargeDiscs[0]!;
    expect(disc.sku).toBe("CORO-LEGACY-SIEM");
    expect(disc.ours).toBe("6.00");
    expect(disc.lindita).toBe("9.00");
    expect(disc.centsDiff).toBe(300); // |$9 − $6| = 300 cents
    expect(disc.explanation).toBeDefined();
    expect(disc.explanation).toMatch(/legacy/i);

    // The unpriced usage row is only in ours (it is not on Lindita's file).
    expect(report.onlyInOurs.some((r) => r.sku.vendorSku === "CORO-UNPRICED-NEW")).toBe(true);
    // And it never fabricated a rate: H and L are zero on that line.
    const unpriced = report.onlyInOurs.find((r) => r.sku.vendorSku === "CORO-UNPRICED-NEW")!;
    expect(unpriced.hubCost.isZero()).toBe(true);
    expect(unpriced.mspPrice.isZero()).toBe(true);
  });
});
