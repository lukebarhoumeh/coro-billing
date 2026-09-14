/**
 * Brandon/Jack special-pricing parser (the rate card).
 *
 * This is the file that carries Dane's "key": per PARTNER, per SKU, "their price and
 * our price." It reads BOTH the current and legacy tabs, which Lisa said Coro delivers
 * in "the exact same format" (legacy kept separate because those rows are still
 * changing). The parser is deliberately dumb: it reads the two prices the sheet states
 * and NOTHING more.
 *
 * Business anchors (README.md / docs/DATA_CONTRACTS.md):
 *   - "these two columns are H, our price, and what we're charging L ... That is the key."
 *      => hubCost = H, mspPrice = L.               (docs/DATA_CONTRACTS.md, Rate-card table)
 *   - "all these ******* partners are on different stuff."
 *      => rates are per partner+sku; we NEVER collapse or average. (No aggregation here.)
 *   - "I just need their price and our price." / "We have all of the data except for our
 *      price and their price."
 *      => when H is absent we carry Money.zero() and let rating raise MISSING_HUB_COST.
 *         We NEVER invent H (no list-minus-45%, no buffer) in the parser.
 *   - Legacy is "kept separate" and "straight across the board ... 45% discount" —
 *      but that math lives in rating (src/rating/buffer.ts + applyRates.ts). Here we only
 *      class the tab and pass discountPct through if the sheet states it.
 *
 * READ-ONLY: no discount/buffer arithmetic. That is the rating module's job
 * (docs/ARCHITECTURE.md: "buffer application itself lives in rating").
 *
 * Determinism: sheets are iterated in workbook order and rows in sheet order; no clock,
 * no randomness.
 */
import type { ColumnMap } from "../config/pipeline.config.js";
import { RATE_CARD_COLUMN_MAP, normalizeHeader, resolveColumn } from "../config/pipeline.config.js";
import type { Period, RateCardEntry, SkuClass } from "../domain/types.js";
import { Money } from "../lib/money.js";
import { type Result, ok, err } from "../lib/result.js";
import {
  type IngestError,
  type WorkbookInput,
  ingestError,
  loadWorkbook,
  num,
  readSheet,
  sheetNames,
  str,
} from "./xlsx.js";

/**
 * Parse Brandon/Jack special pricing into RateCardEntry[].
 *
 * @param input  workbook (path | buffer | in-memory WorkBook).
 * @param cfg.columns  header aliases; defaults to RATE_CARD_COLUMN_MAP (edit aliases in
 *                     pipeline.config.ts, not code, when a real file drifts).
 * @param cfg.period   the period the CALLER intends these rates to apply to; carried onto
 *                     every entry. Defaults to "" (the caller decides the period; the
 *                     parser does not guess it from a filename or the clock).
 */
export function parseRateCard(
  input: WorkbookInput,
  cfg?: { columns?: ColumnMap; period?: Period }
): Result<RateCardEntry[], IngestError> {
  const columns = cfg?.columns ?? RATE_CARD_COLUMN_MAP;
  const period: Period = cfg?.period ?? "";

  const wbRes = loadWorkbook(input);
  if (!wbRes.ok) return wbRes;
  const wb = wbRes.value;

  const names = sheetNames(wb);
  if (names.length === 0) {
    return err(ingestError("parseRateCard", "workbook has no sheets"));
  }

  const entries: RateCardEntry[] = [];

  // Iterate ALL sheets — current + legacy are the "same format" (Lisa/Dane), just
  // different tabs. Workbook order is stable, so output order is deterministic.
  for (const sheetName of names) {
    // A tab whose normalized name mentions "legacy" is the legacy export; otherwise
    // it is the current-SKU export. (docs/ARCHITECTURE.md rateCard.ts contract.)
    const sheetClass: SkuClass = normalizeHeader(sheetName).includes("legacy")
      ? "legacy"
      : "current";

    const sheetRes = readSheet(wb, sheetName, columns);
    if (!sheetRes.ok) return sheetRes;
    const sheet = sheetRes.value;

    // Resolve the concrete headers once per sheet (plug-and-play via the column map).
    const partnerHeader = resolveColumn(sheet.headers, columns["partner"] ?? []);
    const skuHeader = resolveColumn(sheet.headers, columns["sku"] ?? []);
    const mspPriceHeader = resolveColumn(sheet.headers, columns["mspPrice"] ?? []); // L
    const hubCostHeader = resolveColumn(sheet.headers, columns["hubCost"] ?? []); // H (may be absent)
    const discountHeader = resolveColumn(sheet.headers, columns["discountPct"] ?? []);

    for (const row of sheet.rows) {
      const partner = str(row, partnerHeader);
      const sku = str(row, skuHeader);
      const mspPriceNum = num(row, mspPriceHeader); // L is required

      // Required fields per docs/DATA_CONTRACTS.md: partner, sku, and L ("their price").
      // A row missing any of these is not a real rate — do NOT fabricate one
      // (we must never invent a rate). Skip it silently; rating will surface the
      // resulting rate-card gap as an Exception when a usage line has no match.
      if (partner === null || sku === null || mspPriceNum === null) continue;

      // H = "our price" — may be absent. When absent we carry Money.zero(); the
      // MISSING_HUB_COST exception is raised downstream in rating, never here. We do
      // NOT compute H (no list-minus-45%, no +5% buffer) — that is rating's job.
      const hubCostNum = num(row, hubCostHeader);
      const hubCost = hubCostNum === null ? Money.zero() : Money.of(hubCostNum);
      const mspPrice = Money.of(mspPriceNum);

      // discountPct is nice-to-have (Dane: "I just need their price and our price").
      // Normalize to a 0..1 FRACTION so it composes with applyHubBuffer/applyDiscount
      // and matches the config constants (0.05, 0.45): "0.45", "45", and "45%" all
      // become 0.45. (num() strips the "%", so we read the raw cell to detect it.)
      // Omit the field entirely when absent so the optional property stays truly optional.
      const discountPct = normalizeDiscountFraction(str(row, discountHeader), num(row, discountHeader));

      const entry: RateCardEntry = {
        partner,
        sku,
        period,
        class: sheetClass,
        hubCost,
        mspPrice,
        source: sheetName, // exact sheet name, for full traceability
        raw: { ...row },
        ...(discountPct === null ? {} : { discountPct }),
      };
      entries.push(entry);
    }
  }

  return ok(entries);
}

/**
 * Normalize a parsed discount to a 0..1 fraction. A discount is always a fraction; if
 * the source cell carried a "%" sign or the value is > 1 (e.g. "45" / "45%"), it is a
 * whole percent and is divided by 100. So "0.45", "45", and "45%" all yield 0.45,
 * consistent with the config constants stored as fractions. Returns null when absent.
 */
function normalizeDiscountFraction(raw: string | null, parsed: number | null): number | null {
  if (parsed === null) return null;
  const hadPercent = raw !== null && raw.includes("%");
  return hadPercent || parsed > 1 ? parsed / 100 : parsed;
}
