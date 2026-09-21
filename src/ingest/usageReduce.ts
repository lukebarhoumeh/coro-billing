/**
 * usageReduce — collapse the real Coro metric model into billed quantities.
 *
 * The August 2026 usage file carries each (workspace, SKU) TWICE — one row with
 * Metric="Users", one with Metric="Devices" — and states the billed quantity in the
 * row's own Audit string (docs/AUGUST_CLOSE_PLAN.md fact 5):
 *
 *   "LEGACY | u=13 d=14 | CORO_ESSENTIALS=14 [math.max(users, devices)] | NETWORK=11 [devices]"
 *
 * The audit-stated number IS Coro's billed figure, so it is PRIMARY. We also reduce
 * users/devices ourselves per the bracketed rule and cross-check: a mismatch raises
 * AUDIT_QTY_MISMATCH (warn) — surfaced, never silently reconciled.
 *
 * Also performed here (because both need the metric grain):
 *   - partner slug → invoice-name mapping (src/config/partners.ts, decision D6);
 *     unmapped slugs flag UNMAPPED_PARTNER (warn) and keep the cleaned slug.
 *   - CHANNEL rows (the partner's own workspace) become partner-level lines
 *     (customer = null); CHILD rows keep their workspace slug as the customer.
 *
 * Files without the metric model (no Metric column — all synthetic fixtures and any
 * legacy-format drop) pass through with quantities summed per (partner, customer,
 * sku) and partners mapped, so the pre-metric behavior is preserved.
 *
 * Deterministic: output ordered by first appearance of each (partner, customer, sku)
 * group; no clock, no randomness.
 */
import { canonicalPartner } from "../config/partners.js";
import type { Exception, UsageLine } from "../domain/types.js";

export interface ReducedUsage {
  /** One line per (partner, customer, sku), quantity = billed qty. */
  readonly billed: UsageLine[];
  /** UNMAPPED_PARTNER / AUDIT_QTY_MISMATCH warnings, in first-seen order. */
  readonly exceptions: Exception[];
}

/** The reduction rule a Coro audit string states for one product. */
type AuditRule = "users" | "devices" | "max";

interface AuditEntry {
  readonly qty: number;
  readonly rule: AuditRule;
}

/**
 * Parse the audit entry for ONE product family out of a row's audit string.
 * `CORO_ESSENTIALS=14 [math.max(users, devices)]` → { qty: 14, rule: "max" }.
 * Returns null when the product is absent or the string is unparseable.
 */
