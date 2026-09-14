/**
 * Tests for the Brandon/Jack special-pricing parser (src/ingest/rateCard.ts).
 *
 * Contract anchors (README + docs/ARCHITECTURE.md + docs/DATA_CONTRACTS.md):
 *   - Read ALL sheets; a sheet whose normalized name includes "legacy" -> class "legacy",
 *     otherwise "current". "same format" per Dane.
 *   - mspPrice = L ("net price to MSP" / "their price"); hubCost = H ("our price").
 *   - Per PARTNER, per SKU — rates are NOT house-wide (Dane: "all these partners are on
 *     different stuff"). Two partners can carry DIFFERENT prices for the SAME sku.
 *   - hubCost may be absent -> Money.zero() (flagged downstream as MISSING_HUB_COST).
 *     The parser NEVER invents H (Dane: "I just need their price and our price").
 *   - discountPct is nice-to-have; parse "45%" tolerantly.
 *   - READ-ONLY: the parser does NO discount/buffer math (rating owns that).
 *
 * Workbooks are built IN MEMORY with SheetJS so no binary fixtures are committed.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";

import { parseRateCard } from "../../src/ingest/rateCard.js";
import { isOk, isErr } from "../../src/lib/result.js";
import { Money } from "../../src/lib/money.js";
import type { RateCardEntry } from "../../src/domain/types.js";

/** Build an in-memory workbook from a map of sheetName -> array-of-arrays (header row first). */
function wbFrom(sheets: Record<string, (string | number | null)[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return wb;
}

/** Convenience: find the single entry matching partner+sku (fails loudly if not unique). */
function entryFor(entries: readonly RateCardEntry[], partner: string, sku: string): RateCardEntry {
  const hits = entries.filter((e) => e.partner === partner && e.sku === sku);
  expect(hits.length, `expected exactly one entry for ${partner}/${sku}`).toBe(1);
  return hits[0]!;
}

describe("parseRateCard", () => {
  it("reads a current tab and a legacy tab in one workbook, classing each by sheet name", () => {
    // "same format" — identical headers on both tabs. Legacy is a separate tab
    // because Coro is still changing those rows (Lisa: "I would keep it separate").
    const wb = wbFrom({
      Current: [
        ["Partner", "SKU", "Our Price", "Net Price to MSP"],
        ["Acme MSP", "CORO-EP-1", 6.0, 9.0],
      ],
      "Legacy SKUs": [
        ["Partner", "SKU", "Our Price", "Net Price to MSP"],
        ["Acme MSP", "CORO-LEG-9", 3.3, 5.5],
      ],
    });

    const res = parseRateCard({ workbook: wb }, { period: "2026-08" });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;

    const entries = res.value;
    expect(entries.length).toBe(2);

    const current = entryFor(entries, "Acme MSP", "CORO-EP-1");
    expect(current.class).toBe("current");
    expect(current.source).toBe("Current"); // source = exact sheet name
    expect(current.period).toBe("2026-08");
    expect(current.hubCost.equalsCents(Money.of(6.0))).toBe(true); // H
    expect(current.mspPrice.equalsCents(Money.of(9.0))).toBe(true); // L

    const legacy = entryFor(entries, "Acme MSP", "CORO-LEG-9");
    expect(legacy.class).toBe("legacy"); // sheet name normalizes to include "legacy"
    expect(legacy.source).toBe("Legacy SKUs");
    expect(legacy.hubCost.equalsCents(Money.of(3.3))).toBe(true);
    expect(legacy.mspPrice.equalsCents(Money.of(5.5))).toBe(true);
  });

  it("keeps per-partner rates: two partners, SAME sku, DIFFERENT prices (no house average)", () => {
    // Dane: "all these partners are on different stuff." The parser must NOT
    // collapse or average across partners — each row stands on its own.
    const wb = wbFrom({
      Current: [
        ["Partner", "SKU", "Our Price", "Net Price to MSP"],
        ["Acme MSP", "CORO-EP-1", 6.0, 9.0],
        ["Globex MSP", "CORO-EP-1", 6.5, 12.0],
      ],
    });

    const res = parseRateCard({ workbook: wb });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;

    const entries = res.value;
    expect(entries.length).toBe(2);

    const acme = entryFor(entries, "Acme MSP", "CORO-EP-1");
    const globex = entryFor(entries, "Globex MSP", "CORO-EP-1");

    // Same SKU, DIFFERENT H and L — proves per-partner rates are preserved.
    expect(acme.sku).toBe(globex.sku);
    expect(acme.hubCost.equalsCents(globex.hubCost)).toBe(false);
    expect(acme.mspPrice.equalsCents(globex.mspPrice)).toBe(false);
    expect(acme.hubCost.equalsCents(Money.of(6.0))).toBe(true);
    expect(globex.hubCost.equalsCents(Money.of(6.5))).toBe(true);
    expect(acme.mspPrice.equalsCents(Money.of(9.0))).toBe(true);
    expect(globex.mspPrice.equalsCents(Money.of(12.0))).toBe(true);
  });

  it("does NOT invent hubCost when H is absent: hubCost is Money.zero()", () => {
    // Dane: "We have all of the data except for our price and their price." When the
    // sheet gives L but not H, we carry L and leave H = 0 — the MISSING_HUB_COST
    // exception is raised downstream in rating, never patched here.
    const wb = wbFrom({
      Current: [
        ["Partner", "SKU", "Net Price to MSP"], // no "Our Price" column at all
        ["Acme MSP", "CORO-EP-1", 9.0],
      ],
    });

    const res = parseRateCard({ workbook: wb });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;

    const e = entryFor(res.value, "Acme MSP", "CORO-EP-1");
    expect(e.hubCost.isZero()).toBe(true); // NOT invented
    expect(e.mspPrice.equalsCents(Money.of(9.0))).toBe(true);
  });

  it('parses discountPct from a "45%" string cell, normalized to a 0..1 fraction', () => {
    // Lisa: legacy is "the list price with the 45% discount." discountPct is
    // nice-to-have and is normalized to a FRACTION (0.45), tolerating the % sign, so it
    // composes with applyHubBuffer/applyDiscount and matches the config constants
    // (which are stored as fractions like 0.45). "0.45", "45", and "45%" all → 0.45.
    const wb = wbFrom({
      "Legacy SKUs": [
        ["Partner", "SKU", "Our Price", "Net Price to MSP", "Discount"],
        ["Acme MSP", "CORO-LEG-9", "3.30", "5.50", "45%"],
      ],
    });

    const res = parseRateCard({ workbook: wb });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;

    const e = entryFor(res.value, "Acme MSP", "CORO-LEG-9");
    expect(e.discountPct).toBeCloseTo(0.45, 10);
    // READ-ONLY: parser must NOT have applied the discount to derive H.
    // H is exactly what the sheet said (3.30), not list - 45%.
    expect(e.hubCost.equalsCents(Money.of(3.3))).toBe(true);
  });

  it("period defaults to empty string when cfg.period is not supplied", () => {
    const wb = wbFrom({
      Current: [
        ["Partner", "SKU", "Our Price", "Net Price to MSP"],
        ["Acme MSP", "CORO-EP-1", 6.0, 9.0],
      ],
    });

    const res = parseRateCard({ workbook: wb });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]!.period).toBe("");
  });

  it("records raw for traceability back to the source row", () => {
    const wb = wbFrom({
      Current: [
        ["Partner", "SKU", "Our Price", "Net Price to MSP"],
        ["Acme MSP", "CORO-EP-1", 6.0, 9.0],
      ],
    });

    const res = parseRateCard({ workbook: wb });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;

    const e = res.value[0]!;
    expect(e.raw["Partner"]).toBe("Acme MSP");
    expect(e.raw["SKU"]).toBe("CORO-EP-1");
  });

  it("skips rows missing a required field (partner or sku) rather than emitting junk", () => {
    // A required field (partner, sku, mspPrice=L) that is blank means the row is not
    // a real rate — do not fabricate one. (We must never invent a rate.)
    const wb = wbFrom({
      Current: [
        ["Partner", "SKU", "Our Price", "Net Price to MSP"],
        ["Acme MSP", "CORO-EP-1", 6.0, 9.0],
        [null, "CORO-EP-2", 6.0, 9.0], // no partner
        ["Globex MSP", null, 6.0, 9.0], // no sku
        ["Initech MSP", "CORO-EP-3", 6.0, null], // no L (required)
      ],
    });

    const res = parseRateCard({ workbook: wb });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // Only the one complete row survives.
    expect(res.value.length).toBe(1);
    expect(res.value[0]!.partner).toBe("Acme MSP");
  });

  it("errors (does not throw) when the workbook cannot be read", () => {
    // Corrupt buffer -> Result Err, never a thrown exception across the boundary.
    const res = parseRateCard({ buffer: Buffer.from("not an xlsx file") });
    expect(isErr(res)).toBe(true);
  });

  it("uses caller-supplied columns via cfg.columns", () => {
    // Plug-and-play: a real file with different headers is handled by editing the
    // column map, not the parser. Prove cfg.columns overrides the default.
    const wb = wbFrom({
      Current: [
        ["MSP", "Item", "Hub Cost", "Partner Price"],
        ["Acme MSP", "CORO-EP-1", 6.0, 9.0],
      ],
    });

    const res = parseRateCard(
      { workbook: wb },
      {
        columns: {
          partner: ["msp"],
          sku: ["item"],
          hubCost: ["hub cost"],
          mspPrice: ["partner price"],
        },
      }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const e = entryFor(res.value, "Acme MSP", "CORO-EP-1");
    expect(e.hubCost.equalsCents(Money.of(6.0))).toBe(true);
    expect(e.mspPrice.equalsCents(Money.of(9.0))).toBe(true);
  });
});
