import { describe, it, expect } from "vitest";
import {
  saveSnapshot, loadSnapshot, listPeriods, exportArchive, importArchive, setCreditStatus,
} from "../../web/src/lib/closeArchive.js";
import type { CloseSnapshot } from "../../src/domain/snapshot.js";
import type { KV } from "../../web/src/lib/qbo.js";

function memoryKV(): KV & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

function snap(period: string, savedAt: string, billed = "100.00"): CloseSnapshot {
  return {
    v: 1, period, savedAt, ratesRevision: 1,
    fingerprints: { pricing: "aaaaaaaaaaaa", usage: "bbbbbbbbbbbb" },
    totals: { billedL: billed, costExpected: "80.00", margin: "20.00", creditExpected: "0.00" },
    partners: [], creditStatus: {},
  };
}

describe("closeArchive", () => {
  it("saves, lists (sorted), and loads snapshots", () => {
    const kv = memoryKV();
    saveSnapshot(kv, snap("2026-08", "2026-09-28T00:00:00.000Z"));
    saveSnapshot(kv, snap("2026-07", "2026-09-28T00:00:00.000Z"));
    expect(listPeriods(kv)).toEqual(["2026-07", "2026-08"]);
    expect(loadSnapshot(kv, "2026-08")!.totals.billedL).toBe("100.00");
    expect(loadSnapshot(kv, "2026-01")).toBeNull();
  });

  it("overwrites the same period", () => {
    const kv = memoryKV();
    saveSnapshot(kv, snap("2026-08", "2026-09-28T00:00:00.000Z", "100.00"));
    saveSnapshot(kv, snap("2026-08", "2026-09-29T00:00:00.000Z", "200.00"));
    expect(listPeriods(kv)).toEqual(["2026-08"]);
    expect(loadSnapshot(kv, "2026-08")!.totals.billedL).toBe("200.00");
  });

  it("survives corrupted storage entries", () => {
    const kv = memoryKV();
    kv.map.set("coro-archive:v1:index", "not json");
    expect(listPeriods(kv)).toEqual([]);
    saveSnapshot(kv, snap("2026-08", "2026-09-28T00:00:00.000Z"));
    expect(listPeriods(kv)).toEqual(["2026-08"]);
  });

  it("exports all and imports with newest-wins merge + validation", () => {
    const a = memoryKV();
    saveSnapshot(a, snap("2026-07", "2026-09-01T00:00:00.000Z", "70.00"));
    saveSnapshot(a, snap("2026-08", "2026-09-28T00:00:00.000Z", "100.00"));
    const json = exportArchive(a);

    const b = memoryKV();
    saveSnapshot(b, snap("2026-08", "2026-09-29T00:00:00.000Z", "999.00")); // newer than export
    const res = importArchive(b, json);
    expect(res).toEqual({ imported: 1, skipped: 1 }); // 07 in, 08 skipped (older)
    expect(loadSnapshot(b, "2026-08")!.totals.billedL).toBe("999.00");
    expect(loadSnapshot(b, "2026-07")!.totals.billedL).toBe("70.00");
  });

  it("rejects invalid import wholesale", () => {
    const kv = memoryKV();
    expect(() => importArchive(kv, '{"nope":true}')).toThrow();
    expect(listPeriods(kv)).toEqual([]);
  });

  it("updates credit status in place", () => {
    const kv = memoryKV();
    saveSnapshot(kv, snap("2026-08", "2026-09-28T00:00:00.000Z"));
    setCreditStatus(kv, "2026-08", "evolvewithuscom", "memo-received");
    expect(loadSnapshot(kv, "2026-08")!.creditStatus["evolvewithuscom"]).toBe("memo-received");
  });
});