export function parseAuditEntry(audit: string, productFamily: string): AuditEntry | null {
  if (!productFamily) return null;
  // Escape regex metacharacters in the product family (defensive; families are A-Z_).
  const esc = productFamily.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\|)\\s*${esc}=(\\d+)\\s*\\[([^\\]]+)\\]`).exec(audit);
  if (!m) return null;
  const qty = Number(m[1]);
  if (!Number.isFinite(qty)) return null;
  const ruleText = m[2]!.toLowerCase();
  const rule: AuditRule = ruleText.includes("max")
    ? "max"
    : ruleText.includes("device")
      ? "devices"
      : "users";
  return { qty, rule };
}

/** Apply an audit rule to the summed users/devices metrics. */
function applyRule(rule: AuditRule, users: number, devices: number): number {
  switch (rule) {
    case "users":
      return users;
    case "devices":
      return devices;
    case "max":
      return Math.max(users, devices);
  }
}

function warn(
  kind: Exception["kind"],
  line: UsageLine,
  partner: string,
  customer: string | null,
  message: string
): Exception {
  return {
    kind,
    severity: "warn",
    partner,
    customer,
    sku: line.sku.vendorSku,
    period: line.period,
    message,
    sourceRow: line.sourceRow,
  };
}

/**
 * Reduce parsed usage lines to billed lines (one per partner+customer+sku) with the
 * partner mapped to its invoice name. See module doc for the exact rules.
 */
export function reduceUsage(lines: readonly UsageLine[]): ReducedUsage {
  const exceptions: Exception[] = [];
  const flaggedUnmapped = new Set<string>(); // one UNMAPPED_PARTNER per distinct slug

  // Group metric rows by (partner, customer, sku). Map preserves first-seen order.
  interface Group {
    readonly first: UsageLine;
    readonly partner: string;
    readonly customer: string | null;
    users: number;
    devices: number;
    /** Sum of quantities for rows with no metric label (pass-through files). */
    plain: number;
    hasMetric: boolean;
  }
  const groups = new Map<string, Group>();

  for (const line of lines) {
    const canon = canonicalPartner(line.partner);
    if (!canon.mapped && !flaggedUnmapped.has(canon.name)) {
      flaggedUnmapped.add(canon.name);
      exceptions.push(
        warn(
          "UNMAPPED_PARTNER",
          line,
          canon.name,
          line.customer,
          `usage partner "${line.partner}" is not in the curated slug map ` +
            `(src/config/partners.ts) — using cleaned slug "${canon.name}"; review before billing`
        )
      );
    }

    // CHANNEL rows are the partner's own workspace → partner-level (customer null).
    // A row whose workspace equals the parent slug is treated the same.
    const isChannel =
      line.wsType?.toUpperCase() === "CHANNEL" ||
      (line.customer !== null && line.customer === line.partner);
    const customer = isChannel ? null : line.customer;

    // JSON key: collision-free (null customer vs "" customer handled natively).
    const key = JSON.stringify([canon.name, customer, line.sku.vendorSku]);
    let g = groups.get(key);
    if (!g) {
      g = {
        first: line,
        partner: canon.name,
        customer,
        users: 0,
        devices: 0,
        plain: 0,
        hasMetric: false,
      };
      groups.set(key, g);
    }

    const metric = line.metric?.toLowerCase();
    if (metric === "users") {
      g.users += line.quantity;
      g.hasMetric = true;
    } else if (metric === "devices") {
      g.devices += line.quantity;
      g.hasMetric = true;
    } else {
      // No metric label: legacy/synthetic format — quantities are already billed.
      g.plain += line.quantity;
    }
  }

  const billed: UsageLine[] = [];
  for (const g of groups.values()) {
    const line = g.first;
    let quantity: number;

    if (!g.hasMetric) {
      quantity = g.plain;
    } else {
      // Metric model: prefer Coro's audit-stated qty; cross-check our reduction.
      const family = line.product ?? "";
      const entry = line.audit !== undefined ? parseAuditEntry(line.audit, family) : null;
      if (entry !== null) {
        quantity = entry.qty;
        const reduced = applyRule(entry.rule, g.users, g.devices);
        if (reduced !== entry.qty) {
          exceptions.push(
            warn(
              "AUDIT_QTY_MISMATCH",
              line,
              g.partner,
              g.customer,
              `Coro audit states ${family}=${entry.qty} [${entry.rule}] but our ` +
                `${entry.rule}(users=${g.users}, devices=${g.devices}) = ${reduced} — ` +
                `using Coro's stated ${entry.qty}; review`
            )
          );
        }
      } else {
        // No parseable audit entry: fall back to max(users, devices) — the dominant
        // rule in the real file — and say so (never a silent default).
        quantity = Math.max(g.users, g.devices);
        exceptions.push(
          warn(
            "AUDIT_QTY_MISMATCH",
            line,
            g.partner,
            g.customer,
            `no parseable audit entry for product "${family}" ` +
              `(audit=${JSON.stringify(line.audit ?? null)}); ` +
              `fell back to max(users=${g.users}, devices=${g.devices}) = ${quantity} — review`
          )
        );
      }
    }

    // The metric label no longer applies to a reduced line (drop it); the audit
    // string stays — it is the provenance of the billed quantity.
    const { metric: _metric, ...rest } = line;
    billed.push({
      ...rest,
      partner: g.partner,
      // Raw parent slug pre-mapping — the special-pricing CSV joins on this.
      partnerSlug: line.partner,
      customer: g.customer,
      quantity,
    });
  }

  return { billed, exceptions };
}
