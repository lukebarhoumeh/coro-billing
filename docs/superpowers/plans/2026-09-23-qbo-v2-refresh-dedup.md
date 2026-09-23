# QuickBooks v2 (Token Auto-Refresh + Push Dedup + OAuth Hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connections survive past the 1-hour access token (auto-refresh with Intuit's rotating refresh tokens), re-pushes never duplicate QBO invoices (skip + flag totals differences), and the OAuth flow actually verifies `state` and posts tokens only to our origin.

**Architecture:** Approach A from the approved spec (`docs/superpowers/specs/2026-09-23-qbo-v2-design.md`): a new stateless `api/qbo/refresh.ts` endpoint plus a DOM-free client helper `web/src/lib/qbo.ts` that owns the token lifecycle and pushed-state; `api/qbo/push.ts` gains an authoritative dedup query (customer + `HUB-<period>-%` DocNumber prefix) before any write. Nothing is ever stored server-side.

**Tech Stack:** TypeScript ESM, Vercel serverless functions (plain default-export handlers with local `Req`/`Res` interfaces), Vite/React web workbench, vitest (node environment, `tests/**/*.test.ts`, no globals — import `describe/it/expect/vi` explicitly).

**Ground rules for this round (from the spec header):**
- **LOCAL ONLY.** No `git push`, no `vercel` deploy — Lita is mid-test on prod. Commits land on local `main`.
- Handlers are imported in tests by relative ESM path with `.js` extension (established pattern: `tests/web/loadFiles.test.ts` imports `"../../web/src/lib/loadFiles.js"`).
- Gates: `pnpm test` (286 existing tests must stay green), `pnpm --dir web typecheck` (currently clean — keep it clean), `pnpm --dir web build`. Root `pnpm typecheck` has a PRE-EXISTING unrelated failure (`web/src/lib/loadFiles.ts` BufferSource) — do not try to fix it, do not use it as a gate.

---

### Task 1: Shared API-test helper + `api/qbo/refresh.ts`

**Files:**
- Create: `tests/api/helpers.ts`
- Create: `tests/api/qbo.refresh.test.ts`
- Create: `api/qbo/refresh.ts`

- [ ] **Step 1.1: Write the shared fake-response helper**

Create `tests/api/helpers.ts`:

```ts
/**
 * Structural fakes for the api/qbo handlers' local Req/Res interfaces.
 * The handlers only ever call status/json/setHeader/send/redirect, so a
 * capturing object satisfies all of them.
 */
export interface Captured {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  sent: string | null;
  redirect: { code: number; url: string } | null;
}

export interface FakeRes {
  status(code: number): FakeRes;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  send(body: string): void;
  redirect(code: number, url: string): void;
}

export function capture(): { res: FakeRes; cap: Captured } {
  const cap: Captured = { status: 0, body: null, headers: {}, sent: null, redirect: null };
  const res: FakeRes = {
    status(code: number) {
      cap.status = code;
      return res;
    },
    json(body: unknown) {
      cap.body = body;
    },
    setHeader(name: string, value: string) {
      cap.headers[name.toLowerCase()] = value;
    },
    send(body: string) {
      cap.sent = body;
    },
    redirect(code: number, url: string) {
      cap.redirect = { code, url };
    },
  };
  return { res, cap };
}

/** Fetch-shaped response the handlers consume via ok/status/json()/text(). */
export function jsonResponse(status: number, body: unknown): {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
```

- [ ] **Step 1.2: Write the failing refresh tests**

Create `tests/api/qbo.refresh.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/qbo/refresh.js";
import { capture, jsonResponse } from "./helpers.js";

const NOW = new Date("2026-09-23T12:00:00Z").getTime();

describe("POST /api/qbo/refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    process.env["QBO_CLIENT_ID"] = "cid";
    process.env["QBO_CLIENT_SECRET"] = "csecret";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env["QBO_CLIENT_ID"];
    delete process.env["QBO_CLIENT_SECRET"];
  });

  it("rotates the pair and returns both expiries", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        access_token: "newA",
        refresh_token: "newR",
        expires_in: 3600,
        x_refresh_token_expires_in: 8_640_000,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { res, cap } = capture();
    await handler({ method: "POST", body: { refreshToken: "oldR" } }, res);
    expect(cap.status).toBe(200);
    expect(cap.body).toEqual({
      ok: true,
      accessToken: "newA",
      refreshToken: "newR",
      expiresAt: NOW + 3600 * 1000,
      refreshTokenExpiresAt: NOW + 8_640_000 * 1000,
    });
    const [url, init] = fetchMock.mock.calls[0]! as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
    expect(init.body).toContain("grant_type=refresh_token");
    expect(init.body).toContain("refresh_token=oldR");
    expect(init.headers["Authorization"]).toBe("Basic " + Buffer.from("cid:csecret").toString("base64"));
  });

  it("maps Intuit 4xx (expired/revoked) to 401 reconnect", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, { error: "invalid_grant" })));
    const { res, cap } = capture();
    await handler({ method: "POST", body: { refreshToken: "deadR" } }, res);
    expect(cap.status).toBe(401);
    expect(cap.body).toEqual({ error: "QuickBooks session expired — reconnect." });
  });

  it("maps other Intuit failures to 502 with detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, { fault: "boom" })));
    const { res, cap } = capture();
    await handler({ method: "POST", body: { refreshToken: "r" } }, res);
    expect(cap.status).toBe(502);
    expect((cap.body as { error: string }).error).toBe("Intuit token refresh failed");
  });

  it("503s when the app credentials are missing", async () => {
    delete process.env["QBO_CLIENT_SECRET"];
    const { res, cap } = capture();
    await handler({ method: "POST", body: { refreshToken: "r" } }, res);
    expect(cap.status).toBe(503);
  });

  it("400s without a refreshToken and 405s non-POST", async () => {
    const a = capture();
    await handler({ method: "POST", body: {} }, a.res);
    expect(a.cap.status).toBe(400);
    const b = capture();
    await handler({ method: "GET", body: {} }, b.res);
    expect(b.cap.status).toBe(405);
  });
});
```

