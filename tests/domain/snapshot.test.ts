import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotFromClose, CloseSnapshotSchema } from "../../src/domain/snapshot.js";
import { parseSpecialPricing } from "../../src/ingest/specialPricing.js";
import { parseUsage } from "../../src/ingest/usage.js";
import { parseCoroInvoice } from "../../src/ingest/coroInvoice.js";
import { closeFromRateCard } from "../../src/close/rateCardClose.js";
import { isOk } from "../../src/lib/result.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "..", "data", "2026-08");
const hasRealData = existsSync(join(DATA, "MSP Hub_August 2026 Usage.xlsx"));

function realModel() {
  const pricing = parseSpecialPricing(
    readFileSync(join(DATA, "Coro Special MSP Pricing(Special Pricing).csv"), "utf8"), "2026-08");
  const usage = parseUsage({ buffer: readFileSync(join(DATA, "MSP Hub_August 2026 Usage.xlsx")) }, { period: "2026-08" });
  const inv = parseCoroInvoice({ buffer: readFileSync(join(DATA, "Coro_Invoice_INVCUS2026-0002193.xlsx")) },
    { invoiceNumber: "INVCUS2026-0002193", period: "2026-08" });
  if (!isOk(pricing) || !isOk(usage) || !isOk(inv)) throw new Error("parse failed");
  return closeFromRateCard({ pricing: pricing.value, usage: usage.value, coroInvoiceLines: inv.value, period: "2026-08" });
}

const FP = { pricing: "aaaaaaaaaaaa", usage: "bbbbbbbbbbbb" };

describe.skipIf(!hasRealData)("snapshotFromClose — real August packet", () => {
  const snap = hasRealData
    ? snapshotFromClose(realModel(), FP, 1, "2026-09-28T20:00:00.000Z")
    : (null as never);

  it("pins the month totals (post confirmed-rates)", () => {
    expect(snap.totals.billedL).toBe("13957.76");
    expect(snap.totals.costActual).toBe("12998.33");
    expect(snap.totals.costExpected).toBe("12070.82");
    expect(snap.totals.margin).toBe("959.43");
    expect(snap.totals.creditExpected).toBe("1041.38");
    expect(snap.partners).toHaveLength(16);
  });

  it("carries per-line rate, quantity, and customer shares", () => {
    const xtb = snap.partners.find((p) => p.cardName === "XTB Solutions")!;
    const ess = xtb.lines.find((l) => l.vendorSku.toLowerCase() === "bucoroflex")!;
    expect(ess.unitL).toBe("6.00");
    expect(ess.quantity).toBe(39);
    expect(ess.customers.length).toBeGreaterThan(0);
  });

  it("round-trips through the zod schema", () => {
    const parsed = CloseSnapshotSchema.parse(JSON.parse(JSON.stringify(snap)));
    expect(parsed).toEqual(snap);
  });

  it("is deterministic", () => {
    expect(snapshotFromClose(realModel(), FP, 1, "2026-09-28T20:00:00.000Z")).toEqual(snap);
  });
});

describe("CloseSnapshotSchema — rejection", () => {
  it("rejects a wrong version and missing fields", () => {
    expect(CloseSnapshotSchema.safeParse({ v: 2 }).success).toBe(false);
    expect(CloseSnapshotSchema.safeParse({}).success).toBe(false);
  });
});
