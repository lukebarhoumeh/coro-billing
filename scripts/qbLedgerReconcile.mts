/**
 * qbLedgerReconcile — our rate-card close vs the accounting team's QuickBooks
 * P&L Detail export (Coro class), line by line.
 *
 * Lita's 2026-09-28 reply attached "MSP HUB, LLC_Profit and Loss Detail, Coro,
 * July + August.xlsx" — her actual QB invoices (income) and the Coro bills she
 * booked (COGS). This script reruns the close headlessly on the same three
 * files she drops in the workbench, then diffs per partner × product so the
 * punch list is derived, not eyeballed. Reusable for the September close: point
 * --ledger at the next P&L Detail export.
 *
 * Run: pnpm tsx scripts/qbLedgerReconcile.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { parseSpecialPricing } from "../src/ingest/specialPricing.js";
import { parseUsage } from "../src/ingest/usage.js";
import { parseCoroInvoice } from "../src/ingest/coroInvoice.js";
import { closeFromRateCard } from "../src/close/rateCardClose.js";
import { isOk } from "../src/lib/result.js";
import { Money } from "../src/lib/money.js";
import type { CloseModel } from "../src/domain/types.js";

const ROOT = join(import.meta.dirname, "..");
const DATA = join(ROOT, "data", "2026-08");
const OUT = join(ROOT, "out", "lita-reconcile-2026-09-28");

const PRICING_CSV = join(DATA, "Coro Special MSP Pricing(Special Pricing).csv");
const USAGE_XLSX = join(DATA, "MSP Hub_August 2026 Usage.xlsx");
const CORO_INVOICE_XLSX = join(DATA, "Coro_Invoice_INVCUS2026-0002193.xlsx");
const LEDGER_XLSX =
  process.argv.includes("--ledger")
    ? process.argv[process.argv.indexOf("--ledger") + 1]!
    : join(DATA, "QB P&L Detail Coro (Lita 2026-09-28).xlsx");

const PERIOD = "2026-08";

// ---------------------------------------------------------------------------
// 1. Rerun the close exactly as the web workbench does (loadFiles.ts flow).
// ---------------------------------------------------------------------------
function runClose(): CloseModel {
  const csvText = readFileSync(PRICING_CSV, "utf-8").replace(/^﻿/, "");
  const pricing = parseSpecialPricing(csvText, PERIOD);
  if (!isOk(pricing)) throw new Error(`pricing parse failed: ${pricing.error.message}`);

  const usage = parseUsage({ buffer: new Uint8Array(readFileSync(USAGE_XLSX)) }, { period: PERIOD });
  if (!isOk(usage)) throw new Error(`usage parse failed: ${usage.error.message}`);

  const inv = parseCoroInvoice(
    { buffer: new Uint8Array(readFileSync(CORO_INVOICE_XLSX)) },
    { invoiceNumber: "INVCUS2026-0002193", period: PERIOD }
  );
  if (!isOk(inv)) throw new Error(`coro invoice parse failed: ${inv.error.message}`);

  return closeFromRateCard({
    pricing: pricing.value,
    usage: usage.value,
    coroInvoiceLines: inv.value,
    period: PERIOD,
  });
}

// ---------------------------------------------------------------------------
// 2. Parse the QB P&L Detail export.
// ---------------------------------------------------------------------------
interface LedgerLine {
  readonly txnType: "Invoice" | "Bill";
  readonly num: string;
  readonly name: string;
  readonly product: string; // first line of Description, normalized-ish
  readonly periodText: string | null; // "Jul 1, 2026 through Jul 31, 2026" etc.
  readonly amount: number;
}

function parseLedger(path: string): LedgerLine[] {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
  });
  const lines: LedgerLine[] = [];
  for (const r of rows) {
    const txnType = String(r[2] ?? "").trim();
    if (txnType !== "Invoice" && txnType !== "Bill") continue;
    const amount = typeof r[9] === "number" ? r[9] : Number(r[9]);
    if (!Number.isFinite(amount)) continue;
    const desc = String(r[7] ?? "").trim();
    const descLines = desc.split(/\r?\n/).map((s) => s.trim());
    const periodText = descLines.length > 1 ? descLines.slice(1).join(" ") : null;
    lines.push({
      txnType,
      num: String(r[3] ?? "").trim(),
      name: String(r[4] ?? "").trim(),
      product: descLines[0] ?? "",
      periodText,
      amount,
    });
  }
  return lines;
}

/** Which month an income line belongs to. Explicit period text wins; otherwise
 * the invoice-number batch decides. 10550 (Net-Tech, the only Net-Tech invoice)
 * is August by content: its 100-unit EMAIL PROTECTION line only exists in
 * August usage, and Coro's July bill has no EMAIL PROTECTION at all. */
