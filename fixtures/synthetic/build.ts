/**
 * SYNTHETIC — not real Coro/partner data.
 * ============================================================================
 * Every workbook produced by this file is FABRICATED to exercise the pipeline
 * end-to-end. It contains NO real Coro, MSP Hub, Brandon/Jack, or partner data.
 * Partner names are obviously fake — "Acme MSP", "Globex MSP", "Initech MSP" —
 * and workspaces/SKUs are made up. Do NOT use these numbers for any real close.
 * ============================================================================
 *
 * Why this exists (docs/ARCHITECTURE.md §"Synthetic fixtures"): the real files
 * (usage, Jack's rate card, Lindita's workbook) are not in the repo, so the
 * golden test proves the pipeline against a self-consistent, in-memory trio:
 *
 *   1. buildConsistentTrio()   — usage + rate card + Lindita that reconcile
 *                                CENT-EXACT (DiscrepancyReport.matched === true,
 *                                diff total cents === 0). This is the analogue of
 *                                Dane's "recreate August and see it tie to Lita's".
 *
 *   2. buildDiscrepancyTrio()  — the SAME shape but with two DELIBERATE faults:
 *        (i)  the "$6 vs $9" legacy landmine — the rate card charges L = $6 for a
 *             legacy SKU, but Lindita's manual file has $9 (Dane: "Brandon said
 *             you guys get this for $6, but you guys are charging us $9"). The
 *             reconciler must flag a `charge` Discrepancy (explained, because the
 *             line is legacy — the system flags, never silently "fixes").
 *        (ii) a usage row whose (partner, SKU) is NOT on the rate card at all,
 *             which rating must surface as a MISSING_RATE_CARD_ROW exception
 *             ("all these partners are on different stuff" → a miss is an
 *             exception, never a house-average guess).
 *
 * Everything is built with SheetJS in memory (XLSX.utils.aoa_to_sheet +
 * book_new + book_append_sheet) so no binary fixtures are committed. Each
 * workbook carries a loud "SYNTHETIC" banner row above the header — the parsers'
 * header-row auto-detection skips that banner, and it guarantees a human opening
 * any exported artifact sees the label.
 *
 * The trio is internally consistent BY CONSTRUCTION: usage quantities, rate-card
 * H/L, and Lindita's H/L/qty are all derived from one plain-data table so a human
 * can eyeball that the pipeline is not "cheating".
 */
import * as XLSX from "xlsx";
import type { WorkbookInput } from "../../src/ingest/xlsx.js";

/** Loud provenance banner stamped as the first row of every synthetic sheet. */
export const SYNTHETIC_BANNER = "SYNTHETIC — not real Coro/partner data" as const;

/** A single logical priced usage record — the seed all three files derive from. */
export interface SyntheticRow {
  readonly partner: string;
  readonly customer: string;
  readonly sku: string;
  /** Legacy SKUs stay visible as their own class (Dane: "an important thing to know"). */
  readonly legacy: boolean;
  readonly product: string;
  readonly quantity: number;
  /** H — our price / Hub cost (unit). */
  readonly hubCost: number;
  /** L — what we charge the MSP (unit). */
  readonly mspPrice: number;
}

/** The bundle of in-memory workbooks the pipeline ingests for one synthetic close. */
export interface SyntheticTrio {
  readonly period: string;
  readonly usage: WorkbookInput;
  readonly rateCard: WorkbookInput;
  readonly lindita: WorkbookInput;
  /** The seed rows, exposed so tests can assert against the source of truth. */
  readonly rows: readonly SyntheticRow[];
}

/**
 * The self-consistent seed for dataset (a). Two obviously-fake MSP partners, each
 * with two child workspaces, on current SKUs plus one legacy SKU — all priced with
 * per-partner H/L (note Acme and Globex carry DIFFERENT prices for the SAME
 * CORO-EPP SKU, proving "partners are on different stuff").
 */
