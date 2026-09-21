/**
 * Pure in-browser file ingestion for the rate-card close.
 *
 * The account team drops three files each month; everything parses HERE, in the
 * browser — bytes never leave the machine. This module is deliberately free of
 * DOM types (no `File`) and of web-only import aliases so the root Vitest suite
 * exercises it directly; the React store (closeStore.tsx) owns the File objects
 * and hands us bytes.
 *
 * Slots:
 *   pricing — Coro Special MSP Pricing CSV (required)
 *   usage   — MSP Hub_<Month> Usage.xlsx (required)
 *   invoice — Coro_Invoice_INVCUS….xlsx (optional; unlocks the cost cross-check)
 */
import { parseSpecialPricing } from "../../../src/ingest/specialPricing.js";
import { parseUsage } from "../../../src/ingest/usage.js";
import { parseCoroInvoice } from "../../../src/ingest/coroInvoice.js";
import { isOk, type Result, ok, err } from "../../../src/lib/result.js";
import type {
  CoroInvoiceLine,
  Period,
  SpecialPricingResult,
  UsageLine,
} from "../../../src/domain/types.js";

export type SlotKey = "pricing" | "usage" | "invoice";

export type SlotPayload =
  | { readonly slot: "pricing"; readonly pricing: SpecialPricingResult }
  | { readonly slot: "usage"; readonly usage: readonly UsageLine[] }
  | { readonly slot: "invoice"; readonly lines: readonly CoroInvoiceLine[] };

export interface SlotReport {
  /** Data rows/lines successfully read. */
  readonly rowsRead: number;
  /** Partner blocks (pricing slot only). */
  readonly partners?: number;
  /** Non-info parse findings, capped for display. */
  readonly warnings: readonly string[];
}

export interface ParsedSlot {
  readonly payload: SlotPayload;
  readonly report: SlotReport;
}

/** Hex SHA-256 of the file bytes — review state is keyed on this. */
export async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MONTHS: readonly string[] = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "MSP Hub_August 2026 Usage.xlsx" → "2026-08"; also accepts literal "2026-08". */
export function periodFromFileName(fileName: string): Period | null {
  const iso = /(\d{4})-(\d{2})/.exec(fileName);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const lower = fileName.toLowerCase();
  for (let i = 0; i < MONTHS.length; i++) {
    const m = new RegExp(`${MONTHS[i]}\\D{0,3}(\\d{4})`).exec(lower);
    if (m) return `${m[1]}-${String(i + 1).padStart(2, "0")}`;
  }
  return null;
}

/** "Coro_Invoice_INVCUS2026-0002193.xlsx" → "INVCUS2026-0002193". */
export function invoiceNumberFromFileName(fileName: string): string {
  const m = /(INV[A-Z]*\d{4}-\d+)/i.exec(fileName);
  return m ? m[1]! : fileName.replace(/\.(xlsx|xls)$/i, "");
}

const WARNING_CAP = 12;

/**
 * Parse one dropped file's bytes for its slot. Friendly errors name what the
 * slot expected — the most common mistake is dropping a file on the wrong slot.
 */
export function parseSlotBytes(
  slot: SlotKey,
  fileName: string,
  bytes: Uint8Array,
  period: Period
): Result<ParsedSlot, string> {
  try {
    switch (slot) {
      case "pricing": {
        const text = new TextDecoder("utf-8").decode(bytes);
        const r = parseSpecialPricing(text, period);
        if (!isOk(r)) {
          return err(
            `"${fileName}" does not look like the Coro Special MSP Pricing CSV: ${r.error.message}`
          );
        }
        const { partners, findings } = r.value;
        return ok({
          payload: { slot: "pricing", pricing: r.value },
          report: {
            rowsRead: partners.reduce((n, p) => n + p.rows.length, 0),
            partners: partners.length,
            warnings: findings
              .filter((f) => f.severity !== "info")
              .slice(0, WARNING_CAP)
              .map((f) => f.message),
          },
        });
      }
      case "usage": {
        const r = parseUsage({ buffer: bytes }, { period });
        if (!isOk(r)) {
          return err(
            `"${fileName}" does not look like the MSP Hub usage report: ${r.error.message}`
          );
        }
        return ok({
          payload: { slot: "usage", usage: r.value },
          report: { rowsRead: r.value.length, warnings: [] },
        });
      }
      case "invoice": {
        const r = parseCoroInvoice(
          { buffer: bytes },
          { invoiceNumber: invoiceNumberFromFileName(fileName), period }
        );
        if (!isOk(r)) {
          return err(`"${fileName}" does not look like a Coro tax invoice: ${r.error.message}`);
        }
        return ok({
          payload: { slot: "invoice", lines: r.value },
          report: { rowsRead: r.value.length, warnings: [] },
        });
      }
    }
  } catch (e) {
    return err(`could not read "${fileName}": ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** localStorage key for a month's review state — period + both required fingerprints. */
export function reviewStorageKey(period: Period, pricingFp: string, usageFp: string): string {
  return `coro-close-review:${period}:${pricingFp.slice(0, 12)}:${usageFp.slice(0, 12)}`;
}