function monthOf(l: LedgerLine): "2026-07" | "2026-08" | "other" {
  if (l.periodText) {
    if (/Jul \d/.test(l.periodText)) return "2026-07";
    if (/Aug \d/.test(l.periodText)) return "2026-08";
  }
  const n = Number(l.num);
  if (!Number.isFinite(n)) return "other";
  if (n === 10550) return "2026-08";
  if (n === 10618) return "2026-07"; // Techlead July (ties $3,555 cent-exact)
  if (n >= 10593) return "2026-08"; // 10593–10603 batch + 10619 (Techlead Aug)
  if (n >= 10546 && n <= 10564) return "2026-07";
  return "other";
}

// ---------------------------------------------------------------------------
// 3. Name + product mapping between her books and our close.
// ---------------------------------------------------------------------------
const NAME_OVERRIDES: Record<string, string> = {
  // Her books call this partner TDI Technologies; the pricing sheet/usage call
  // it Teledata Cloud Services. Same partner (identical line structure both
  // months: ENDPOINT PROTECTION Flex 16×4.12 + ESSENTIALS Flex 4).
  "tdi technologies": "teledata cloud services",
  vienerx: "viener4gates",
  "vienerx consulting": "viener4gates",
  "net-tech": "net-tech consulting",
  "it network solutions": "it network solutions group",
};

/**
 * Her QB item descriptions carry the vendor/usage product names; our close
 * labels lines by the pricing-card row name. vendorSku is the stable join key
 * (DraftLine.vendorSku is the USAGE sku even when a card row with a different
 * name priced it — e.g. Teledata's ENDPOINT PROTECTION Flex priced via the
 * "Coro AI Endpoint" row).
 */
const HER_PRODUCT_TO_SKU: Record<string, string> = {
  "coro essentials flex": "bucoroflex",
  "coro complete flex": "bucomflex",
  "managed coro complete flex": "bucommngflex",
  "coro classic flex": "bucoclassflex",
  "managed coro classic flex": "bucoclassmnflex",
  "network flex": "modnetwflex",
  "email security flex": "modemailflex",
  "endpoint data governance flex": "modenddataflex",
  "endpoint security flex": "modendsecflex",
  "user data governance flex": "modusrdataflex",
  "cloud security flex": "modcloudflex",
  "secured web gateway flex": "addsecurewebflex",
  "security awareness training flex": "modsatflex",
  "email protection flex": "buemailflex",
  "endpoint protection flex": "buendflex",
  "coro ai complete": "cor-comp-c",
  "coro ai essentials": "cor-ess-c",
  "coro ai lite": "cor-lte-c",
  "coro ai endpoint": "cor-endp-c",
  "coro managed": "cor-manage-c",
};

function normName(s: string): string {
  let n = s
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|llc|ltd)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  n = NAME_OVERRIDES[n] ?? n;
  return n;
}

