/**
 * Rate-card close over the REAL August 2026 packet (skipped when data/ absent —
 * the real files are git-ignored; see .gitignore).
 *
 * Every number here was DERIVED from the packet on 2026-09-21 and then pinned:
 * a parser or close regression fails against ground truth, not toys. Notable
 * business facts these assertions encode:
 *   - all 16 usage workspaces join the special-pricing CSV (usageOnly empty);
 *   - drafted revenue $13,376.40 vs actual Coro cost $12,286.13 → margin $884.02;
 *   - Rocker ties invoice 2193 line 1 to the cent (46 × $6.40 = $294.40 billed,
 *     $255.30 cost, $39.10 margin);
 *   - four partners draft margin-NEGATIVE under the current card (TechLead,
 *     Evolve, XTB, Teledata) — real findings, not bugs;
 *   - exactly two lines are HELD: Net-Tech BUEMAILflex and Cyber Construction
 *     BUCOCLASSMNflex have no rate row on their cards;
 *   - the two July Rocker lines on invoice 2193 are excluded as out-of-period.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSpecialPricing } from "../src/ingest/specialPricing.js";
import { parseUsage } from "../src/ingest/usage.js";
import { parseCoroInvoice } from "../src/ingest/coroInvoice.js";
import { closeFromRateCard } from "../src/close/rateCardClose.js";
import { isOk } from "../src/lib/result.js";
import type { CloseModel } from "../src/domain/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data", "2026-08");
const PRICING = join(DATA, "Coro Special MSP Pricing(Special Pricing).csv");
const USAGE = join(DATA, "MSP Hub_August 2026 Usage.xlsx");
const INV_2193 = join(DATA, "Coro_Invoice_INVCUS2026-0002193.xlsx");

const hasRealData = existsSync(PRICING) && existsSync(USAGE) && existsSync(INV_2193);

function buildModel(): CloseModel {
  const pricingRes = parseSpecialPricing(readFileSync(PRICING, "utf8"), "2026-08");
  if (!isOk(pricingRes)) throw new Error("pricing parse failed");
  const usageRes = parseUsage({ buffer: readFileSync(USAGE) }, { period: "2026-08" });
  if (!isOk(usageRes)) throw new Error("usage parse failed");
  const invRes = parseCoroInvoice(
    { buffer: readFileSync(INV_2193) },
    { invoiceNumber: "INVCUS2026-0002193", period: "2026-08" }
  );
  if (!isOk(invRes)) throw new Error("invoice parse failed");
  return closeFromRateCard({
    pricing: pricingRes.value,
    usage: usageRes.value,
    coroInvoiceLines: invRes.value,
    period: "2026-08",
  });
}

describe.skipIf(!hasRealData)("August 2026 rate-card close — real packet", () => {
  const model = hasRealData ? buildModel() : (null as unknown as CloseModel);

  it("joins every usage workspace to the rate card — 16 drafts, zero usage-only", () => {
    expect(model.partners).toHaveLength(16);
    expect(model.usageOnly).toEqual([]);
    expect(model.cardOnly).toHaveLength(26); // signed-but-quiet partners, incl. Seven Star
    expect(model.cardOnly.map((p) => p.name)).toContain("Seven Star Systems");
  });

  it("foots the month: L $13,376.40, actual H $12,286.13, margin $884.02", () => {
    const totalL = model.partners.reduce((s, p) => s + p.totalL.toNumber(), 0);
    const totalHActual = model.partners.reduce((s, p) => s + (p.totalHActual?.toNumber() ?? 0), 0);
    const totalHExpected = model.partners.reduce((s, p) => s + p.totalHExpected.toNumber(), 0);
    const totalMargin = model.partners.reduce((s, p) => s + p.totalMargin.toNumber(), 0);
    expect(totalL.toFixed(2)).toBe("13376.40");
    // 12,492.38 = 12,286.13 + AVOX's 2193 line ($206.25), which attaches since
    // the vaimancom → "AVOX LLC" map fix (2026-09-21).
    expect(totalHActual.toFixed(2)).toBe("12492.38");
    expect(totalHExpected.toFixed(2)).toBe("11697.87");
    expect(totalMargin.toFixed(2)).toBe("884.02");
  });

  it("ties Rocker to invoice 2193 line 1 to the cent", () => {
    const rocker = model.partners.find((p) => p.cardName === "Rocker")!;
    expect(rocker.totalL.toFixed2()).toBe("294.40"); // 46 × $6.40
    expect(rocker.totalHActual!.toFixed2()).toBe("255.30");
    expect(rocker.totalMargin.toFixed2()).toBe("39.10");
  });

  it("prices Amplivity MODNETWflex from its product-specific 'Network Flex' row", () => {
    const amplivity = model.partners.find((p) => p.cardName === "Amplivity")!;
    const mod = amplivity.lines.find((l) => l.vendorSku.toLowerCase() === "modnetwflex")!;
    expect(mod.matchKind).toBe("specific-flex");
    expect(mod.productLabel).toBe("Network Flex");
    expect(mod.unitL!.toFixed2()).toBe("3.00");
  });

  it("prices Evolve Modsatflex from its 'SAT Flex' row", () => {
    const evolve = model.partners.find((p) => p.cardName === "Evolve Technologies")!;
    const sat = evolve.lines.find((l) => l.vendorSku.toLowerCase() === "modsatflex")!;
    expect(sat.matchKind).toBe("sat-flex");
    expect(sat.unitL!.toFixed2()).toBe("1.40");
  });

  it("HOLDS exactly the two lines whose cards have no rate row", () => {
    const held = model.partners.flatMap((p) =>
      p.lines
        .filter((l) => l.matchKind === "none" || (l.matchKind !== "nfr" && l.unitL === null))
        .map((l) => `${p.cardName}|${l.vendorSku}`)
    );
    expect(held.sort()).toEqual([
      "Cyber Construction|BUCOCLASSMNflex",
      "Net-Tech|BUEMAILflex",
    ]);
  });

  it("surfaces the real finding histogram — nothing silently resolved", () => {
    const hist: Record<string, number> = {};
    for (const f of model.findings) hist[f.kind] = (hist[f.kind] ?? 0) + 1;
    expect(hist).toEqual({
      SHEET_MATH_INCONSISTENT: 46,
      EMPTY_PARTNER_BLOCK: 1,
      AUDIT_QTY_MISMATCH: 8,
      INVOICE_RATE_UNEXPECTED: 24,
      ASSUMED_MAPPING: 2,
      UNKNOWN_PRODUCT_CODE: 2,
      PRODUCT_FALLBACK: 3,
      NFR_LINE: 1,
      OUT_OF_PERIOD_LINE: 2, // the two July Rocker lines on invoice 2193
      // NO_USAGE_BREAKDOWN gone: the "AVOX LLC" invoice line was always backed
      // by vaimancom usage — the curated map just called it "Vaiman" (fixed).
    });
  });

  it("drafts four margin-negative partners — real business findings", () => {
    const negative = model.partners
      .filter((p) => p.totalMargin.isNegative())
      .map((p) => p.cardName)
      .sort();
    expect(negative).toEqual([
      "Evolve Technologies",
      "TechLead Professional Services LLC",
      "Teledata Cloud Services",
      "XTB Solutions",
    ]);
  });

  it("emits 149 rated lines for QuickBooks and is deterministic", () => {
    expect(model.ratedLines).toHaveLength(149);
    expect(buildModel()).toEqual(model);
  });
});
