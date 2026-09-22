/**
 * Rate-card close over the REAL August 2026 packet (skipped when data/ absent —
 * the real files are git-ignored; see .gitignore).
 *
 * Every number here was DERIVED from the packet and then pinned: a parser or
 * close regression fails against ground truth, not toys. Re-pinned 2026-09-22
 * after Coro answered the clarification letter and sent the corrected sheet
 * (docs/superpowers/specs/2026-09-22-coro-answers-adoption.md). What the
 * assertions encode now:
 *   - all 16 usage workspaces join the corrected special-pricing CSV;
 *   - ZERO held lines: Net-Tech "BUEmail Flex" and Cyber Construction
 *     "Managed Coro Classic" rows exist (+$402.00 drafted), and CC's
 *     BUCOCLASSflex prices through the signature-guarded mislabel override
 *     (Coro renamed the $11.99 Classic row "Modules Flex");
 *   - drafted revenue $13,778.40 vs actual Coro cost $12,998.33 → margin
 *     $780.07. Actual H rose because the two formerly-held lines now attach
 *     their invoice actuals — Coro HAS been billing Net-Tech email protection
 *     ($412.50/mo at the flat legacy rate) while the line was unbillable;
 *   - CREDIT_EXPECTED $1,041.38 over 10 legacy lines (answer c: partner
 *     discounts apply to legacy; Coro's flat-rate invoicing over-billed) —
 *     Evolve $95.00, Net-Tech $150.00, TechLead $695.00, Teledata $25.00,
 *     XTB $76.38. Margin stays cash-true until the credit memos land;
 *   - TechLead's Managed Classic line is NOT credited (Classic family = flat
 *     45% regardless, answer c) but its 50/5 card row is flagged;
 *   - the four margin-negative partners persist on actual basis — post-credit
 *     they flip positive except TechLead's Classic sell price ($8.50 < $9.34);
 *   - the two July Rocker lines on invoice 2193 stay out-of-period.
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

  it("foots the month: L $13,778.40, actual H $12,998.33, margin $780.07", () => {
    const totalL = model.partners.reduce((s, p) => s + p.totalL.toNumber(), 0);
    const totalHActual = model.partners.reduce((s, p) => s + (p.totalHActual?.toNumber() ?? 0), 0);
    const totalHExpected = model.partners.reduce((s, p) => s + p.totalHExpected.toNumber(), 0);
    const totalMargin = model.partners.reduce((s, p) => s + p.totalMargin.toNumber(), 0);
    // 13,778.40 = the 2026-09-21 close's 13,376.40 + Net-Tech BUEmail 100×$3.00
    // + Cyber Construction Managed Coro Classic 10×$10.20 (both formerly HELD).
    expect(totalL.toFixed(2)).toBe("13778.40");
    // 12,998.33 = prior 12,492.38 + NT email actual 412.50 + CC classmn 93.45
    // (held lines never attached their invoice actuals; billable lines do).
    expect(totalHActual.toFixed(2)).toBe("12998.33");
    expect(totalHExpected.toFixed(2)).toBe("12070.82");
    // 780.07 = prior 884.02 − 112.50 (NT email: bill $300 vs Coro's $412.50
    // until the credit lands) + 8.55 (CC classmn $102.00 − $93.45).
    expect(totalMargin.toFixed(2)).toBe("780.07");
  });

  it("quantifies the expected Coro credits — $1,041.38 over 5 partners (answer c)", () => {
    expect(model.totalCreditExpected.toFixed2()).toBe("1041.38");
    const byPartner = Object.fromEntries(
      model.partners
        .filter((p) => p.totalCreditExpected.toCents() !== 0)
        .map((p) => [p.cardName, p.totalCreditExpected.toFixed2()])
    );
    expect(byPartner).toEqual({
      "Evolve Technologies": "95.00",
      "Net-Tech": "150.00",
      "TechLead Professional Services LLC": "695.00",
      "Teledata Cloud Services": "25.00",
      "XTB Solutions": "76.38",
    });
  });

  it("Classic family is flat-45 regardless (answer c): TechLead's line costs 9.34, no credit", () => {
    const techlead = model.partners.find((p) => p.cardName.startsWith("TechLead"))!;
    const classic = techlead.lines.find((l) => l.vendorSku.toLowerCase() === "bucoclassmnflex")!;
    expect(classic.expectedHAdditive!.toFixed2()).toBe("9.34"); // 16.99×0.55, card's 50/5 overridden
    expect(classic.creditExpected).toBeNull();
    expect(classic.findings.some((f) => f.kind === "CLASSIC_RATE_RULE_DISAGREES")).toBe(true);
  });

  it("ties Rocker to invoice 2193 line 1 to the cent", () => {
    const rocker = model.partners.find((p) => p.cardName === "Rocker")!;
    expect(rocker.totalL.toFixed2()).toBe("294.40"); // 46 × $6.40
    expect(rocker.totalHActual!.toFixed2()).toBe("255.30");
    expect(rocker.totalMargin.toFixed2()).toBe("39.10");
  });

  it("prices Amplivity MODNETWflex from the generic row (Coro renamed 'Network Flex')", () => {
    // Same $3.00 either way — the 2026-09-22 sheet renamed Amplivity's
    // "Network Flex" row to "Modules Flex", so the specific-flex chain dangles.
    const amplivity = model.partners.find((p) => p.cardName === "Amplivity")!;
    const mod = amplivity.lines.find((l) => l.vendorSku.toLowerCase() === "modnetwflex")!;
    expect(mod.matchKind).toBe("modules-flex");
    expect(mod.productLabel).toBe("Modules Flex");
    expect(mod.unitL!.toFixed2()).toBe("3.00");
  });

  it("prices Evolve Modsatflex from its 'SAT Flex' row", () => {
    const evolve = model.partners.find((p) => p.cardName === "Evolve Technologies")!;
    const sat = evolve.lines.find((l) => l.vendorSku.toLowerCase() === "modsatflex")!;
    expect(sat.matchKind).toBe("sat-flex");
    expect(sat.unitL!.toFixed2()).toBe("1.40");
  });

  it("holds NOTHING — the two formerly-held lines now bill from the corrected sheet", () => {
    const held = model.partners.flatMap((p) =>
      p.lines
        .filter((l) => l.matchKind === "none" || (l.matchKind !== "nfr" && l.unitL === null))
        .map((l) => `${p.cardName}|${l.vendorSku}`)
    );
    expect(held).toEqual([]);

    const netTech = model.partners.find((p) => p.cardName === "Net-Tech")!;
    const email = netTech.lines.find((l) => l.vendorSku.toLowerCase() === "buemailflex")!;
    expect(email.matchKind).toBe("exact"); // new "BUEmail Flex" row
    expect(email.unitL!.toFixed2()).toBe("3.00");
    expect(email.amountL!.toFixed2()).toBe("300.00");
    // Coro was billing this all along at the flat legacy 7.50×0.55 = 4.125:
    expect(email.actualHAmount!.toFixed2()).toBe("412.50");
    expect(email.creditExpected!.toFixed2()).toBe("150.00"); // 412.50 − 2.625×100

    const cc = model.partners.find((p) => p.cardName === "Cyber Construction")!;
    const classmn = cc.lines.find((l) => l.vendorSku.toLowerCase() === "bucoclassmnflex")!;
    expect(classmn.matchKind).toBe("exact"); // new "Managed Coro Classic" row
    expect(classmn.unitL!.toFixed2()).toBe("10.20");
    // CC's old "Coro Classic Flex" row is now NAMED "Modules Flex" ($11.99 list)
    // — priced through the signature-guarded mislabel override, same values:
    const classf = cc.lines.find((l) => l.vendorSku.toLowerCase() === "bucoclassflex")!;
    expect(classf.matchKind).toBe("mislabel-override");
    expect(classf.unitL!.toFixed2()).toBe("7.20");
    // and CC's MOD/ADD lines price from the true modules row, not the mislabel:
    const modline = cc.lines.find((l) => l.vendorSku.toLowerCase() === "modcloudflex")!;
    expect(modline.productLabel).toBe("Coro Module Flex");
    expect(modline.unitL!.toFixed2()).toBe("3.00");
  });

  it("surfaces the real finding histogram — nothing silently resolved", () => {
    const hist: Record<string, number> = {};
    for (const f of model.findings) hist[f.kind] = (hist[f.kind] ?? 0) + 1;
    expect(hist).toEqual({
      SHEET_MATH_INCONSISTENT: 46, // same count, different rows — Coro fixed the
      // Seven Star/DK col-I errors but the new rows' additive-H cells ≠ E×0.95
      LIST_PRICE_DIVERGES: 1, // CC's mislabeled $11.99 "Modules Flex" vs $7.50 elsewhere
      AUDIT_QTY_MISMATCH: 8, // the 8 self-contradictory audit strings (call item)
      INVOICE_RATE_UNEXPECTED: 14, // was 24 — the 10 legacy over-bills are CREDIT_EXPECTED
      // now; the rest are the $2.20 MOD under-bills (legacy list question, call item)
      CREDIT_EXPECTED: 10, // $1,041.38 — answer (c) over-bills awaiting Coro credit memos
      CLASSIC_RATE_RULE_DISAGREES: 1, // TechLead's 50/5 Managed Classic row
      SHEET_MISLABEL_OVERRIDE: 1, // CC BUCOCLASSflex via the renamed Classic row
      PRODUCT_FALLBACK: 3,
      NFR_LINE: 1,
      OUT_OF_PERIOD_LINE: 2, // the two July Rocker lines on invoice 2193
      // EMPTY_PARTNER_BLOCK gone (stray "XTB" row removed), UNKNOWN_PRODUCT_CODE
      // gone (zero held), ASSUMED_MAPPING retired (ADD* = modules, confirmed).
      // CLIENT_PRICE_DIFFERS 33→35: the two unheld lines join (team keyed
      // NT email at the 4.12 cost pass-through vs card 3.00; CC classmn 9.35 vs 10.20).
      CLIENT_PRICE_DIFFERS: 35,
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

  it("emits 153 rated lines for QuickBooks and is deterministic", () => {
    // 149 + the customer shares of the two formerly-held lines
    expect(model.ratedLines).toHaveLength(153);
    expect(buildModel()).toEqual(model);
  });
});