function normProduct(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*-\s*per\s+(user|device)\s*\/\s*month\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// 4. Reference figures from her screenshots (validation + July view).
// ---------------------------------------------------------------------------
/** Her 2026-08 Overview screenshot (v2 prod run, 2026-09-28). */
const SCREENSHOT_AUG: Record<string, number> = {
  "techlead professional services": 3515.0,
  "net-tech consulting": 2486.4,
  viener4gates: 1811.2,
  "ideal tech help": 1521.75,
  "bene international": 1032.0,
  "meeting tree computer": 750.0,
  "cyber construction": 632.7,
  amplivity: 494.0,
  "xtb solutions": 358.25,
  rocker: 294.4,
  "evolve technologies": 263.4,
  "avox ": 250.0,
  "it network solutions group": 174.5,
  "goa-tech": 115.8,
  "teledata cloud services": 79.0,
  "hurricane it": 0.0,
};

/** Her 2026-07 Overview screenshot (workbench July run). */
const SCREENSHOT_JUL: Record<string, number> = {
  "techlead professional services": 3555.0,
  "bene international": 1020.0,
  "meeting tree computer": 717.0,
  "ideal tech help": 496.5,
  "cyber construction": 376.1,
  "xtb solutions": 362.0,
  "evolve technologies": 263.4,
  "it network solutions group": 130.75,
  "teledata cloud services": 79.0,
  rocker: 70.4,
};

// ---------------------------------------------------------------------------
// 5. Diff.
// ---------------------------------------------------------------------------
const money = (n: number) => n.toFixed(2);

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const close = runClose();
  const ledger = parseLedger(LEDGER_XLSX);

  const md: string[] = [];
  md.push("# Close vs QB ledger — Lita's 2026-09-28 P&L Detail export");
  md.push("");
  md.push(`Inputs: ${PRICING_CSV.split("\\").pop()}, ${USAGE_XLSX.split("\\").pop()}, ` +
    `${CORO_INVOICE_XLSX.split("\\").pop()}; ledger ${String(LEDGER_XLSX).split("\\").pop()}.`);
  md.push("");

  // Historical note: on 2026-09-28 the PRE-override close was validated
  // against her prod-v2 August screenshot — all 16 partners tied at
  // $13,778.40 exactly. The accounting-confirmed rates (confirmedRates.ts)
  // were then adopted, deliberately moving drafted totals; SCREENSHOT_AUG
  // below is kept as that historical reference, not asserted.
  void SCREENSHOT_AUG;
  const closeByName = new Map(close.partners.map((p) => [normName(p.cardName), p]));
  const closeTotal = close.partners.reduce((s, p) => s.add(p.totalL), Money.zero());
  md.push(`Close grand total **$${closeTotal.toFixed2()}** (post confirmed-rates adoption; ` +
    `pre-adoption run tied her 2026-09-28 screenshot at $13,778.40 on all 16 partners).`);
  md.push("");

  // --- her August invoice lines, grouped partner → product ---
  const herAug = ledger.filter((l) => l.txnType === "Invoice" && monthOf(l) === "2026-08");
  const herJul = ledger.filter((l) => l.txnType === "Invoice" && monthOf(l) === "2026-07");
  const herByPartner = new Map<string, Map<string, { amount: number; nums: Set<string>; label: string }>>();
  for (const l of herAug) {
    const pk = normName(l.name);
    const prodNorm = normProduct(l.product);
    const prodK = HER_PRODUCT_TO_SKU[prodNorm] ?? prodNorm;
    let m = herByPartner.get(pk);
    if (!m) herByPartner.set(pk, (m = new Map()));
    let e = m.get(prodK);
    if (!e) m.set(prodK, (e = { amount: 0, nums: new Set(), label: l.product }));
    e.amount += l.amount;
    e.nums.add(l.num);
  }

  // --- August line diff ---
  md.push("## August — line-by-line (our close vs her QB invoices)");
  md.push("");
  const csvRows: string[] = [
    "partner,product,our_qty,our_unitL,our_amount,her_amount,delta,her_implied_unit,her_inv,note",
  ];
  const partnerKeys = new Set<string>([
    ...close.partners.map((p) => normName(p.cardName)),
    ...herByPartner.keys(),
  ]);
  const partnerSummary: { name: string; ours: number; hers: number }[] = [];

  for (const pk of [...partnerKeys].sort()) {
    const p = closeByName.get(pk);
    const hers = herByPartner.get(pk);
    const ourTotal = p ? p.totalL.toNumber() : 0;
    const herTotal = hers ? [...hers.values()].reduce((s, e) => s + e.amount, 0) : 0;
    partnerSummary.push({ name: p?.cardName ?? pk, ours: ourTotal, hers: herTotal });
    if (Math.abs(ourTotal - herTotal) < 0.005) continue; // exact tie — no detail needed

    md.push(`### ${p?.cardName ?? pk} — ours $${money(ourTotal)} vs QB $${money(herTotal)} (Δ ${money(ourTotal - herTotal)})`);
    md.push("");
    md.push("| Product | our qty | our unit L | our amount | her amount | Δ | her implied unit | her inv |");
    md.push("|---|---:|---:|---:|---:|---:|---:|---|");

    const prodKeys = new Set<string>([
      ...(p ? p.lines.map((l) => l.vendorSku.trim().toLowerCase()) : []),
      ...(hers ? hers.keys() : []),
    ]);
    for (const prodK of [...prodKeys].sort()) {
      const ourLines = p ? p.lines.filter((l) => l.vendorSku.trim().toLowerCase() === prodK) : [];
      const qty = ourLines.reduce((s, l) => s + l.quantity, 0);
      const amt = ourLines.reduce((s, l) => s + (l.amountL ? l.amountL.toNumber() : 0), 0);
      const held = ourLines.some((l) => l.unitL === null);
      const unitL = ourLines.find((l) => l.unitL)?.unitL?.toFixed2() ?? (held ? "HELD" : "—");
      const her = hers?.get(prodK);
      const herAmt = her ? her.amount : 0;
      const delta = amt - herAmt;
      if (Math.abs(delta) < 0.005 && her) continue; // line ties — skip noise
      const implied = her && qty > 0 ? (herAmt / qty).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : "";
      const ourLabel = ourLines[0] ? `${ourLines[0].productLabel} [${prodK}]` : null;
      const label = ourLabel ?? `${her?.label ?? prodK} [${prodK}]`;
      const note = !her ? "not on her invoice" : ourLines.length === 0 ? "NOT IN OUR CLOSE" : "";
      md.push(`| ${label} | ${qty || ""} | ${unitL} | ${money(amt)} | ${her ? money(herAmt) : "—"} | ${money(delta)} | ${implied} | ${her ? [...her.nums].join("+") : ""} |`);
      csvRows.push(
        [
          JSON.stringify(p?.cardName ?? pk),
          JSON.stringify(label),
          qty || "",
          unitL,
          money(amt),
          her ? money(herAmt) : "",
          money(delta),
          implied,
          her ? [...her.nums].join("+") : "",
          JSON.stringify(note),
        ].join(",")
      );
    }
    md.push("");
  }

  md.push("### August partner totals");
  md.push("");
  md.push("| Partner | our close | her QB | Δ (ours − hers) |");
  md.push("|---|---:|---:|---:|");
  let oursSum = 0;
  let hersSum = 0;
  for (const s of partnerSummary.sort((a, b) => b.hers + b.ours - (a.hers + a.ours))) {
    oursSum += s.ours;
    hersSum += s.hers;
    md.push(`| ${s.name} | ${money(s.ours)} | ${money(s.hers)} | ${money(s.ours - s.hers)} |`);
  }
  md.push(`| **Total** | **${money(oursSum)}** | **${money(hersSum)}** | **${money(oursSum - hersSum)}** |`);
  md.push("");

  // --- July, partner level (no full July usage file — totals from her July screenshot) ---
  md.push("## July — partner totals (workbench screenshot vs her QB invoices)");
  md.push("");
  const julByPartner = new Map<string, number>();
  const julNums = new Map<string, Set<string>>();
  for (const l of herJul) {
    const pk = normName(l.name);
    julByPartner.set(pk, (julByPartner.get(pk) ?? 0) + l.amount);
    if (!julNums.has(pk)) julNums.set(pk, new Set());
    julNums.get(pk)!.add(l.num);
  }
  md.push("| Partner | workbench (her run) | her QB | Δ | her inv |");
  md.push("|---|---:|---:|---:|---|");
  const julKeys = new Set<string>([...Object.keys(SCREENSHOT_JUL).map(normName), ...julByPartner.keys()]);
  for (const pk of [...julKeys].sort()) {
    const wb = SCREENSHOT_JUL[pk] ?? Object.entries(SCREENSHOT_JUL).find(([k]) => normName(k) === pk)?.[1] ?? 0;
    const qb = julByPartner.get(pk) ?? 0;
    md.push(`| ${pk} | ${money(wb)} | ${money(qb)} | ${money(wb - qb)} | ${[...(julNums.get(pk) ?? [])].join("+")} |`);
  }
  md.push("");

  // --- cost side: her booked Coro bills vs the close's cost view ---
  md.push("## Cost side — Coro bills in her AP vs the close");
  md.push("");
  const bills = new Map<string, number>();
  for (const l of ledger.filter((x) => x.txnType === "Bill")) {
    bills.set(l.num, (bills.get(l.num) ?? 0) + l.amount);
  }
  for (const [num, amt] of bills) md.push(`- Booked bill **${num}**: $${money(amt)}`);
  const totalHExpected = close.partners.reduce((s, p) => s.add(p.totalHExpected), Money.zero());
  const totalHActual = close.partners.reduce(
    (s, p) => (p.totalHActual ? s.add(p.totalHActual) : s),
    Money.zero()
  );
  md.push(`- Close expected cost (additive rule): $${totalHExpected.toFixed2()}`);
  md.push(`- Close actual cost (INVCUS2026-0002193 matched lines): $${totalHActual.toFixed2()}`);
  md.push(`- Close totalCreditExpected: $${close.totalCreditExpected.toFixed2()}`);
  md.push("");

  writeFileSync(join(OUT, "REPORT.md"), md.join("\n"), "utf-8");
  writeFileSync(join(OUT, "august-line-diff.csv"), csvRows.join("\n"), "utf-8");
  console.log(md.join("\n"));
  console.log(`\nWritten: ${join(OUT, "REPORT.md")}`);
}

main();
