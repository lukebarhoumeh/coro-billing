/**
 * Special-pricing CSV parser — Coro's per-partner rate card, the piece Dane said
 * was missing on Sep 11 ("we have all of the data except for our price and their
 * price") and Danny walked through on Sep 18: "This is the partner, this is their
 * workspace. Here are all of the products they're buying or might be buying.
 * Here's the list price for those products… Then here is the price that partner
 * is buying those products for."
 *
 * Business anchors (spec 2026-09-21-coro-billing-ui-revamp-design.md):
 *   - Column E "Net Price to MSP" is the PARTNER'S COST — L, what the MSP pays
 *     Hub (Luke, 2026-09-21). It is read, never derived.
 *   - Column H "Net Price to MSPHUB (5%)" is carried AS WRITTEN and validated
 *     (it disagrees with what Coro actually bills — the additive rule — on real
 *     invoices; the close surfaces both). We flag rows where H ≠ E×0.95 and
 *     where I ≠ F+G as SHEET_MATH_INCONSISTENT, severity info.
 *   - Partner blocks: name + workspace on the first row, continuation rows blank
 *     in A/B. "Managed" / "Managed Included" sub-blocks belong to the enclosing
 *     partner (the sheet's idiom for the managed-service rate). Name-only stray
 *     rows (the "XTB" alias line) are dropped with EMPTY_PARTNER_BLOCK.
 *   - Never invent a price: blank/garbage money cells parse to null and the
 *     close HOLDS anything priced by them.
 *
 * Deterministic: rows walked in file order; findings in discovery order.
 */
import { parseCsv } from "../lib/csv.js";
import { Money } from "../lib/money.js";
import { type Result, ok, err } from "../lib/result.js";
import { type IngestError, ingestError } from "./xlsx.js";
import { normalizeHeader } from "../config/pipeline.config.js";
import type {
  Exception,
  Period,
  PricingPartner,
  PricingRow,
  SpecialPricingResult,
} from "../domain/types.js";

const COLUMN_COUNT = 17;

/** Sub-block titles that fold into the enclosing partner rather than starting one. */
const FOLDED_SUBBLOCKS = new Set(["managed", "managed included"]);

/** `$1,234.50` / `1234.5` / `15.00 ` → Money; blank or garbage → null (never throw). */
export function parseMoneyCell(cell: string): Money | null {
  const cleaned = cell.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Money.of(cleaned);
}

