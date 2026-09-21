/**
 * Tests for the browser file-ingestion layer (web/src/lib/loadFiles.ts).
 * The module is DOM-free by design, so it runs under plain Node vitest.
 */
import { describe, it, expect } from "vitest";
import {
  fingerprintBytes,
  periodFromFileName,
  invoiceNumberFromFileName,
  parseSlotBytes,
  reviewStorageKey,
} from "../../web/src/lib/loadFiles.js";
import { buildRateCardDemo } from "../../fixtures/synthetic/rateCardDemo.js";
import { isOk } from "../../src/lib/result.js";

describe("fingerprintBytes", () => {
  it("produces the known SHA-256 of 'abc'", async () => {
    const fp = await fingerprintBytes(new TextEncoder().encode("abc"));
    expect(fp).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("periodFromFileName", () => {
  it("reads month-name files", () => {
    expect(periodFromFileName("MSP Hub_August 2026 Usage.xlsx")).toBe("2026-08");
    expect(periodFromFileName("msp hub_September 2026 usage.xlsx")).toBe("2026-09");
  });
  it("reads ISO fragments and returns null when nothing matches", () => {
    expect(periodFromFileName("close-2026-08-final.xlsx")).toBe("2026-08");
    expect(periodFromFileName("whatever.xlsx")).toBeNull();
  });
});

describe("invoiceNumberFromFileName", () => {
  it("extracts the Coro invoice number", () => {
    expect(invoiceNumberFromFileName("Coro_Invoice_INVCUS2026-0002193.xlsx")).toBe(
      "INVCUS2026-0002193"
    );
  });
});

describe("parseSlotBytes", () => {
  it("parses the demo pricing CSV into the pricing slot with a report", () => {
    const demo = buildRateCardDemo();
    const r = parseSlotBytes(
      "pricing",
      "Coro Special MSP Pricing(Special Pricing).csv",
      new TextEncoder().encode(demo.pricingCsv),
      "2026-08"
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.payload.slot).toBe("pricing");
    expect(r.value.report.partners).toBe(3);
    expect(r.value.report.rowsRead).toBeGreaterThan(5);
  });

  it("rejects a wrong-shaped file with a friendly slot-named error", () => {
    const r = parseSlotBytes(
      "pricing",
      "random.csv",
      new TextEncoder().encode("just,some\ngarbage,rows\n"),
      "2026-08"
    );
    expect(isOk(r)).toBe(false);
    if (isOk(r)) return;
    expect(r.error).toMatch(/Special MSP Pricing/);
    expect(r.error).toMatch(/random\.csv/);
  });

  it("survives binary garbage on the usage slot without throwing", () => {
    const r = parseSlotBytes("usage", "noise.xlsx", new Uint8Array([1, 2, 3, 4]), "2026-08");
    expect(isOk(r)).toBe(false);
  });
});

describe("reviewStorageKey", () => {
  it("keys on period + truncated fingerprints", () => {
    expect(reviewStorageKey("2026-08", "a".repeat(64), "b".repeat(64))).toBe(
      `coro-close-review:2026-08:${"a".repeat(12)}:${"b".repeat(12)}`
    );
  });
});
