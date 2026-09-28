/**
 * CloseSnapshot v1 — the archived form of a monthly close (spec 2026-09-28 §3).
 *
 * Built purely from a CloseModel: deterministic, clock-free (savedAt is a
 * parameter), Money serialized as toFixed2 strings so snapshots survive JSON.
 * The archive store (web/src/lib/closeArchive.ts) persists these locally —
 * nothing ever leaves the browser except user-initiated exports.
 */
import { z } from "zod";
import type { CloseModel } from "./types.js";

export type CreditStatus = "expected" | "memo-received" | "applied";

const money = z.string().regex(/^-?\d+\.\d{2}$/);

export const CloseSnapshotSchema = z.object({
  v: z.literal(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  savedAt: z.string(),
  ratesRevision: z.number().int().nonnegative(),
  fingerprints: z.object({
    pricing: z.string().min(6),
    usage: z.string().min(6),
    invoice: z.string().min(6).optional(),
  }),
  totals: z.object({
    billedL: money, costExpected: money, costActual: money.optional(),
    margin: money, creditExpected: money,
  }),
  partners: z.array(z.object({
    slug: z.string(), cardName: z.string(),
    billedL: money, costExpected: money, costActual: money.optional(),
    margin: money, creditExpected: money, heldLines: z.number().int().nonnegative(),
    lines: z.array(z.object({
      vendorSku: z.string(), productLabel: z.string(), quantity: z.number(),
      unitL: money.optional(), amountL: money.optional(),
      marginBasis: z.enum(["actual", "expected-additive", "none"]),
      margin: money.optional(), creditExpected: money.optional(),
      customers: z.array(z.object({ customer: z.string().nullable(), quantity: z.number() })),
    })),
  })),
  creditStatus: z.record(z.string(), z.enum(["expected", "memo-received", "applied"])),
});

export type CloseSnapshot = z.infer<typeof CloseSnapshotSchema>;

export function snapshotFromClose(
  model: CloseModel,
  fingerprints: { pricing: string; usage: string; invoice?: string },
  ratesRevision: number,
  savedAt: string
): CloseSnapshot {
  const partners = model.partners.map((p) => ({
    slug: p.slug,
    cardName: p.cardName,
    billedL: p.totalL.toFixed2(),
    costExpected: p.totalHExpected.toFixed2(),
    ...(p.totalHActual !== null ? { costActual: p.totalHActual.toFixed2() } : {}),
    margin: p.totalMargin.toFixed2(),
    creditExpected: p.totalCreditExpected.toFixed2(),
    heldLines: p.heldLines,
    lines: p.lines.map((l) => ({
      vendorSku: l.vendorSku,
      productLabel: l.productLabel,
      quantity: l.quantity,
      ...(l.unitL !== null ? { unitL: l.unitL.toFixed2() } : {}),
      ...(l.amountL !== null ? { amountL: l.amountL.toFixed2() } : {}),
      marginBasis: l.marginBasis,
      ...(l.margin !== null ? { margin: l.margin.toFixed2() } : {}),
      ...(l.creditExpected !== null ? { creditExpected: l.creditExpected.toFixed2() } : {}),
      customers: l.customers.map((c) => ({ customer: c.customer, quantity: c.quantity })),
    })),
  }));

  const sumFixed = (get: (p: (typeof partners)[number]) => string | undefined): string => {
    const cents = partners.reduce((s, p) => {
      const v = get(p);
      return s + (v === undefined ? 0 : Math.round(Number(v) * 100));
    }, 0);
    return (cents / 100).toFixed(2);
  };

  const anyActual = model.partners.some((p) => p.totalHActual !== null);

  return {
    v: 1,
    period: model.period,
    savedAt,
    ratesRevision,
    fingerprints,
    totals: {
      billedL: sumFixed((p) => p.billedL),
      costExpected: sumFixed((p) => p.costExpected),
      ...(anyActual ? { costActual: sumFixed((p) => p.costActual) } : {}),
      margin: sumFixed((p) => p.margin),
      creditExpected: model.totalCreditExpected.toFixed2(),
    },
    partners,
    creditStatus: Object.fromEntries(
      model.partners
        .filter((p) => p.totalCreditExpected.toCents() !== 0)
        .map((p) => [p.slug, "expected" as const])
    ),
  };
}
