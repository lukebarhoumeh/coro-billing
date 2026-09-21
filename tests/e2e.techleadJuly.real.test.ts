/**
 * The first REAL outbound-invoice tie: MSP Hub invoice 10618 to TechLead
 * (July 2026 service, sent 09/16/2026, total $3,555.00) vs the rate-card
 * close over the per-partner "by product" July usage export.
 *
 *   Coro Essentials Flex          10 × $3.00  =    $30.00
 *   Coro Managed Complete Flex   344 × $10.00 = $3,440.00
 *   Coro Managed Classic Flex     10 × $8.50  =    $85.00
 *                                        TOTAL  $3,555.00
 *
 * Every rate matches TechLead's special-pricing card col E exactly, and the
 * quantities are the file's billed quantities (children + the partner's own
 * CHANNEL workspace: 337 + 7 = 344). This test is the accuracy anchor Luke
 * asked for on 2026-09-21 ("it's not matching up") — the mismatch he saw was
 * a different partner+month (Net-Tech's August draft, $2,186.40 w/ the held
 * EMAIL_PROTECTION line), not an engine error.
 *
 * Skipped when the (git-ignored) July packet is absent.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSpecialPricing } from "../src/ingest/specialPricing.js";
import { parseUsage } from "../src/ingest/usage.js";
import { closeFromRateCard } from "../src/close/rateCardClose.js";
import { isOk } from "../src/lib/result.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRICING = join(__dirname, "..", "data", "2026-08", "Coro Special MSP Pricing(Special Pricing).csv");
const JULY_USAGE = join(
  __dirname, "..", "data", "2026-07",
  "Techlead Professional Services, LLC__Usage_July_2026_by_product.xlsx"
);

const hasData = existsSync(PRICING) && existsSync(JULY_USAGE);

describe.skipIf(!hasData)("TechLead July 2026 — ties MSP Hub invoice 10618 to the cent", () => {
  function build() {
    const pricing = parseSpecialPricing(readFileSync(PRICING, "utf8"), "2026-07");
    if (!isOk(pricing)) throw new Error("pricing parse failed");
    const usage = parseUsage({ buffer: readFileSync(JULY_USAGE) }, { period: "2026-07" });
    if (!isOk(usage)) throw new Error(`usage parse failed: ${usage.error.message}`);
    return closeFromRateCard({ pricing: pricing.value, usage: usage.value, period: "2026-07" });
  }

  it("parses the by-product export and drafts exactly one partner", () => {
    const model = build();
    expect(model.usageOnly).toEqual([]);
    expect(model.partners).toHaveLength(1);
    expect(model.partners[0]!.cardName).toBe("TechLead Professional Services LLC");
  });

  it("reproduces invoice 10618: $3,555.00, line for line", () => {
    const draft = build().partners[0]!;
    expect(draft.totalL.toFixed2()).toBe("3555.00");
    expect(draft.heldLines).toBe(0);

    const bySku = new Map(draft.lines.map((l) => [l.vendorSku, l]));
    const complete = bySku.get("BUCOMMNGflex")!;
    expect(complete.quantity).toBe(344); // 337 children + 7 on the partner's own workspace
    expect(complete.unitL!.toFixed2()).toBe("10.00");
    expect(complete.amountL!.toFixed2()).toBe("3440.00");

    const classic = bySku.get("BUCOCLASSMNflex")!;
    expect(classic.quantity).toBe(10);
    expect(classic.unitL!.toFixed2()).toBe("8.50");

    const essentials = bySku.get("BUCOROflex")!;
    expect(essentials.quantity).toBe(10);
    expect(essentials.unitL!.toFixed2()).toBe("3.00");

    // MDR consumed at qty 0 — priced (assumed Modules chain), zero dollars.
    const mdr = bySku.get("ADDMDRflex")!;
    expect(mdr.quantity).toBe(0);
    expect(mdr.amountL!.isZero()).toBe(true);
  });

  it("keeps the customer breakdown (17 child workspaces + the partner's own)", () => {
    const complete = build()
      .partners[0]!.lines.find((l) => l.vendorSku === "BUCOMMNGflex")!;
    expect(complete.customers.length).toBe(18);
    expect(complete.customers[0]!.customer).toBeNull(); // partner workspace first, qty 7
    expect(complete.customers[0]!.quantity).toBe(7);
    const sum = complete.customers.reduce((s, c) => s + c.quantity, 0);
    expect(sum).toBe(344);
  });
});
