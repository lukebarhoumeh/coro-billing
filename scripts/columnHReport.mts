/**
 * Column-H discrepancy report — the send-back Coro asked for on 2026-09-22
 * ("Column H is meant to represent MSP Hub's expected cost of license. ...
 * Can you share the inconsistencies you have found?").
 *
 * Coro's stated model (same email): total discount I = F + G with G = 45 − F
 * floored at 5, applied additively off list — so expected H = list × (1 − I).
 * This script classifies every priced row of the canonical special-pricing CSV
 * against that model and against the older E×0.95 reading the sheet mostly
 * still carries, then writes a machine-readable CSV for the reply.
 *
 * Run from the repo root:  npx tsx scripts/columnHReport.mts
 * Output:                  out/coro-reply/column-h-discrepancies.csv
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSpecialPricing } from "../src/ingest/specialPricing.js";
import { unwrap } from "../src/lib/result.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRICING = join(ROOT, "data", "2026-08", "Coro Special MSP Pricing(Special Pricing).csv");
const OUT_DIR = join(ROOT, "out", "coro-reply");
const OUT = join(OUT_DIR, "column-h-discrepancies.csv");

const TOLERANCE_CENTS = 1; // Coro allowed "a $0.01 difference, depending on rounding"

const { partners } = unwrap(parseSpecialPricing(readFileSync(PRICING, "utf8"), "2026-08"));

const esc = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const rows: string[] = [
  [
    "partner", "product", "sheet_row", "list", "F_partner_pct", "G_hub_pct", "I_total_pct",
    "E_net_msp", "H_as_written", "expected_H_additive", "delta_H_vs_additive",
    "E_x_0.95", "H_matches",
  ].join(","),
];

let total = 0;
const counts = { additive: 0, e95: 0, both: 0, neither: 0, blank: 0, unpriceable: 0 };
for (const p of partners) {
  for (const r of p.rows) {
    total++;
    const e95 = r.netMsp !== null ? r.netMsp.mul("0.95") : null;
    const additive =
      r.listPrice !== null && r.mspDiscountPct !== null && r.hubDiscountPct !== null
        ? r.listPrice.applyDiscount((r.mspDiscountPct + r.hubDiscountPct) / 100)
        : null;
    let matches: keyof typeof counts;
    if (r.netHubStated === null) {
      matches = additive === null && e95 === null ? "unpriceable" : "blank";
    } else if (additive === null && e95 === null) {
      matches = "unpriceable";
    } else {
      const near = (x: { toCents(): number } | null): boolean =>
        x !== null && Math.abs(r.netHubStated!.toCents() - x.toCents()) <= TOLERANCE_CENTS;
      const a = near(additive);
      const b = near(e95);
      matches = a && b ? "both" : a ? "additive" : b ? "e95" : "neither";
    }
    counts[matches]++;
    const delta =
      r.netHubStated !== null && additive !== null ? r.netHubStated.sub(additive) : null;
    rows.push(
      [
        esc(p.name), esc(r.product), String(r.sourceRow),
        r.listPrice?.toFixed2() ?? "", String(r.mspDiscountPct ?? ""),
        String(r.hubDiscountPct ?? ""), String(r.totalDiscountPct ?? ""),
        r.netMsp?.toFixed2() ?? "", r.netHubStated?.toFixed2() ?? "",
        additive?.toFixed2() ?? "", delta?.toFixed2() ?? "",
        e95?.toFixed2() ?? "", matches,
      ].join(",")
    );
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, rows.join("\n") + "\n", "utf8");
console.log(`${OUT}`);
console.log(
  `${total} priced rows — H matches: additive(expected) ${counts.additive}, ` +
    `E×0.95 ${counts.e95}, both ${counts.both}, neither ${counts.neither}, ` +
    `blank ${counts.blank}, unpriceable ${counts.unpriceable}`
);
console.log(
  `rows NOT matching Coro's stated model (H = list×(1−I)): ` +
    `${counts.e95 + counts.neither + counts.blank}`
);