const CONSISTENT_ROWS: readonly SyntheticRow[] = [
  // Acme MSP — two customers on current SKUs.
  { partner: "Acme MSP", customer: "Acme Retail", sku: "CORO-EPP", legacy: false, product: "Endpoint Protection", quantity: 10, hubCost: 6.0, mspPrice: 9.0 },
  { partner: "Acme MSP", customer: "Acme Retail", sku: "CORO-XDR", legacy: false, product: "Extended Detection", quantity: 4, hubCost: 8.5, mspPrice: 12.25 },
  { partner: "Acme MSP", customer: "Acme Logistics", sku: "CORO-EPP", legacy: false, product: "Endpoint Protection", quantity: 7, hubCost: 6.0, mspPrice: 9.0 },
  // Globex MSP — same CORO-EPP SKU, DIFFERENT per-partner price (no house average).
  { partner: "Globex MSP", customer: "Globex Media", sku: "CORO-EPP", legacy: false, product: "Endpoint Protection", quantity: 12, hubCost: 6.5, mspPrice: 11.0 },
  { partner: "Globex MSP", customer: "Globex Media", sku: "CORO-MDM", legacy: false, product: "Mobile Device Mgmt", quantity: 3, hubCost: 4.25, mspPrice: 6.5 },
  // A legacy SKU (kept visible, priced from the legacy tab): list − 45% is already
  // baked into these explicit H/L numbers by "Jack", per the "same format" rule.
  { partner: "Globex MSP", customer: "Globex Studios", sku: "CORO-LEGACY-SIEM", legacy: true, product: "Legacy SIEM", quantity: 5, hubCost: 5.5, mspPrice: 8.25 },
];

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

/** Wrap a set of named array-of-arrays sheets into an in-memory WorkbookInput. */
function workbookOf(sheets: readonly { name: string; rows: (string | number | boolean | null)[][] }[]): WorkbookInput {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return { workbook: wb };
}

/**
 * Coro monthly usage workbook (the ~1st-of-month delivered file). One row per
 * (partner, customer, SKU). The "Legacy" column keeps legacy visible. A banner
 * row sits above the header (auto-detected away by readSheet). U/D are omitted so
 * dataset (a) carries ZERO exceptions and reconciles perfectly clean.
 */
function buildUsageWorkbook(rows: readonly SyntheticRow[]): WorkbookInput {
  const aoa: (string | number | boolean | null)[][] = [
    [SYNTHETIC_BANNER, null, null, null, null, null],
    ["Partner", "Workspace", "SKU", "Legacy", "Product", "Quantity"],
  ];
  for (const r of rows) {
    aoa.push([r.partner, r.customer, r.sku, r.legacy ? "Yes" : null, r.product, r.quantity]);
  }
  return workbookOf([{ name: "Usage", rows: aoa }]);
}

/**
 * Brandon/Jack special-pricing workbook. Current SKUs on the "Current" tab and
 * legacy SKUs on the "Legacy SKUs" tab (Lisa: "I would keep it separate") — the
 * "same format" on both. H = "Our Price", L = "Net Price to MSP". One rate row per
 * (partner, SKU); duplicate (partner, SKU) pairs across customers collapse to a
 * single rate (the price is per partner×SKU, not per customer).
 */
function buildRateCardWorkbook(rows: readonly SyntheticRow[]): WorkbookInput {
  const header = ["Partner", "SKU", "Our Price", "Net Price to MSP"];
  const current: (string | number | boolean | null)[][] = [
    [SYNTHETIC_BANNER, null, null, null],
    header,
  ];
  const legacy: (string | number | boolean | null)[][] = [
    [SYNTHETIC_BANNER, null, null, null],
    header,
  ];

  // Dedupe by (partner, SKU) — the rate card is per partner×SKU, not per usage row.
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.partner}::${r.sku}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = [r.partner, r.sku, r.hubCost, r.mspPrice];
    if (r.legacy) legacy.push(line);
    else current.push(line);
  }

  return workbookOf([
    { name: "Current", rows: current },
    { name: "Legacy SKUs", rows: legacy },
  ]);
}

/**
 * Lindita's manual billing workbook — the recreation TARGET. Column H = "Our
 * Price", column L = "What we're charging", and Margin = L − H (unit) which she
 * calculates by hand. One row per usage row so the join (partner+customer+SKU) is
 * 1:1 with our recreation.
 *
 * @param rows        the seed rows.
 * @param overrides   optional per-key overrides of the charge (L) she wrote down,
 *                    keyed by `${partner}::${customer}::${sku}` — used to inject the
 *                    deliberate "$6 vs $9" legacy discrepancy for dataset (b).
 */