/** `60%` / `60` → 60; blank or garbage → null. */
export function parsePercentCell(cell: string): number | null {
  const cleaned = cell.replace(/[%\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Normalize a product name for duplicate/lookup comparisons. */
export function normalizeProduct(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function blank(cell: string | undefined): boolean {
  return cell === undefined || cell.trim() === "";
}

function cellOrNull(cell: string): string | null {
  const t = cell.trim();
  return t === "" ? null : t;
}

interface PartnerBuilder {
  name: string;
  workspaceId: string | null;
  rows: PricingRow[];
  seenProducts: Set<string>;
  approxMonthlySpend: string | null;
  activeUsers: string | null;
  totalWorkspaces: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  sourceRow: number;
}

export function parseSpecialPricing(
  csvText: string,
  period: Period
): Result<SpecialPricingResult, IngestError> {
  const rows = parseCsv(csvText).map((r) => {
    const padded = [...r];
    while (padded.length < COLUMN_COUNT) padded.push("");
    return padded;
  });

  // Header row: first row whose A normalizes to "msp" and B to "workspace id".
  const headerIdx = rows.findIndex(
    (r) => normalizeHeader(r[0]!) === "msp" && normalizeHeader(r[1]!) === "workspace id"
  );
  if (headerIdx === -1) {
    return err(
      ingestError(
        "specialPricing",
        'header row not found — expected columns starting "MSP", "Workspace ID" ' +
          "(is this the Coro Special MSP Pricing CSV?)"
      )
    );
  }

  const findings: Exception[] = [];
  const partners: PricingPartner[] = [];
  const builders: PartnerBuilder[] = [];
  let current: PartnerBuilder | null = null;

  const finding = (
    kind: Exception["kind"],
    severity: Exception["severity"],
    partner: string,
    sku: string,
    message: string,
    sourceRow: number
  ): void => {
    findings.push({ kind, severity, partner, customer: null, sku, period, message, sourceRow });
  };

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const sourceRow = i + 1; // 1-based, matching what a human sees in the file
    const nameCell = r[0]!.trim();
    const productCell = r[2]!.trim();

    if (nameCell !== "") {
      const isFolded =
        FOLDED_SUBBLOCKS.has(normalizeHeader(nameCell)) && blank(r[1]) && current !== null;
      if (!isFolded) {
        current = {
          name: nameCell,
          workspaceId: blank(r[1]) ? null : r[1]!.trim().toLowerCase(),
          rows: [],
          seenProducts: new Set(),
          approxMonthlySpend: cellOrNull(r[9]!),
          activeUsers: cellOrNull(r[10]!),
          totalWorkspaces: cellOrNull(r[11]!),
          contactName: cellOrNull(r[12]!),
          contactPhone: cellOrNull(r[13]!),
          contactEmail: cellOrNull(r[14]!),
          address: cellOrNull(r[16]!),
          sourceRow,
        };
        builders.push(current);
      }
      // A folded sub-block row may itself carry a product (it usually does);
      // fall through to the product handling below either way.
    }

    if (productCell === "" || current === null) continue; // spacer / pre-header noise

    const key = normalizeProduct(productCell);
    if (current.seenProducts.has(key)) {
      finding(
        "DUPLICATE_RATE_ROW",
        "warn",
        current.name,
        productCell,
        `product "${productCell}" appears twice in the ${current.name} block — ` +
          `keeping the first row, ignoring row ${sourceRow}`,
        sourceRow
      );
      continue;
    }
    current.seenProducts.add(key);

    const pricingRow: PricingRow = {
      product: productCell,
      listPrice: parseMoneyCell(r[3]!),
      netMsp: parseMoneyCell(r[4]!),
      mspDiscountPct: parsePercentCell(r[5]!),
      hubDiscountPct: parsePercentCell(r[6]!),
      netHubStated: parseMoneyCell(r[7]!),
      totalDiscountPct: parsePercentCell(r[8]!),
      sourceRow,
    };
    current.rows.push(pricingRow);

    // In-file sheet-math validations (info — the close decides what to trust).
    if (pricingRow.netMsp !== null && pricingRow.netHubStated !== null) {
      const times95 = pricingRow.netMsp.mul("0.95");
      if (!pricingRow.netHubStated.equalsCents(times95)) {
        finding(
          "SHEET_MATH_INCONSISTENT",
          "info",
          current.name,
          productCell,
          `col H says ${pricingRow.netHubStated.toFixed2()} but E×0.95 = ${times95.toFixed2()} — ` +
            `carrying the sheet's value; the close shows both cost rules`,
          sourceRow
        );
      }
    }
    if (
      pricingRow.totalDiscountPct !== null &&
      pricingRow.mspDiscountPct !== null &&
      pricingRow.hubDiscountPct !== null
    ) {
      const sum = pricingRow.mspDiscountPct + pricingRow.hubDiscountPct;
      if (pricingRow.totalDiscountPct !== sum) {
        finding(
          "SHEET_MATH_INCONSISTENT",
          "info",
          current.name,
          productCell,
          `col I says ${pricingRow.totalDiscountPct}% but F+G = ${sum}% — ` +
            `the additive cost rule uses F+G`,
          sourceRow
        );
      }
    }
  }

  // Finalize: drop name-only stray blocks; flag missing/duplicate workspace ids.
  const seenWorkspaces = new Map<string, string>(); // slug → first partner name
  for (const b of builders) {
    if (b.rows.length === 0 && b.workspaceId === null) {
      finding(
        "EMPTY_PARTNER_BLOCK",
        "info",
        b.name,
        "",
        `"${b.name}" is a name-only row with no products or workspace — dropped ` +
          `(stray alias line in the sheet)`,
        b.sourceRow
      );
      continue;
    }
    if (b.workspaceId === null) {
      finding(
        "MISSING_WORKSPACE_ID",
        "warn",
        b.name,
        "",
        `partner "${b.name}" has no Workspace ID — its rates cannot join usage`,
        b.sourceRow
      );
    } else {
      const prior = seenWorkspaces.get(b.workspaceId);
      if (prior !== undefined) {
        finding(
          "DUPLICATE_WORKSPACE_ID",
          "warn",
          b.name,
          "",
          `workspace "${b.workspaceId}" appears on both "${prior}" and "${b.name}" — ` +
            `usage will join the FIRST block; review`,
          b.sourceRow
        );
      } else {
        seenWorkspaces.set(b.workspaceId, b.name);
      }
    }
    const { seenProducts: _seen, ...partner } = b;
    partners.push(partner);
  }

  return ok({ partners, findings });
}

/**
 * Danny's cross-partner check: "Here's the list price for those products. That
 * should be the same in every single one, right?" One warn per product whose
 * list price differs across partners, naming every variant and who shows it.
 */
export function validateListPrices(
  partners: readonly PricingPartner[],
  period: Period
): Exception[] {
  const byProduct = new Map<string, { product: string; variants: Map<number, string[]> }>();
  for (const p of partners) {
    for (const row of p.rows) {
      if (row.listPrice === null) continue;
      const key = normalizeProduct(row.product);
      let entry = byProduct.get(key);
      if (!entry) {
        entry = { product: row.product, variants: new Map() };
        byProduct.set(key, entry);
      }
      const cents = row.listPrice.toCents();
      const names = entry.variants.get(cents);
      if (names) names.push(p.name);
      else entry.variants.set(cents, [p.name]);
    }
  }

  const findings: Exception[] = [];
  for (const { product, variants } of byProduct.values()) {
    if (variants.size <= 1) continue;
    const detail = [...variants.entries()]
      .map(([cents, names]) => `$${Money.of(cents / 100).toFixed2()} (${names.join(", ")})`)
      .join(" vs ");
    findings.push({
      kind: "LIST_PRICE_DIVERGES",
      severity: "warn",
      partner: "",
      customer: null,
      sku: product,
      period,
      message:
        `list price for "${product}" differs across partners — Danny: it "should be ` +
        `the same in every single one": ${detail}`,
    });
  }
  return findings;
}
