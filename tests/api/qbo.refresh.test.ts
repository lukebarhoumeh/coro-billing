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
    const fetchMock = vi.fn(async (_url: string, _init: { body: string; headers: Record<string, string> }) =>
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
    const [url, init] = fetchMock.mock.calls[0]!;
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
