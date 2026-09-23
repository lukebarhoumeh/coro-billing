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