function buildLinditaWorkbook(
  rows: readonly SyntheticRow[],
  overrides?: ReadonlyMap<string, { charge?: number; ourPrice?: number }>
): WorkbookInput {
  const aoa: (string | number | boolean | null)[][] = [
    [SYNTHETIC_BANNER, null, null, null, null, null, null],
    ["Partner", "Customer", "SKU", "Quantity", "Our Price", "What we're charging", "Margin"],
  ];
  for (const r of rows) {
    const key = `${r.partner}::${r.customer}::${r.sku}`;
    const ov = overrides?.get(key);
    const ourPrice = ov?.ourPrice ?? r.hubCost;
    const charge = ov?.charge ?? r.mspPrice;
    // Margin is "automatically calculated" once H and L exist (Dane): L − H (unit).
    const margin = Math.round((charge - ourPrice) * 100) / 100;
    aoa.push([r.partner, r.customer, r.sku, r.quantity, ourPrice, charge, margin]);
  }
  return workbookOf([{ name: "August Billing", rows: aoa }]);
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/**
 * Dataset (a): a self-consistent trio where the pipeline reproduces Lindita
 * CENT-EXACT — DiscrepancyReport.matched === true and total cents diff === 0.
 */
export function buildConsistentTrio(period = "2026-08"): SyntheticTrio {
  const rows = CONSISTENT_ROWS;
  return {
    period,
    usage: buildUsageWorkbook(rows),
    rateCard: buildRateCardWorkbook(rows),
    lindita: buildLinditaWorkbook(rows),
    rows,
  };
}

/**
 * The extra usage row for dataset (b) whose (partner, SKU) is deliberately absent
 * from the rate card, so rating raises MISSING_RATE_CARD_ROW. It is present in
 * usage but NOT in Lindita's file, so it also lands in `onlyInOurs` (proving both
 * the exception path and the only-in-ours path). Obviously fake partner.
 */
const UNPRICED_ROW: SyntheticRow = {
  partner: "Initech MSP",
  customer: "Initech HQ",
  sku: "CORO-UNPRICED-NEW",
  legacy: false,
  product: "Brand New SKU (no rate yet)",
  quantity: 3,
  hubCost: 0, // unknown — never invented
  mspPrice: 0,
};

/**
 * Dataset (b): the same consistent base PLUS two deliberate faults:
 *   (i)  the legacy "$6 vs $9" landmine — the rate card charges L = $6 on
 *        CORO-LEGACY-SIEM, but Lindita's manual file says $9. → a `charge`
 *        Discrepancy on that legacy line (explained by the reconciler).
 *   (ii) an unpriced usage row (Initech / CORO-UNPRICED-NEW) with no rate-card
 *        entry → a MISSING_RATE_CARD_ROW exception (and an onlyInOurs row).
 *
 * matched must be FALSE.
 */
export function buildDiscrepancyTrio(period = "2026-08"): SyntheticTrio {
  // The legacy SIEM row is the landmine target. Rate card keeps L = $6 (below);
  // Lindita is overridden to $9 to reproduce Dane's "$6 vs $9" exactly.
  const LEGACY_SKU = "CORO-LEGACY-SIEM";
  const LEGACY_RATE_L = 6.0; // what the rate card says we charge
  const LINDITA_L = 9.0; // what Lindita hand-wrote (the discrepancy)

  // Rebuild the base rows but force the legacy SIEM charge to $6 on BOTH the seed
  // (→ rate card) and drop its Lindita override to $9. Keep hubCost matching so
  // ONLY the charge (L) differs — a single, unambiguous `charge` discrepancy.
  const baseRows: SyntheticRow[] = CONSISTENT_ROWS.map((r) =>
    r.sku === LEGACY_SKU ? { ...r, mspPrice: LEGACY_RATE_L } : r
  );

  // Usage includes the base rows plus the unpriced Initech row.
  const usageRows: SyntheticRow[] = [...baseRows, UNPRICED_ROW];

  // Rate card is built from base rows ONLY (the unpriced SKU is intentionally
  // absent → MISSING_RATE_CARD_ROW). Legacy SIEM rate carries L = $6.
  const rateCard = buildRateCardWorkbook(baseRows);

  // Lindita covers the base rows (NOT the unpriced row), with the legacy SIEM
  // charge hand-written as $9 (the discrepancy vs the $6 rate card).
  const linditaOverrides = new Map<string, { charge?: number; ourPrice?: number }>();
  for (const r of baseRows) {
    if (r.sku === LEGACY_SKU) {
      linditaOverrides.set(`${r.partner}::${r.customer}::${r.sku}`, { charge: LINDITA_L });
    }
  }
  const lindita = buildLinditaWorkbook(baseRows, linditaOverrides);

  return {
    period,
    usage: buildUsageWorkbook(usageRows),
    rateCard,
    lindita,
    rows: usageRows,
  };
}
