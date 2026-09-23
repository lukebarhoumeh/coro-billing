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
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api/qbo");
    expect(cookie).toContain("Max-Age=600");
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
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Numeric realmId so these requests get PAST the realmId guard and pin the
    // state check itself (asserted via the mismatch message).
    const a = capture();
    await callback({ query: { code: "c", realmId: "9130357849", state: "s1" }, headers: {} }, a.res);
    expect(a.cap.status).toBe(400);
    expect((a.cap.body as { error: string }).error).toContain("OAuth state mismatch");
    const b = capture();
    await callback(
      { query: { code: "c", realmId: "9130357849", state: "s1" }, headers: { cookie: "qbo_oauth_state=OTHER" } },
      b.res
    );
    expect(b.cap.status).toBe(400);
    expect((b.cap.body as { error: string }).error).toContain("OAuth state mismatch");
    const c = capture();
    await callback(
      { query: { code: "c", realmId: "9130357849" }, headers: { cookie: "qbo_oauth_state=s1" } },
      c.res
    );
    expect(c.cap.status).toBe(400);
    expect((c.cap.body as { error: string }).error).toContain("OAuth state mismatch");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a hostile realmId before any token exchange", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, cap } = capture();
    await callback(
      {
        query: { code: "c", realmId: "</script><script>alert(1)//", state: "s1" },
        headers: { cookie: "qbo_oauth_state=s1" },
      },
      res
    );
    expect(cap.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
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
        query: { code: "c", realmId: "9130357849", state: "s1" },
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
