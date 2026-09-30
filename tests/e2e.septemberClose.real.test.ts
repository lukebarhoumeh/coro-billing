/**
 * Rate-card close over the REAL September 2026 packet (skipped when data/
 * absent — the real files are git-ignored; see .gitignore).
 *
 * The packet landed 2026-09-29 via Lita's forward of Lisa's (Coro) email +
 * the Luke/Lindita call (data/Coro Billing - Luke and Lindita (2026-09-29)
 * .docx): Jack's revised special pricing CSV (45 partner blocks — every new
 * parent now carries rates), the September usage report, and Coro invoice
 * INVCUS2026-0002512 ($20,594.49) transcribed from PDF with credit memo
 * CMCUS2026-0000106 (−$84.83, Albany IT Email Protection repriced 45% → 58%
 * total) netted in as a qty-0 row — Balance Due $20,509.66.
 *
 * Every number here was DERIVED from the packet and then pinned. What the
 * assertions encode:
 *   - all 25 usage workspaces join the new sheet (9 parents new since August);
 *   - S3's 94 × MANAGED CORO ESSENTIALS Flex was held (S-3's card has no
 *     managed-essentials rate) until Brandon (Coro) supplied it 2026-09-30 —
 *     now billed off-card at $5.50 (config/offCardRates.ts), cost $4.88, so the
 *     ~$5.78 Coro invoiced ($542.85) adds an $84.13 credit; ZERO lines held;
 *   - Albany IT nets to the corrected cost (87 × 3.15 = 274.05) — the ONE
 *     legacy-discount fix Coro has processed; no credit-expected remains;
 *   - CREDIT_EXPECTED $1,875.66 over 5 partners — the "other changes we are
 *     working on with some of the legacy discounts" per Lisa's email
 *     (ICT $1,329.30 alone: 1,266 Essentials Flex billed flat-45 vs 54+5; S-3
 *     now $372.51 incl. the $84.13 managed-essentials cost gap);
 *   - Lita said on the call our cost should be the invoice's $20,594.49 and
 *     "bill to Partner should be higher" — drafted L $21,732.71 is;
 *   - margin is cash-true (actual where invoiced): $1,223.05, three partners
 *     negative until Coro's remaining credits land;
 *   - BeNe International consumed (73 AI Complete) but is absent from
 *     invoice 2512 — margin rides the expected-additive basis; raised with
 *     Coro (churn or a Coro miss?);
 *   - Coro billed Hub's own workspace $602.25 (73 AI Complete, "MSP Hub -
 *     Disti/MSP") with no usage row — surfaced as NO_USAGE_BREAKDOWN.
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
const DATA = join(__dirname, "..", "data", "2026-09");
const PRICING = join(DATA, "Coro Special MSP Pricing(Special Pricing).csv");
const USAGE = join(DATA, "MSP Hub_September 2026 Usage.xlsx");
const INV_2512 = join(DATA, "Coro_Invoice_INVCUS2026-0002512.xlsx");

const hasRealData = existsSync(PRICING) && existsSync(USAGE) && existsSync(INV_2512);

function buildModel(): CloseModel {
  const pricingRes = parseSpecialPricing(readFileSync(PRICING, "utf8"), "2026-09");
  if (!isOk(pricingRes)) throw new Error("pricing parse failed");
  const usageRes = parseUsage({ buffer: readFileSync(USAGE) }, { period: "2026-09" });
  if (!isOk(usageRes)) throw new Error("usage parse failed");
  const invRes = parseCoroInvoice(
    { buffer: readFileSync(INV_2512) },
    { invoiceNumber: "INVCUS2026-0002512", period: "2026-09" }
  );
  if (!isOk(invRes)) throw new Error("invoice parse failed");
  return closeFromRateCard({
    pricing: pricingRes.value,
    usage: usageRes.value,
    coroInvoiceLines: invRes.value,
    period: "2026-09",
  });
}

describe.skipIf(!hasRealData)("September 2026 rate-card close — real packet", () => {
  const model = hasRealData ? buildModel() : (null as unknown as CloseModel);

  it("joins every usage workspace to the new sheet — 25 drafts, zero usage-only", () => {
    expect(model.partners).toHaveLength(25);
    expect(model.usageOnly).toEqual([]);
    expect(model.cardOnly).toHaveLength(20); // signed-but-quiet, incl. the still-unlanded new partners
  });

  it("foots the month: L $21,732.71, actual H $19,907.41, margin $1,223.05", () => {
    const totalL = model.partners.reduce((s, p) => s + p.totalL.toNumber(), 0);
    const totalHActual = model.partners.reduce((s, p) => s + (p.totalHActual?.toNumber() ?? 0), 0);
    const totalHExpected = model.partners.reduce((s, p) => s + p.totalHExpected.toNumber(), 0);
    const totalMargin = model.partners.reduce((s, p) => s + p.totalMargin.toNumber(), 0);
    // Lita, on the call: cost is the invoice's 20,594.49, so billed-to-partner
    // "should be higher" — it is. Actual-H is the invoice's in-period matched
    // lines: 20,509.66 (balance due, post-credit) minus the $602.25 Hub-self
    // line (no usage). Two 2026-09-30 corrections lift L over the first packet's
    // 21,151.44: S3's managed-essentials now bills off-card (+517.00 L / +542.85
    // H, was held) and Net-Tech's sell rates match invoice 10625 (+64.27 L, cost
    // unchanged) — so margin rises to 1,223.05.
    expect(totalL.toFixed(2)).toBe("21732.71");
    expect(totalHActual.toFixed(2)).toBe("19907.41");
    expect(totalHExpected.toFixed(2)).toBe("18812.39"); // Money-exact 18,812.40; float sum drops a cent
    expect(totalMargin.toFixed(2)).toBe("1223.05");
  });

  it("holds ZERO lines — S3's managed-essentials now bills off-card (Brandon 2026-09-30)", () => {
    const held = model.partners.flatMap((p) =>
      p.lines
        .filter((l) => l.matchKind !== "nfr" && l.unitL === null)
        .map((l) => `${p.cardName}|${l.vendorSku}`)
    );
    expect(held).toEqual([]);
    // The one-time held line, now resolved from config/offCardRates.ts.
    const s3 = model.partners.find((p) => p.cardName === "S-3")!;
    const mgd = s3.lines.find((l) => l.vendorSku.toLowerCase() === "bucormngflex")!;
    expect(mgd.matchKind).toBe("off-card");
    expect(mgd.unitL!.toFixed2()).toBe("5.50"); // $5.50 to the partner
    expect(mgd.expectedHAdditive!.toFixed2()).toBe("4.88"); // $4.88 to MSP Hub
    expect(mgd.actualHAmount!.toFixed2()).toBe("542.85"); // Coro invoiced 94 × ~5.78
    expect(mgd.creditExpected!.toFixed2()).toBe("84.13"); // the 5.78→4.88 cost gap
  });

  it("Albany IT nets to the corrected 58%-total cost — credit memo CMCUS2026-0000106 landed", () => {
    const albany = model.partners.find((p) => p.cardName === "Albany IT")!;
    const email = albany.lines.find((l) => l.vendorSku.toLowerCase() === "buemailflex")!;
    expect(email.matchKind).toBe("exact"); // "BUEmail Flex" card row, $3.50 sell
    expect(email.unitL!.toFixed2()).toBe("3.50");
    expect(email.amountL!.toFixed2()).toBe("304.50");
    // 358.88 gross − 84.83 credit = 87 × 3.15 = the additive rule exactly:
    expect(email.actualHAmount!.toFixed2()).toBe("274.05");
    expect(email.expectedHAdditive!.toFixed2()).toBe("3.15");
    expect(email.creditExpected).toBeNull(); // fixed — nothing further expected
    expect(albany.totalMargin.toFixed2()).toBe("30.45");
  });

  it("quantifies the remaining legacy over-bills — $1,875.66 over 5 partners", () => {
    // Lisa's 2026-09-29 email: "Brandon can share the other changes we are
    // working on with some of the legacy discounts." This is that list.
    expect(model.totalCreditExpected.toFixed2()).toBe("1875.66");
    const byPartner = Object.fromEntries(
      model.partners
        .filter((p) => p.totalCreditExpected.toCents() !== 0)
        .map((p) => [p.cardName, p.totalCreditExpected.toFixed2()])
    );
    expect(byPartner).toEqual({
      "ForceTech IT, LLC": "0.48",
      ICT: "1329.30", // 1,266 Essentials Flex @ flat 4.125 vs 54+5 → 3.075
      "Net-Tech": "150.00", // same email-protection over-bill as August
      "S-3": "372.51", // 288.38 + the 84.13 off-card managed-essentials cost gap
      "Teledata Cloud Services": "23.38",
    });
  });

  it("Net-Tech drafts to Invoice 10625's $2,180.40 — the corrected sell rates (Coro 2026-09-30)", () => {
    // Lida's revised Net-Tech invoice 10625 (parsed 2026-09-30) is the pricing
    // authority; our confirmedRates were stale on three sell (L) lines.
    const nt = model.partners.find((p) => p.cardName === "Net-Tech")!;
    expect(nt.totalL.toFixed2()).toBe("2180.40"); // ties invoice 10625 to the cent
    const rate = (sku: string) => nt.lines.find((l) => l.vendorSku.toLowerCase() === sku)!.unitL!.toFixed2();
    expect(rate("bucoclassflex")).toBe("7.20"); // $7.20 partner / $6.60 Hub (was 6.59 ≈ cost, ~0 margin)
    expect(rate("buemailflex")).toBe("3.00"); // Email Protection Flex (was 4.12)
    expect(rate("modcloudflex")).toBe("3.00"); // Cloud Security Flex = module $3.00 (was 2.50)
  });

  it("prices Auditlytics COR-USERD-C from the current-gen modules row — and flags Coro's 45%", () => {
    const aud = model.partners.find((p) => p.cardName === "Auditlytics")!;
    const userd = aud.lines.find((l) => l.vendorSku.toLowerCase() === "cor-userd-c")!;
    expect(userd.matchKind).toBe("exact");
    expect(userd.productLabel).toBe("Coro AI Modules");
    expect(userd.unitL!.toFixed2()).toBe("1.92"); // card's 74+5 modules rate
    expect(userd.amountL!.toFixed2()).toBe("132.48");
    // Coro billed it at flat 45% ($4.13 → $284.63) — 2.6× the card's additive
    // rate. Current-gen, so not auto-credited; surfaced for the Brandon list:
    expect(userd.actualHAmount!.toFixed2()).toBe("284.63");
    expect(userd.findings.some((f) => f.kind === "INVOICE_RATE_UNEXPECTED")).toBe(true);
  });

  it("BeNe International consumed but is missing from invoice 2512 — expected-basis margin", () => {
    const bene = model.partners.find((p) => p.cardName === "BeNe International")!;
    expect(bene.totalL.toFixed2()).toBe("876.00"); // 73 AI Complete × 12.00
    expect(bene.totalHActual).toBeNull();
    expect(bene.lines.every((l) => l.marginBasis === "expected-additive")).toBe(true);
  });

  it("surfaces Coro billing Hub's own workspace — $602.25 with no usage behind it", () => {
    const selfBill = model.findings.filter(
      (f) => f.kind === "NO_USAGE_BREAKDOWN" && f.partner === "MSP Hub - Disti/MSP"
    );
    expect(selfBill).toHaveLength(1);
    expect(selfBill[0]!.message).toContain("73");
  });

  it("stays cash-true: three partners negative until Coro's remaining credits land", () => {
    const negative = model.partners
      .filter((p) => p.totalMargin.isNegative())
      .map((p) => p.cardName)
      .sort();
    // ICT flips +$558.15 and S-3 +$147.96 once their credits land; Auditlytics
    // hinges on the COR-USERD-C rate question above.
    expect(negative).toEqual(["Auditlytics", "ICT", "S-3"]);
  });

  it("surfaces the real finding histogram — nothing silently resolved", () => {
    const hist: Record<string, number> = {};
    for (const f of model.findings) hist[f.kind] = (hist[f.kind] ?? 0) + 1;
    expect(hist).toEqual({
      SHEET_MATH_INCONSISTENT: 329, // the new sheet's col-H cells drift from BOTH rules — reference only
      LIST_PRICE_DIVERGES: 2,
      AUDIT_QTY_MISMATCH: 11, // self-contradictory audit strings (same class as August's 8)
      INVOICE_RATE_UNEXPECTED: 9, // Auditlytics USERD 45%, CC endpoint 63%, Live-Tech/S-3 module under-bills
      INVOICE_QTY_DISAGREES: 1, // Computer Central endpoint: audit 166 vs invoiced 167
      PRODUCT_FALLBACK: 3,
      CREDIT_EXPECTED: 7, // $1,875.66 — pending Brandon corrections + S3 off-card cost gap
      RATE_OVERRIDE_APPLIED: 6, // was 8; −3 Net-Tech now match the card (10625), +1 S3 off-card
      NFR_LINE: 1, // Hurricane IT
      NO_USAGE_BREAKDOWN: 1, // the Hub self-bill
    });
  });

  it("emits 246 rated lines for QuickBooks and is deterministic", () => {
    expect(model.ratedLines).toHaveLength(246);
    expect(buildModel()).toEqual(model);
  });
});
