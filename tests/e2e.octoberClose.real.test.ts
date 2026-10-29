/**
 * Rate-card close over the REAL October 2026 packet (skipped when data/
 * absent — the xlsx files are git-ignored; see .gitignore).
 *
 * The packet landed 2026-10-28: Coro's invoice INVCUS2026-0002995 ($28,404.60,
 * due Dec 11) via NetSuite that morning, the October usage workbook via Lisa's
 * same-day reply to Lida, and the 57-partner special pricing CSV. October is
 * the first GENERATED month (per the 2026-09-29 call: Lita invoices Sept
 * manually, Oct close generates for real).
 *
 * Format shift this month: Coro's usage export became a three-tab workbook
 * (Monthly Snapshot / Aggregation / Usage) and renamed the Usage-tab headers
 * ("Parent", "End-User (Child) Workspace", "Product Quantity", Metric column
 * dropped) — the 2026-10-28 intake rejection Lida screenshotted. Sixteen new
 * parents joined, and three new current-gen codes appeared (COR-NETW-C,
 * COR-ENDDG-C billed at per-partner module nets; COR-SAT-C at a flat $0.68).
 *
 * Every number here was DERIVED from the packet and then pinned:
 *   - all 41 usage parents draft; zero usage-only; 16 card-only (signed-but-quiet);
 *   - ONE held line: Seven Star 233 × COR-SAT-C — their card has no SAT row and
 *     SAT must never silently price from the modules chain (Brandon: SAT is the
 *     only module not priced like a module) — rate requested from Coro;
 *   - Hurricane IT's COR-COMP-NFR-C is NFR (listed, never billed);
 *   - Computer Central AI Endpoint ties the invoice at 171 and the invoice's
 *     2026-09 catch-up line (167 × $0.90 — Coro under-billed Sept at $1.85 vs
 *     the sheet's $2.75, per Brandon's 2026-10-28 explanation) is excluded from
 *     October actual cost as OUT_OF_PERIOD_LINE;
 *   - Logic-IT is margin-NEGATIVE: Coro billed Complete at $5.85/unit vs the
 *     sheet's $3.45 additive — surfaced as INVOICE_RATE_UNEXPECTED, review;
 *   - Coro again invoiced the Hub's own workspace (74 × COR-COMP-C, $610.50,
 *     "MSP Hub - Disti/MSP") with no usage row — the continuing challenge;
 *   - legacy-discount credits are nearly done: CREDIT_EXPECTED is $0.16
 *     (ForceTech MODNETWflex 1.88 vs 1.72) — Brandon's fixes landed;
 *   - GOA-Tech's Classic drafts the card's 7.20 (Lida's 2026-10-29 wrong-price
 *     report: the stale 6.59 confirmed rate — which is the Hub COST — retired
 *     through 2026-09), leaving October with ZERO rate overrides: the whole
 *     month prices straight off the card.
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
const DATA = join(__dirname, "..", "data", "2026-10");
const PRICING = join(DATA, "Coro Special MSP Pricing.csv");
const USAGE = join(DATA, "MSP Hub_October 2026 Usage.xlsx");
const INV_2995 = join(DATA, "Coro_Invoice_INVCUS2026-0002995_Oct2026.xlsx");

const hasRealData = existsSync(PRICING) && existsSync(USAGE) && existsSync(INV_2995);

function buildModel(): CloseModel {
  const pricingRes = parseSpecialPricing(readFileSync(PRICING, "utf8"), "2026-10");
  if (!isOk(pricingRes)) throw new Error("pricing parse failed");
  const usageRes = parseUsage({ buffer: readFileSync(USAGE) }, { period: "2026-10" });
  if (!isOk(usageRes)) throw new Error("usage parse failed");
  const invRes = parseCoroInvoice(
    { buffer: readFileSync(INV_2995) },
    { invoiceNumber: "INVCUS2026-0002995", period: "2026-10" }
  );
  if (!isOk(invRes)) throw new Error("invoice parse failed");
  return closeFromRateCard({
    pricing: pricingRes.value,
    usage: usageRes.value,
    coroInvoiceLines: invRes.value,
    period: "2026-10",
  });
}

describe.skipIf(!hasRealData)("October 2026 rate-card close — real packet", () => {
  const model = hasRealData ? buildModel() : (null as unknown as CloseModel);

  it("parses the new three-tab workbook and joins every parent — 41 drafts, zero unmapped", () => {
    expect(model.partners).toHaveLength(41);
    expect(model.usageOnly).toEqual([]);
    expect(model.cardOnly).toHaveLength(16);
    expect(model.findings.filter((f) => f.kind === "UNMAPPED_PARTNER")).toEqual([]);
  });

  it("foots the month: L $32,247.98, actual H $27,484.89, margin $4,152.59", () => {
    const totalL = model.partners.reduce((s, p) => s + p.totalL.toNumber(), 0);
    const totalHActual = model.partners.reduce((s, p) => s + (p.totalHActual?.toNumber() ?? 0), 0);
    const totalMargin = model.partners.reduce((s, p) => s + p.totalMargin.toNumber(), 0);
    // Invoice 2995 foots to 28,404.60; actual-H joins 27,484.89 of it. The
    // unjoined 919.71 is exactly the three machine-flagged lines: the Hub-self
    // bill 610.50 (no usage), Computer Central's 2026-09 catch-up 150.30
    // (out-of-period), and Seven Star's held SAT 158.91. (L was 32,239.44
    // until 2026-10-29: GOA-Tech's Classic re-drafted 6.59 → 7.20, +8.54.)
    expect(totalL.toFixed(2)).toBe("32247.98");
    expect(totalHActual.toFixed(2)).toBe("27484.89");
    expect(totalMargin.toFixed(2)).toBe("4152.59");
    expect(model.totalCreditExpected.toFixed2()).toBe("0.16");
  });

  it("drafts GOA-Tech's Classic at the card's 7.20 — no rate override anywhere in October", () => {
    // Lida, 2026-10-29: "the app selected the wrong price" — the stale 6.59
    // confirmed rate (= Hub cost, 11.99 × 55%) retired through 2026-09; the
    // card col E (7.20) rules from October on. 14 × 7.20 = 100.80.
    const goa = model.partners.find((p) => p.cardName === "GOA-Tech")!;
    const classic = goa.lines.find((l) => l.vendorSku === "BUCOCLASSflex")!;
    expect(classic.quantity).toBe(14);
    expect(classic.unitL!.toFixed2()).toBe("7.20");
    expect(goa.totalL.toFixed2()).toBe("139.80"); // 100.80 + 3×5.00 + 6×4.00
    expect(model.findings.filter((f) => f.kind === "RATE_OVERRIDE_APPLIED")).toEqual([]);
  });

  it("holds exactly ONE line: Seven Star's 233 × COR-SAT-C (no SAT row — never module-priced)", () => {
    const held = model.partners.flatMap((p) =>
      p.lines
        .filter((l) => l.matchKind !== "nfr" && l.unitL === null)
        .map((l) => `${p.cardName}|${l.vendorSku}|${l.quantity}`)
    );
    expect(held).toEqual(["Seven Star Systems|COR-SAT-C|233"]);
  });

  it("rates the new current-gen codes: NETWORK and ENDPOINT DATA GOVERNANCE price like modules", () => {
    // Invoice 2995 bills both at the partner's exact COR-USERD-C module net —
    // the Coro-confirmed modules premise extended.
    const b2b = model.partners.find((p) => p.cardName === "B2B Technologies")!;
    const netw = b2b.lines.find((l) => l.vendorSku === "COR-NETW-C")!;
    expect(netw.matchKind).toBe("exact");
    expect(netw.quantity).toBe(143);
    expect(netw.actualHUnit!.toFixed2()).toBe("1.58");

    const nerdbee = model.partners.find((p) => p.cardName === "The NerdBee")!;
    const enddg = nerdbee.lines.find((l) => l.vendorSku === "COR-ENDDG-C")!;
    expect(enddg.matchKind).toBe("exact");
    expect(enddg.quantity).toBe(4);

    // S-3's card carries a SAT Flex row — current-gen SAT prices from it.
    const s3 = model.partners.find((p) => p.cardName === "S-3")!;
    const sat = s3.lines.find((l) => l.vendorSku === "COR-SAT-C")!;
    expect(sat.matchKind).toBe("sat-flex");
    expect(sat.unitL!.toFixed2()).toBe("1.40");

    // Hurricane IT's current-gen NFR spelling is recognized — listed, not billed.
    const hurricane = model.partners.find((p) => p.cardName === "Hurricane IT")!;
    expect(hurricane.lines.find((l) => l.vendorSku === "COR-COMP-NFR-C")!.matchKind).toBe("nfr");
  });

  it("ties Computer Central AI Endpoint at 171 and excludes the Sept catch-up from Oct cost", () => {
    const cc = model.partners.find((p) => p.cardName === "Computer Central")!;
    const endp = cc.lines.find((l) => l.vendorSku === "COR-ENDP-C")!;
    expect(endp.quantity).toBe(171);
    expect(endp.invoiceQuantity).toBe(171);
    expect(endp.actualHAmount!.toFixed2()).toBe("470.25"); // 171 × 2.75, catch-up excluded
    const oop = model.findings.filter((f) => f.kind === "OUT_OF_PERIOD_LINE");
    expect(oop).toHaveLength(1);
    expect(oop[0]!.partner).toBe("Computer Central");
  });

  it("surfaces the review set: Logic-IT over-bill, Hub self-bill, three unexpected invoice rates", () => {
    // Logic-IT: Coro billed Complete at 5.85 vs the sheet's 3.45 — the draft is
    // margin-negative until Coro reviews (L 2,198.00 vs actual H 2,287.50).
    const logicIt = model.partners.find((p) => p.cardName === "Logic-IT")!;
    expect(logicIt.totalL.toFixed2()).toBe("2198.00");
    expect(logicIt.totalHActual!.toFixed2()).toBe("2287.50");
    const rateFindings = model.findings.filter((f) => f.kind === "INVOICE_RATE_UNEXPECTED");
    expect(rateFindings).toHaveLength(3);
    expect(rateFindings.map((f) => f.partner).sort()).toEqual(["1Wire", "Logic-IT", "S-3"]);

    const noUsage = model.findings.filter((f) => f.kind === "NO_USAGE_BREAKDOWN");
    expect(noUsage).toHaveLength(1);
    expect(noUsage[0]!.partner).toBe("MSP Hub - Disti/MSP"); // 74 × COR-COMP-C, $610.50
  });
});
