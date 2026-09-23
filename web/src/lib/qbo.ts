/**
 * QuickBooks connection + push client — owns the token lifecycle for the card.
 *
 * DOM-free by design (same rule as loadFiles.ts): storage is injected as a
 * minimal KV interface so the module runs under plain Node vitest. Two facts
 * drive the shape:
 *   1. Intuit ROTATES the refresh token on every refresh — the new pair must
 *      be persisted immediately, every time, or the connection dies.
 *   2. "Connected" means the ~100-day refresh token is alive, not the ~1-hour
 *      access token (v1 conflated the two and disconnected hourly).
 */

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const QBO_CONNECTION_KEY = "qbo-connection";

/** Refresh proactively when the access token has less than this left. */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface QboConnection {
  readonly realmId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  /** Absent on v1-era stored records — treat as alive; the first refresh decides. */
  readonly refreshTokenExpiresAt?: number;
}

export class ReconnectRequired extends Error {
  constructor() {
    super("QuickBooks session expired — reconnect.");
    this.name = "ReconnectRequired";
  }
}

export function loadConnection(store: KV, now: number): QboConnection | null {
  try {
    const raw = store.getItem(QBO_CONNECTION_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as QboConnection;
    if (!c.realmId || !c.accessToken || !c.refreshToken) return null;
    if (typeof c.refreshTokenExpiresAt === "number" && c.refreshTokenExpiresAt <= now) return null;
    return c;
  } catch {
    return null;
  }
}

export function persistConnection(store: KV, c: QboConnection): void {
  try {
    store.setItem(QBO_CONNECTION_KEY, JSON.stringify(c));
  } catch {
    // storage full/private mode — session-only connection still works
  }
}

export function clearConnection(store: KV): void {
  try {
    store.removeItem(QBO_CONNECTION_KEY);
  } catch {
    // best effort
  }
}

async function refreshTokens(c: QboConnection): Promise<QboConnection> {
  const res = await fetch("/api/qbo/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: c.refreshToken }),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    refreshTokenExpiresAt?: number;
  } | null;
  if (!res.ok || !body?.ok || !body.accessToken || !body.refreshToken) {
    throw new ReconnectRequired();
  }
  return {
    realmId: c.realmId,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    expiresAt: body.expiresAt ?? 0,
    refreshTokenExpiresAt: body.refreshTokenExpiresAt,
  };
}

/** Returns a connection with a fresh-enough access token, persisting any rotation. */
export async function ensureFresh(store: KV, c: QboConnection, now: number): Promise<QboConnection> {
  if (c.expiresAt - now >= REFRESH_SKEW_MS) return c;
  const next = await refreshTokens(c); // throws ReconnectRequired on failure
  persistConnection(store, next);
  return next;
}

export interface PushLinePayload {
  readonly description: string;
  readonly quantity: number;
  readonly rate: number;
  readonly amount: number;
}
export interface PushRequest {
  readonly partner: string;
  readonly docNumber: string;
  readonly lines: readonly PushLinePayload[];
}

export type PushOutcome =
  | { kind: "created"; qboInvoiceId: string }
  | { kind: "already"; qboInvoiceId: string; qboDocNumber?: string; duplicateCount: number }
  | { kind: "totals-differ"; qboInvoiceId: string; qboTotalCents: number; expectedTotalCents: number }
  | { kind: "failed"; detail: string };

interface PushResponseBody {
  ok?: boolean;
  deduped?: boolean;
  qboInvoiceId?: string;
  qboDocNumber?: string;
  qboTotalCents?: number;
  expectedTotalCents?: number;
  totalsMatch?: boolean;
  duplicateCount?: number;
  docNumber?: string;
  error?: string;
}

async function postPush(
  c: QboConnection,
  invoice: PushRequest
): Promise<{ status: number; ok: boolean; body: PushResponseBody | null }> {
  const res = await fetch("/api/qbo/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ realmId: c.realmId, accessToken: c.accessToken, invoice }),
  });
  const body = (await res.json().catch(() => null)) as PushResponseBody | null;
  return { status: res.status, ok: res.ok, body };
}

/**
 * Push one invoice. Proactively refreshes near expiry; on a 401 refreshes once
 * and retries once. Returns the outcome plus the (possibly rotated) connection.
 * Throws ReconnectRequired when the session is truly dead.
 */
export async function pushInvoice(
  store: KV,
  conn: QboConnection,
  invoice: PushRequest,
  now: number
): Promise<{ outcome: PushOutcome; conn: QboConnection }> {
  let c = await ensureFresh(store, conn, now);
  let r = await postPush(c, invoice);
  if (r.status === 401) {
    c = await refreshTokens(c); // throws ReconnectRequired when the refresh is dead
    persistConnection(store, c);
    r = await postPush(c, invoice);
    if (r.status === 401) throw new ReconnectRequired();
  }
  const b = r.body;
  if (!r.ok || !b?.ok) {
    return { outcome: { kind: "failed", detail: b?.error ?? `HTTP ${r.status}` }, conn: c };
  }
  if (b.deduped) {
    if (b.totalsMatch === false) {
      return {
        outcome: {
          kind: "totals-differ",
          qboInvoiceId: b.qboInvoiceId ?? "?",
          qboTotalCents: b.qboTotalCents ?? 0,
          expectedTotalCents: b.expectedTotalCents ?? 0,
        },
        conn: c,
      };
    }
    return {
      outcome: {
        kind: "already",
        qboInvoiceId: b.qboInvoiceId ?? "?",
        qboDocNumber: b.qboDocNumber,
        duplicateCount: b.duplicateCount ?? 1,
      },
      conn: c,
    };
  }
  return { outcome: { kind: "created", qboInvoiceId: b.qboInvoiceId ?? "?" }, conn: c };
}

// ---------------------------------------------------------------------------
// Pushed-state — best-effort client memory of what already landed in QBO.
// Keyed period + file fingerprints (same discipline as reviewStorageKey in
// loadFiles.ts) so a changed pricing file naturally invalidates it; the
// server-side dedup query remains the authoritative backstop.

export interface PushedRecord {
  readonly qboInvoiceId: string;
  readonly docNumber: string;
  readonly totalCents: number;
  readonly at: number;
}
export type PushedState = Readonly<Record<string, PushedRecord>>;

export function qboPushedStorageKey(period: string, pricingFp: string, usageFp: string): string {
  return `qbo-pushed:${period}:${pricingFp.slice(0, 12)}:${usageFp.slice(0, 12)}`;
}

export function loadPushed(store: KV, key: string): PushedState {
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as PushedState) : {};
  } catch {
    return {};
  }
}

export function recordPushed(store: KV, key: string, slug: string, rec: PushedRecord): PushedState {
  const next: Record<string, PushedRecord> = { ...loadPushed(store, key), [slug]: rec };
  try {
    store.setItem(key, JSON.stringify(next));
  } catch {
    // best effort — server dedup still protects us
  }
  return next;
}
