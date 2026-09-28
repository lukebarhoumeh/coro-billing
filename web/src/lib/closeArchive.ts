/**
 * Local close archive — CloseSnapshots in injected KV storage (localStorage in
 * the app; memory in tests). Spec 2026-09-28 §3: local-only, export/import as
 * the backup path, newest-savedAt wins on merge, invalid imports rejected
 * wholesale. Same DOM-free discipline as qbo.ts.
 */
import { CloseSnapshotSchema, type CloseSnapshot, type CreditStatus } from "../../../src/domain/snapshot.js";
import type { KV } from "./qbo.js";

const INDEX_KEY = "coro-archive:v1:index";
const keyFor = (period: string) => `coro-archive:v1:${period}`;

function readIndex(kv: KV): string[] {
  try {
    const raw = kv.getItem(INDEX_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch { return []; }
}

function writeIndex(kv: KV, periods: string[]): void {
  kv.setItem(INDEX_KEY, JSON.stringify([...new Set(periods)].sort()));
}

export function saveSnapshot(kv: KV, snap: CloseSnapshot): void {
  kv.setItem(keyFor(snap.period), JSON.stringify(snap));
  writeIndex(kv, [...readIndex(kv), snap.period]);
}

export function loadSnapshot(kv: KV, period: string): CloseSnapshot | null {
  try {
    const raw = kv.getItem(keyFor(period));
    if (raw === null) return null;
    const parsed = CloseSnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** Sorted period list (only periods whose snapshot actually loads). */
export function listPeriods(kv: KV): string[] {
  return readIndex(kv).filter((p) => loadSnapshot(kv, p) !== null).sort();
}

export function exportArchive(kv: KV): string {
  const snapshots = listPeriods(kv).map((p) => loadSnapshot(kv, p)!);
  return JSON.stringify({ kind: "coro-close-archive", v: 1, snapshots }, null, 2);
}

const ArchiveFileSchema = { parse: (raw: unknown) => {
  if (typeof raw !== "object" || raw === null) throw new Error("not an archive file");
  const o = raw as { kind?: unknown; v?: unknown; snapshots?: unknown };
  if (o.kind !== "coro-close-archive" || o.v !== 1 || !Array.isArray(o.snapshots)) {
    throw new Error("not a coro close archive (kind/v mismatch)");
  }
  return o.snapshots.map((s) => CloseSnapshotSchema.parse(s));
}};

/** Merge an exported archive: newest savedAt wins per period. Throws on any invalid content; imports nothing partial. */
export function importArchive(kv: KV, json: string): { imported: number; skipped: number } {
  const snapshots = ArchiveFileSchema.parse(JSON.parse(json));
  let imported = 0, skipped = 0;
  for (const snap of snapshots) {
    const existing = loadSnapshot(kv, snap.period);
    if (existing !== null && existing.savedAt >= snap.savedAt) { skipped++; continue; }
    saveSnapshot(kv, snap);
    imported++;
  }
  return { imported, skipped };
}

export function setCreditStatus(kv: KV, period: string, slug: string, status: CreditStatus): void {
  const snap = loadSnapshot(kv, period);
  if (snap === null) return;
  saveSnapshot(kv, { ...snap, creditStatus: { ...snap.creditStatus, [slug]: status } });
}