- [ ] **Step 1.3: Run tests to verify they fail**

Run: `pnpm test -- tests/api/qbo.refresh.test.ts`
Expected: FAIL — cannot resolve `../../api/qbo/refresh.js` (module does not exist).

- [ ] **Step 1.4: Implement `api/qbo/refresh.ts`**

```ts
/**
 * POST /api/qbo/refresh — exchange the rotating Intuit refresh token.
 *
 * Stateless: the browser holds the tokens; this function holds only the app
 * credentials. Intuit ROTATES the refresh token on every exchange — the client
 * must persist the returned pair immediately or the connection dies.
 *
 * Body: { refreshToken }
 * 200: { ok, accessToken, refreshToken, expiresAt, refreshTokenExpiresAt }
 * 401: refresh token expired/revoked — reconnect.
 * Env: QBO_CLIENT_ID, QBO_CLIENT_SECRET.
 */
interface Req {
  method?: string;
  body: unknown;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
}

interface RefreshBody {
  refreshToken?: string;
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const clientId = process.env["QBO_CLIENT_ID"];
  const clientSecret = process.env["QBO_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: "QuickBooks is not configured (missing env)." });
    return;
  }
  const { refreshToken } = (req.body ?? {}) as RefreshBody;
  if (!refreshToken) {
    res.status(400).json({ error: "Missing refreshToken" });
    return;
  }

  const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (tokenRes.status >= 400 && tokenRes.status < 500) {
    // invalid_grant et al: the refresh token is expired or revoked.
    res.status(401).json({ error: "QuickBooks session expired — reconnect." });
    return;
  }
  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    res.status(502).json({ error: "Intuit token refresh failed", detail: detail.slice(0, 500) });
    return;
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
  };
  res.status(200).json({
    ok: true,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    refreshTokenExpiresAt: Date.now() + tokens.x_refresh_token_expires_in * 1000,
  });
}
```

- [ ] **Step 1.5: Run tests to verify they pass**

Run: `pnpm test -- tests/api/qbo.refresh.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 1.6: Commit**

```bash
git add tests/api/helpers.ts tests/api/qbo.refresh.test.ts api/qbo/refresh.ts
git commit -m "feat(qbo): token refresh endpoint — rotating pair, both expiries"
```

---

### Task 2: OAuth hardening — `connect.ts` state cookie, `callback.ts` verification + origin + refresh expiry

**Files:**
- Create: `tests/api/qbo.oauth.test.ts`
- Modify: `api/qbo/connect.ts`
- Modify: `api/qbo/callback.ts`

- [ ] **Step 2.1: Write the failing OAuth tests**

Create `tests/api/qbo.oauth.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import connect from "../../api/qbo/connect.js";
import callback from "../../api/qbo/callback.js";
import { capture, jsonResponse } from "./helpers.js";

const REDIRECT = "https://coro-billing.vercel.app/api/qbo/callback";

