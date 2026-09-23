/**
 * Tests for the QBO client helper (web/src/lib/qbo.ts). The module is DOM-free
 * by design — storage is injected — so it runs under plain Node vitest.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QBO_CONNECTION_KEY,
  REFRESH_SKEW_MS,
  ReconnectRequired,
  ensureFresh,
  loadConnection,
  loadPushed,
  persistConnection,
  pushInvoice,
  qboPushedStorageKey,
  recordPushed,
  type KV,
  type QboConnection,
} from "../../web/src/lib/qbo.js";

function memoryKV(): KV & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const NOW = 1_800_000_000_000;
const CONN: QboConnection = {
  realmId: "realm9",
  accessToken: "A1",
  refreshToken: "R1",
  expiresAt: NOW + 60 * 60 * 1000,
  refreshTokenExpiresAt: NOW + 100 * 24 * 60 * 60 * 1000,
};

function refreshOk(access: string, refresh: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      accessToken: access,
      refreshToken: refresh,
      expiresAt: NOW + 3600 * 1000,
      refreshTokenExpiresAt: NOW + 8_640_000 * 1000,
    }),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("loadConnection", () => {
  it("keeps a v1-shaped record (no refreshTokenExpiresAt) alive even past access expiry", () => {
    const kv = memoryKV();
    kv.setItem(
      QBO_CONNECTION_KEY,
      JSON.stringify({ realmId: "r", accessToken: "a", refreshToken: "rt", expiresAt: NOW - 1000 })
    );
    expect(loadConnection(kv, NOW)).not.toBeNull();
  });

  it("drops a connection whose refresh token has expired", () => {
    const kv = memoryKV();
    kv.setItem(QBO_CONNECTION_KEY, JSON.stringify({ ...CONN, refreshTokenExpiresAt: NOW - 1 }));
    expect(loadConnection(kv, NOW)).toBeNull();
  });
});

describe("ensureFresh", () => {
  it("does not refresh when more than the skew remains", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const kv = memoryKV();
    const c = { ...CONN, expiresAt: NOW + REFRESH_SKEW_MS + 1000 };
    expect(await ensureFresh(kv, c, NOW)).toBe(c);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes inside the skew window and persists the ROTATED pair", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(refreshOk("A2", "R2"));
    vi.stubGlobal("fetch", fetchMock);
    const kv = memoryKV();
    const c = { ...CONN, expiresAt: NOW + REFRESH_SKEW_MS - 1000 };
    const next = await ensureFresh(kv, c, NOW);
    expect(next.accessToken).toBe("A2");
    expect(next.refreshToken).toBe("R2");
    const stored = JSON.parse(kv.map.get(QBO_CONNECTION_KEY)!) as QboConnection;
    expect(stored.refreshToken).toBe("R2"); // rotation persisted immediately
  });

  it("throws ReconnectRequired when the refresh endpoint says 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "expired" }) })
    );
    const kv = memoryKV();
    const c = { ...CONN, expiresAt: NOW - 1 };
    await expect(ensureFresh(kv, c, NOW)).rejects.toBeInstanceOf(ReconnectRequired);
  });

  it("keeps the connection on a transient refresh failure (Intuit 5xx)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: "Intuit token refresh failed" }) })
    );
    const kv = memoryKV();
    const c = { ...CONN, expiresAt: NOW - 1 };
    const err = await ensureFresh(kv, c, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ReconnectRequired);
    expect((err as Error).message).toContain("Intuit token refresh failed");
  });

  it("treats a refresh 400 as a dead session (invalid_grant)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) })
    );
    const kv = memoryKV();
    const c = { ...CONN, expiresAt: NOW - 1 };
    await expect(ensureFresh(kv, c, NOW)).rejects.toBeInstanceOf(ReconnectRequired);
  });
});

describe("pushInvoice", () => {
  const INVOICE = {
    partner: "Rocker Cybersecurity",
    docNumber: "HUB-202608-004",
    lines: [{ description: "Coro Complete", quantity: 2, rate: 10, amount: 20 }],
  };

  it("maps a create to outcome created", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, deduped: false, qboInvoiceId: "501" }),
      })
    );
    const kv = memoryKV();
    const { outcome } = await pushInvoice(kv, CONN, INVOICE, NOW);
    expect(outcome).toEqual({ kind: "created", qboInvoiceId: "501" });
  });

  it("maps dedup responses to already / totals-differ", async () => {
    const dedup = (totalsMatch: boolean) => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        deduped: true,
        qboInvoiceId: "77",
        qboDocNumber: "HUB-202608-004",
        qboTotalCents: totalsMatch ? 2000 : 2100,
        expectedTotalCents: 2000,
        totalsMatch,
        duplicateCount: 1,
      }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(dedup(true)));
    const kv = memoryKV();
    let r = await pushInvoice(kv, CONN, INVOICE, NOW);
    expect(r.outcome).toEqual({
      kind: "already",
      qboInvoiceId: "77",
      qboDocNumber: "HUB-202608-004",
      duplicateCount: 1,
    });
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(dedup(false)));
    r = await pushInvoice(kv, CONN, INVOICE, NOW);
    expect(r.outcome).toEqual({
      kind: "totals-differ",
      qboInvoiceId: "77",
      qboTotalCents: 2100,
      expectedTotalCents: 2000,
    });
  });

  it("on 401: refreshes once, retries once with the new token, never twice", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push(url);
      if (url === "/api/qbo/push" && calls.filter((u) => u === "/api/qbo/push").length === 1) {
        return { ok: false, status: 401, json: async () => ({ error: "expired" }) };
      }
      if (url === "/api/qbo/refresh") return refreshOk("A2", "R2");
      // Second push must carry the ROTATED access token.
      expect(init?.body).toContain('"accessToken":"A2"');
      return { ok: true, status: 200, json: async () => ({ ok: true, deduped: false, qboInvoiceId: "9" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const kv = memoryKV();
    const { outcome, conn } = await pushInvoice(kv, CONN, INVOICE, NOW);
    expect(outcome).toEqual({ kind: "created", qboInvoiceId: "9" });
    expect(conn.accessToken).toBe("A2");
    expect(calls).toEqual(["/api/qbo/push", "/api/qbo/refresh", "/api/qbo/push"]);
    // The rotated pair must be in storage BEFORE the retried call could ever
    // observe it — pinning the persist at the reactive (401) path.
    expect((JSON.parse(kv.map.get(QBO_CONNECTION_KEY)!) as QboConnection).refreshToken).toBe("R2");
  });

  it("throws ReconnectRequired when the retry also 401s", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/qbo/refresh") return refreshOk("A2", "R2");
      return { ok: false, status: 401, json: async () => ({ error: "expired" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const kv = memoryKV();
    await expect(pushInvoice(kv, CONN, INVOICE, NOW)).rejects.toBeInstanceOf(ReconnectRequired);
    // push, refresh, push — and NOT a second refresh.
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/qbo/push", "/api/qbo/refresh", "/api/qbo/push"]);
  });
});

describe("pushed-state", () => {
  it("keys by period + first-12 fingerprint chars, same discipline as reviewStorageKey", () => {
    expect(qboPushedStorageKey("2026-08", "a".repeat(64), "b".repeat(64))).toBe(
      `qbo-pushed:2026-08:${"a".repeat(12)}:${"b".repeat(12)}`
    );
  });

  it("records and loads per-slug pushed records", () => {
    const kv = memoryKV();
    const key = qboPushedStorageKey("2026-08", "a".repeat(64), "b".repeat(64));
    const next = recordPushed(kv, key, "rocker", {
      qboInvoiceId: "501",
      docNumber: "HUB-202608-004",
      totalCents: 2345,
      at: NOW,
    });
    expect(next["rocker"]!.qboInvoiceId).toBe("501");
    expect(loadPushed(kv, key)["rocker"]!.docNumber).toBe("HUB-202608-004");
    expect(loadPushed(kv, "qbo-pushed:other")).toEqual({});
  });
});