describe("GET /api/qbo/connect", () => {
  beforeEach(() => {
    process.env["QBO_CLIENT_ID"] = "cid";
    process.env["QBO_REDIRECT_URI"] = REDIRECT;
  });
  afterEach(() => {
    delete process.env["QBO_CLIENT_ID"];
    delete process.env["QBO_REDIRECT_URI"];
  });

  it("sets the state cookie and embeds the SAME state in the redirect", () => {
    const { res, cap } = capture();
    connect({ query: {} }, res);
    expect(cap.redirect?.code).toBe(302);
    const m = /[?&]state=([^&]+)/.exec(cap.redirect?.url ?? "");
    expect(m).not.toBeNull();
    const cookie = cap.headers["set-cookie"];
    expect(cookie).toContain(`qbo_oauth_state=${m![1]}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api/qbo");
  });
});

describe("GET /api/qbo/callback", () => {
  beforeEach(() => {
    process.env["QBO_CLIENT_ID"] = "cid";
    process.env["QBO_CLIENT_SECRET"] = "csecret";
    process.env["QBO_REDIRECT_URI"] = REDIRECT;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["QBO_CLIENT_ID"];
    delete process.env["QBO_CLIENT_SECRET"];
    delete process.env["QBO_REDIRECT_URI"];
  });

  it("400s when the state cookie is absent or mismatched", async () => {
    const a = capture();
    await callback({ query: { code: "c", realmId: "r", state: "s1" }, headers: {} }, a.res);
    expect(a.cap.status).toBe(400);
    const b = capture();
    await callback(
      { query: { code: "c", realmId: "r", state: "s1" }, headers: { cookie: "qbo_oauth_state=OTHER" } },
      b.res
    );
    expect(b.cap.status).toBe(400);
  });

  it("posts tokens (with refreshTokenExpiresAt) only to our origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          access_token: "a",
          refresh_token: "r",
          expires_in: 3600,
          x_refresh_token_expires_in: 8_640_000,
        })
      )
    );
    const { res, cap } = capture();
    await callback(
      {
        query: { code: "c", realmId: "realm9", state: "s1" },
        headers: { cookie: "other=1; qbo_oauth_state=s1" },
      },
      res
    );
    expect(cap.sent).not.toBeNull();
    expect(cap.sent).toContain('"refreshTokenExpiresAt"');
    expect(cap.sent).toContain('postMessage(');
    expect(cap.sent).toContain('"https://coro-billing.vercel.app"');
    expect(cap.sent).not.toContain('"*"');
    // The one-shot state cookie is cleared after use.
    expect(cap.headers["set-cookie"]).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `pnpm test -- tests/api/qbo.oauth.test.ts`
Expected: FAIL — connect sets no cookie; callback accepts the missing cookie (status 502 or sends HTML) and its `Req` type has no `headers` (TS may also complain — that's part of the failure).

- [ ] **Step 2.3: Modify `api/qbo/connect.ts`**

Replace the whole file with:

```ts
/**
 * GET /api/qbo/connect — kick off the Intuit OAuth2 flow.
 *
 * Redirects the accountant's browser to Intuit's authorization page. Needs
 * Vercel env vars (Settings → Environment Variables):
 *   QBO_CLIENT_ID      — from the Intuit developer app (docs/QUICKBOOKS_SETUP.md)
 *   QBO_REDIRECT_URI   — https://<deployment>/api/qbo/callback (must match the app)
 *
 * Stateless by design: no tokens are ever stored server-side. The callback
 * hands tokens to the opener window, which keeps them in localStorage.
 */
interface Req {
  query: Record<string, string | string[] | undefined>;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  redirect(code: number, url: string): void;
}

export default function handler(req: Req, res: Res): void {
  const clientId = process.env["QBO_CLIENT_ID"];
  const redirectUri = process.env["QBO_REDIRECT_URI"];
  if (!clientId || !redirectUri) {
    res.status(503).json({
      error: "QuickBooks is not configured on this deployment.",
      hint: "Set QBO_CLIENT_ID and QBO_REDIRECT_URI in Vercel env (see docs/QUICKBOOKS_SETUP.md).",
    });
    return;
  }
  // CSRF token: stored in an HttpOnly cookie here, checked against the state
  // query param by the callback. 10 minutes is plenty to finish the popup.
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  res.setHeader(
    "Set-Cookie",
    `qbo_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/qbo; Max-Age=600`
  );
  const url =
    "https://appcenter.intuit.com/connect/oauth2" +
    `?client_id=${encodeURIComponent(clientId)}` +
    "&response_type=code" +
    `&scope=${encodeURIComponent("com.intuit.quickbooks.accounting")}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;
  res.redirect(302, url);
}
```

- [ ] **Step 2.4: Modify `api/qbo/callback.ts`**

Replace the whole file with:

```ts
/**
 * GET /api/qbo/callback — Intuit OAuth2 redirect target.
 *
 * Verifies the CSRF state against the cookie set by /api/qbo/connect, then
 * exchanges the authorization code for tokens (server-side, using the client
 * secret) and hands them to the opener window via postMessage — scoped to OUR
 * origin only. The workbench stores them in localStorage. Nothing is persisted
 * server-side.
 *
 * Env: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI.
 */
interface Req {
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function cookieValue(header: string | string[] | undefined, name: string): string | undefined {
  const raw = Array.isArray(header) ? header.join("; ") : header;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export default async function handler(req: Req, res: Res): Promise<void> {
  const clientId = process.env["QBO_CLIENT_ID"];
  const clientSecret = process.env["QBO_CLIENT_SECRET"];
  const redirectUri = process.env["QBO_REDIRECT_URI"];
  const code = first(req.query["code"]);
  const realmId = first(req.query["realmId"]);
  const state = first(req.query["state"]);
  const cookieState = cookieValue(req.headers["cookie"], "qbo_oauth_state");

  if (!clientId || !clientSecret || !redirectUri) {
    res.status(503).json({ error: "QuickBooks is not configured (missing env)." });
    return;
  }
  if (!code || !realmId) {
    res.status(400).json({ error: "Missing code/realmId from Intuit." });
    return;
  }
  if (!state || !cookieState || state !== cookieState) {
    res.status(400).json({ error: "OAuth state mismatch — close this window and retry Connect." });
    return;
  }

  const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    res.status(502).json({ error: "Intuit token exchange failed", detail: detail.slice(0, 500) });
    return;
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
  };

  // Hand off to the opener — OUR origin only — and close. The payload never
  // touches our servers again. The one-shot state cookie is cleared.
  const origin = new URL(redirectUri).origin;
  const payload = JSON.stringify({
    type: "qbo-connected",
    realmId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    refreshTokenExpiresAt: Date.now() + tokens.x_refresh_token_expires_in * 1000,
  });
  res.setHeader(
    "Set-Cookie",
    "qbo_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/qbo; Max-Age=0"
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><body style="font-family:system-ui;background:#0d1220;color:#eee;display:grid;place-items:center;height:100vh">
<div>QuickBooks connected — you can close this window.</div>
<script>
  if (window.opener) {
    window.opener.postMessage(${payload}, ${JSON.stringify(origin)});
    setTimeout(function(){ window.close(); }, 800);
  }
</script></body></html>`);
}
```

- [ ] **Step 2.5: Run tests to verify they pass**

Run: `pnpm test -- tests/api/qbo.oauth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 2.6: Commit**

```bash
git add tests/api/qbo.oauth.test.ts api/qbo/connect.ts api/qbo/callback.ts
git commit -m "fix(qbo): verify OAuth state, scope postMessage to our origin, carry refresh-token expiry"
```

---

### Task 3: Push dedup in `api/qbo/push.ts`

**Files:**
- Create: `tests/api/qbo.push.test.ts`
- Modify: `api/qbo/push.ts`

- [ ] **Step 3.1: Write the failing push tests**

Create `tests/api/qbo.push.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/qbo/push.js";
import { capture, jsonResponse } from "./helpers.js";

function body(overrides?: { lines?: { description: string; quantity: number; rate: number; amount: number }[] }) {
  return {
    realmId: "realm9",
    accessToken: "tok",
    invoice: {
      partner: "Rocker Cybersecurity",
      docNumber: "HUB-202608-004",
      lines: overrides?.lines ?? [
        { description: "Coro Complete", quantity: 2, rate: 10, amount: 20 },
        { description: "SAT Flex", quantity: 1, rate: 3.45, amount: 3.45 },
      ],
    },
  };
}

const CUSTOMER_HIT = { QueryResponse: { Customer: [{ Id: "9" }] } };
const NO_INVOICES = { QueryResponse: {} };

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/qbo/push — dedup", () => {
  it("skips creation when the partner+period already has an invoice (totals equal)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, CUSTOMER_HIT))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          QueryResponse: { Invoice: [{ Id: "77", DocNumber: "HUB-202608-004", TotalAmt: 23.45 }] },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const { res, cap } = capture();
    await handler({ method: "POST", body: body() }, res);
    expect(cap.status).toBe(200);
    expect(cap.body).toEqual({
      ok: true,
      deduped: true,
      qboInvoiceId: "77",
      qboDocNumber: "HUB-202608-004",
      qboTotalCents: 2345,
      expectedTotalCents: 2345,
      totalsMatch: true,
      duplicateCount: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // customer query + invoice query, NO create
    // Prefix + customer, not exact DocNumber (sequence can shift between pushes).
    // NB: encodeURIComponent leaves apostrophes as-is and turns % into %25.
    const invoiceQueryUrl = String(fetchMock.mock.calls[1]![0]);
    expect(invoiceQueryUrl).toContain("'HUB-202608-%25'");
    expect(invoiceQueryUrl).toContain("CustomerRef%20%3D%20'9'");
  });

  it("flags totals-differ without touching the existing invoice", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, CUSTOMER_HIT))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          QueryResponse: {
            Invoice: [
              { Id: "77", DocNumber: "HUB-202608-004", TotalAmt: 21.0 },
              { Id: "78", DocNumber: "HUB-202608-011", TotalAmt: 5.0 },
            ],
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const { res, cap } = capture();
    await handler({ method: "POST", body: body() }, res);
    const b = cap.body as { totalsMatch: boolean; qboTotalCents: number; expectedTotalCents: number; duplicateCount: number };
    expect(b.totalsMatch).toBe(false);
    expect(b.qboTotalCents).toBe(2100);
    expect(b.expectedTotalCents).toBe(2345);
    expect(b.duplicateCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("creates as v1 when no invoice exists yet", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, CUSTOMER_HIT))
      .mockResolvedValueOnce(jsonResponse(200, NO_INVOICES))
      .mockResolvedValueOnce(jsonResponse(200, { Invoice: { Id: "501", DocNumber: "HUB-202608-004" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, cap } = capture();
    await handler({ method: "POST", body: body() }, res);
    expect(cap.status).toBe(200);
    expect(cap.body).toEqual({ ok: true, deduped: false, qboInvoiceId: "501", docNumber: "HUB-202608-004" });
    const createCall = fetchMock.mock.calls[2]! as [string, { method: string }];
    expect(createCall[0]).toContain("/invoice");
    expect(createCall[1].method).toBe("POST");
  });

  it("still finds-or-creates the customer (regression)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: {} })) // no customer
      .mockResolvedValueOnce(jsonResponse(200, { Customer: { Id: "31" } })) // create customer
      .mockResolvedValueOnce(jsonResponse(200, NO_INVOICES)) // dedup query
      .mockResolvedValueOnce(jsonResponse(200, { Invoice: { Id: "600", DocNumber: "HUB-202608-004" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, cap } = capture();
    await handler({ method: "POST", body: body() }, res);
    expect((cap.body as { qboInvoiceId: string }).qboInvoiceId).toBe("600");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("401s uniformly when the dedup query hits an expired token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, CUSTOMER_HIT))
      .mockResolvedValueOnce(jsonResponse(401, { fault: "expired" }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, cap } = capture();
    await handler({ method: "POST", body: body() }, res);
    expect(cap.status).toBe(401);
    expect((cap.body as { error: string }).error).toBe("QuickBooks session expired — reconnect.");
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `pnpm test -- tests/api/qbo.push.test.ts`
Expected: FAIL — v1 creates on the second fetch call (no dedup query), so call counts/response shapes mismatch.

- [ ] **Step 3.3: Add the dedup block to `api/qbo/push.ts`**

In `api/qbo/push.ts`, replace the section from the comment `// 2) Create the invoice.` down through the final `res.status(200).json(...)` (currently lines 113–136) with:

```ts
  // 2) Dedup — never write when this partner+period already has an invoice.
  // Prefix + customer rather than exact DocNumber: the sequence part is the
  // partner's index in the model, which can shift when the pricing file
  // changes; an exact match would miss the earlier push and duplicate.
  const docNumber = invoice.docNumber ?? "";
  const prefix = docNumber.slice(0, docNumber.lastIndexOf("-") + 1);
  if (prefix.length > 0) {
    const existing = await qbo(
      realmId,
      accessToken,
      `/query?query=${encodeURIComponent(
        `select Id, DocNumber, TotalAmt from Invoice where CustomerRef = '${customerId}' and DocNumber like '${prefix}%'`
      )}`
    );
    if (!existing.ok) {
      res.status(existing.status === 401 ? 401 : 502).json({
        error:
          existing.status === 401
            ? "QuickBooks session expired — reconnect."
            : "QBO invoice query failed",
        detail: existing.json,
      });
      return;
    }
    const found =
      (existing.json as { QueryResponse?: { Invoice?: { Id: string; DocNumber?: string; TotalAmt?: number }[] } })
        ?.QueryResponse?.Invoice ?? [];
    if (found.length > 0) {
      // Skip + flag (decision 2026-09-23): report, compare totals in integer
      // cents, and let the accountant resolve any difference in QBO itself.
      const hit = found[0]!;
      const expectedTotalCents = Math.round(invoice.lines.reduce((s, l) => s + l.amount, 0) * 100);
      const qboTotalCents = Math.round((hit.TotalAmt ?? 0) * 100);
      res.status(200).json({
        ok: true,
        deduped: true,
        qboInvoiceId: hit.Id,
        qboDocNumber: hit.DocNumber,
        qboTotalCents,
        expectedTotalCents,
        totalsMatch: qboTotalCents === expectedTotalCents,
        duplicateCount: found.length,
      });
      return;
    }
  }

  // 3) Create the invoice.
  const inv = await qbo(realmId, accessToken, "/invoice", {
    method: "POST",
    body: {
      CustomerRef: { value: customerId },
      DocNumber: invoice.docNumber,
      Line: invoice.lines.map((l) => ({
        DetailType: "SalesItemLineDetail",
        Amount: l.amount,
        Description: l.description,
        SalesItemLineDetail: {
          ItemRef: { value: itemId },
          Qty: l.quantity,
          UnitPrice: l.rate,
        },
      })),
    },
  });
  if (!inv.ok) {
    res.status(502).json({ error: "QBO invoice create failed", detail: inv.json });
    return;
  }
  const createdInv = (inv.json as { Invoice?: { Id: string; DocNumber?: string } })?.Invoice;
  res
    .status(200)
    .json({ ok: true, deduped: false, qboInvoiceId: createdInv?.Id, docNumber: createdInv?.DocNumber });
```

Also update the file's header comment: in the doc block at the top, after the `Body:` section, add a line:

```
 * Dedup: if the customer already has an invoice whose DocNumber starts with
 * the same HUB-<period>- prefix, nothing is written; the response reports the
 * existing invoice and whether totals match (integer-cents comparison).
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `pnpm test -- tests/api/qbo.push.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3.5: Commit**

```bash
git add tests/api/qbo.push.test.ts api/qbo/push.ts
git commit -m "feat(qbo): push dedup — skip + flag existing invoices, never rewrite a ledger"
```

---

### Task 4: Client helper `web/src/lib/qbo.ts`

**Files:**
- Create: `web/src/lib/qbo.ts`
- Create: `tests/web/qboClient.test.ts`

- [ ] **Step 4.1: Write the failing client tests**

Create `tests/web/qboClient.test.ts`:

```ts
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
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `pnpm test -- tests/web/qboClient.test.ts`
Expected: FAIL — cannot resolve `../../web/src/lib/qbo.js`.

- [ ] **Step 4.3: Implement `web/src/lib/qbo.ts`**

```ts
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
    if (c.refreshTokenExpiresAt !== undefined && c.refreshTokenExpiresAt <= now) return null;
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
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `pnpm test -- tests/web/qboClient.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 4.5: Commit**

```bash
git add web/src/lib/qbo.ts tests/web/qboClient.test.ts
git commit -m "feat(web): QBO client helper — auto-refresh with rotation, pushed-state store"
```

---

### Task 5: Rewire `QuickBooksCard.tsx`

**Files:**
- Modify: `web/src/components/QuickBooksCard.tsx` (full replacement below)

No new unit tests — the card's logic now lives in the tested helper; the card is JSX wiring (the repo has no React component tests, and the Playwright walkthrough covers the screen). Verification is typecheck + build + the full suite.

- [ ] **Step 5.1: Replace `web/src/components/QuickBooksCard.tsx`**

```tsx
/**
 * QuickBooks Online integration — connect + push approved invoices.
 *
 * v2: the connection auto-renews (web/src/lib/qbo.ts owns the token lifecycle;
 * Intuit rotates refresh tokens, the helper persists every rotation) and push
 * is dedup-aware — the server skips invoices that already exist in QBO and
 * flags totals differences instead of ever rewriting a ledger. Known-pushed
 * invoices (per period + file fingerprints) are skipped client-side.
 *
 * When the deployment has no QBO env configured, /api/qbo/connect answers 503
 * and this card explains what's missing instead of pretending.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleX, Link2, Loader2, Send, TriangleAlert } from "lucide-react";
import { useClose } from "@/lib/closeStore";
import {
  ReconnectRequired,
  clearConnection,
  loadConnection,
  loadPushed,
  persistConnection,
  pushInvoice,
  qboPushedStorageKey,
  recordPushed,
  type PushedState,
  type QboConnection,
} from "@/lib/qbo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const usd = (cents: number): string =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

type PushState = "idle" | "pushing" | "done";
type Tone = "ok" | "muted" | "warn" | "fail";
interface PushResult {
  readonly partner: string;
  readonly tone: Tone;
  readonly detail: string;
}

export function QuickBooksCard() {
  const { model, review, period, demo, files } = useClose();
  const [connection, setConnection] = useState<QboConnection | null>(() =>
    loadConnection(localStorage, Date.now())
  );
  const [connectError, setConnectError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState>("idle");
  const [results, setResults] = useState<readonly PushResult[]>([]);

  // Pushed-state is keyed like review state: period + file fingerprints, so a
  // changed pricing file naturally resets it and the server dedup takes over.
  const pushedKey = useMemo(
    () =>
      files.pricing && files.usage
        ? qboPushedStorageKey(period, files.pricing.fingerprint, files.usage.fingerprint)
        : null,
    [files.pricing, files.usage, period]
  );
  const [pushed, setPushed] = useState<PushedState>({});
  useEffect(() => {
    setPushed(pushedKey ? loadPushed(localStorage, pushedKey) : {});
    setResults([]);
    setPushState("idle");
  }, [pushedKey]);

  // Receive tokens from the OAuth popup.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string } & QboConnection;
      if (d?.type === "qbo-connected" && d.realmId && d.accessToken) {
        const c: QboConnection = {
          realmId: d.realmId,
          accessToken: d.accessToken,
          refreshToken: d.refreshToken,
          expiresAt: d.expiresAt,
          refreshTokenExpiresAt: d.refreshTokenExpiresAt,
        };
        persistConnection(localStorage, c);
        setConnection(c);
        setConnectError(null);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const connect = useCallback(async () => {
    // Probe config first so a missing env explains itself instead of a dead popup.
    const probe = await fetch("/api/qbo/connect", { redirect: "manual" });
    if (probe.status === 503) {
      const body = (await probe.json().catch(() => null)) as { hint?: string } | null;
      setConnectError(body?.hint ?? "QuickBooks is not configured on this deployment.");
      return;
    }
    window.open("/api/qbo/connect", "qbo-oauth", "width=600,height=760");
  }, []);

  const disconnect = useCallback(() => {
    clearConnection(localStorage);
    setConnection(null);
    setResults([]);
    setPushState("idle");
  }, []);

  const approved = useMemo(
    () => (model?.partners ?? []).filter((p) => review[p.slug]?.status === "approved"),
    [model, review]
  );
  const toPush = useMemo(() => approved.filter((p) => !pushed[p.slug]), [approved, pushed]);
  const alreadyCount = approved.length - toPush.length;

  const pushApproved = useCallback(async () => {
    if (connection === null || model === null || toPush.length === 0) return;
    setPushState("pushing");
    const out: PushResult[] = [];
    let conn = connection;
    let pushedNow = pushed;
    for (const p of toPush) {
      const index = model.partners.findIndex((x) => x.slug === p.slug);
      const docNumber = `HUB-${period.replace("-", "")}-${String(index + 1).padStart(3, "0")}`;
      const lines = p.lines
        .filter((l) => l.unitL !== null && l.amountL !== null && l.quantity > 0)
        .map((l) => ({
          description: `${l.productLabel} (${l.vendorSku}) — ${period}`,
          quantity: l.quantity,
          rate: l.unitL!.toNumber(),
          amount: l.amountL!.toNumber(),
        }));
      if (lines.length === 0) {
        out.push({ partner: p.cardName, tone: "fail", detail: "no billable lines" });
        setResults([...out]);
        continue;
      }
      const totalCents = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100);
      try {
        const r = await pushInvoice(
          localStorage,
          conn,
          { partner: p.cardName, docNumber, lines },
          Date.now()
        );
        conn = r.conn;
        setConnection(conn);
        const o = r.outcome;
        if (o.kind === "created") {
          out.push({ partner: p.cardName, tone: "ok", detail: `QBO invoice ${o.qboInvoiceId}` });
          if (pushedKey) {
            pushedNow = recordPushed(localStorage, pushedKey, p.slug, {
              qboInvoiceId: o.qboInvoiceId,
              docNumber,
              totalCents,
              at: Date.now(),
            });
            setPushed(pushedNow);
          }
        } else if (o.kind === "already") {
          out.push({
            partner: p.cardName,
            tone: "muted",
            detail:
              o.duplicateCount > 1
                ? `already in QBO — ${o.duplicateCount} invoices carry this period (first: ${o.qboInvoiceId})`
                : `already in QBO — invoice ${o.qboInvoiceId}`,
          });
          if (pushedKey) {
            pushedNow = recordPushed(localStorage, pushedKey, p.slug, {
              qboInvoiceId: o.qboInvoiceId,
              docNumber: o.qboDocNumber ?? docNumber,
              totalCents,
              at: Date.now(),
            });
            setPushed(pushedNow);
          }
        } else if (o.kind === "totals-differ") {
          // NOT recorded as pushed — keeps flagging until resolved in QBO.
          out.push({
            partner: p.cardName,
            tone: "warn",
            detail: `already in QBO (invoice ${o.qboInvoiceId}) — ours ${usd(o.expectedTotalCents)} vs QBO ${usd(o.qboTotalCents)}, resolve in QuickBooks`,
          });
        } else {
          out.push({ partner: p.cardName, tone: "fail", detail: o.detail });
        }
      } catch (e) {
        if (e instanceof ReconnectRequired) {
          out.push({ partner: p.cardName, tone: "fail", detail: "session expired — reconnect" });
          clearConnection(localStorage);
          setConnection(null);
          break;
        }
        out.push({ partner: p.cardName, tone: "fail", detail: String(e) });
      }
      setResults([...out]);
    }
    setResults(out);
    setPushState("done");
  }, [connection, model, toPush, period, pushed, pushedKey]);

  if (model === null) return null;

  const icon = (tone: Tone) =>
    tone === "ok" ? (
      <CircleCheck className="h-3.5 w-3.5 shrink-0 text-success" />
    ) : tone === "muted" ? (
      <CircleCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    ) : tone === "warn" ? (
      <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" />
    ) : (
      <CircleX className="h-3.5 w-3.5 shrink-0 text-danger" />
    );

  const createdCount = results.filter((r) => r.tone === "ok").length;
  const flaggedCount = results.filter((r) => r.tone === "warn").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 normal-case tracking-normal text-foreground">
          <span className="text-sm font-medium">QuickBooks Online</span>
          {connection !== null ? (
            <Badge variant="success">connected · auto-renews</Badge>
          ) : (
            <Badge variant="muted">not connected</Badge>
          )}
          {demo && <Badge variant="warning">demo data — don't push</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Pushes each <b>approved</b> draft as a QuickBooks invoice (customer created by partner
          name if missing). Invoices already in QBO are skipped — never rewritten; totals
          differences are flagged for manual resolution. File exports (CSV/IIF) remain available
          above.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {connection === null ? (
            <Button variant="outline" data-testid="qbo-connect" onClick={() => void connect()}>
              <Link2 className="h-4 w-4" />
              Connect QuickBooks
            </Button>
          ) : (
            <>
              <Button
                data-testid="qbo-push"
                disabled={pushState === "pushing" || toPush.length === 0 || demo}
                onClick={() => void pushApproved()}
              >
                {pushState === "pushing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Push {toPush.length} approved invoice{toPush.length === 1 ? "" : "s"}
              </Button>
              <Button variant="ghost" data-testid="qbo-disconnect" onClick={disconnect}>
                Disconnect
              </Button>
            </>
          )}
          {alreadyCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {alreadyCount} already pushed ✓
            </span>
          )}
          {approved.length === 0 && connection !== null && (
            <span className="text-xs text-muted-foreground">approve drafts first</span>
          )}
        </div>
        {connectError !== null && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
            {connectError} — setup steps in <span className="font-mono">docs/QUICKBOOKS_SETUP.md</span>.
          </div>
        )}
        {results.length > 0 && (
          <ul className="space-y-1 text-xs">
            {results.map((r) => (
              <li key={r.partner} className="flex items-center gap-2">
                {icon(r.tone)}
                <span className="font-medium">{r.partner}</span>
                <span className={r.tone === "warn" ? "text-warning" : "text-muted-foreground"}>
                  {r.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
        {pushState === "done" && results.length > 0 && results.every((r) => r.tone !== "fail") && (
          <p className="text-xs text-success">
            Push complete — {createdCount} created
            {results.length - createdCount - flaggedCount > 0 &&
              `, ${results.length - createdCount - flaggedCount} already in QBO`}
            {flaggedCount > 0 && `, ${flaggedCount} flagged (totals differ)`}
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

Notes for the implementer:
- The v1 `Money` / `money` imports are intentionally absent from the replacement (the summary line no longer sums approved totals) — nothing else in the file uses them.
- `files` comes from `useClose()` — it's already in the store (`closeStore.tsx` provider value, includes each slot's `fingerprint`).
- Demo mode stays: the push button is disabled when `demo` is true.

- [ ] **Step 5.2: Verify types, build, and the full suite**

Run: `pnpm --dir web typecheck`
Expected: clean exit, no output.

Run: `pnpm --dir web build`
Expected: `✓ built in …s`.

Run: `pnpm test`
Expected: ALL tests pass (286 pre-existing + ~22 new ≈ 308).

- [ ] **Step 5.3: Commit**

```bash
git add web/src/components/QuickBooksCard.tsx
git commit -m "feat(web): QuickBooksCard v2 — auto-renewing connection, dedup-aware push results"
```

---

### Task 6: Runbook v2

**Files:**
- Modify: `docs/QUICKBOOKS_SETUP.md`

- [ ] **Step 6.1: Replace the v1 behavior + troubleshooting sections**

In `docs/QUICKBOOKS_SETUP.md`, replace everything from `## Behavior & limits (v1)` to the end of the file with:

```markdown
## Behavior (v2)

- Customer matching is by **DisplayName = partner card name**; missing
  customers are created automatically. If your QBO file already names a
  partner differently, rename in QBO or expect a second customer.
- Held/NFR/zero-quantity lines are never pushed (mirrors the paper invoice).
- **The connection auto-renews.** Access tokens (~1 hour) refresh silently;
  the connection lives as long as Intuit's refresh token (~100 days of
  inactivity). "connected · auto-renews" means exactly that. You only
  reconnect if the app's access is revoked or unused for ~100 days.
- **Re-pushes never duplicate.** Before creating, the push checks whether the
  partner already has an invoice for the period (DocNumber `HUB-<period>-…`).
  If it exists with the same total: "already in QBO — invoice N". If it exists
  with a **different** total (numbers changed since the first push): the row is
  flagged "ours $A vs QBO $B — resolve in QuickBooks" and **nothing is
  written** — this tool never updates or voids an existing QBO invoice.
- Already-pushed invoices (this browser, same files) show "N already pushed ✓"
  and are skipped without an API call; the server-side check covers other
  browsers and cleared storage.
- Demo data: the push button is disabled in demo mode on purpose.

## Troubleshooting

- **"QuickBooks is not configured"** — env vars missing on the deployment.
- **"session expired — reconnect"** — the ~100-day refresh token is dead or
  access was revoked in Intuit; click Connect QuickBooks again. (Hourly
  expiries no longer surface — they refresh automatically.)
- **"already in QBO … resolve in QuickBooks"** — the draft's numbers changed
  after the invoice was first pushed. Fix the invoice in QBO (edit or
  delete + re-push) — the workbench won't touch it.
- **"OAuth state mismatch"** — the connect popup was opened too long ago
  (>10 min) or cookies are blocked; close it and click Connect again.
- **"QBO invoice create failed" with an ItemRef error** — set
  `QBO_DEFAULT_ITEM_ID` to a real Item Id from your company file.
```

- [ ] **Step 6.2: Commit**

```bash
git add docs/QUICKBOOKS_SETUP.md
git commit -m "docs: QuickBooks runbook v2 — auto-refresh + dedup behavior"
```

---

### Task 7: Full gate

- [ ] **Step 7.1: Run everything**

```bash
pnpm test && pnpm --dir web typecheck && pnpm --dir web build
```

Expected: full suite green (≈308 tests), typecheck silent, build `✓ built`.

- [ ] **Step 7.2: Spec cross-check**

Re-read `docs/superpowers/specs/2026-09-23-qbo-v2-design.md` §9 success criteria against the diff (`git diff d387cbd..HEAD --stat`). Every criterion should map to landed code:
1. auto-refresh → Task 1 + 4; 2. dedup → Task 3 (+ client skip, Task 4/5); 3. totals-differ flag → Task 3/5; 4. state + origin → Task 2; 5. runbook → Task 6.

- [ ] **Step 7.3: Do NOT push or deploy**

Lita is mid-test on prod. Commits stay local on `main` alongside the 9 already queued. Deployment happens only after her sign-off, per the state doc's deploy checklist.
