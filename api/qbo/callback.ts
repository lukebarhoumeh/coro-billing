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
  let origin: string;
  try {
    origin = new URL(redirectUri).origin;
  } catch {
    res.status(503).json({ error: "QBO_REDIRECT_URI is not a valid URL." });
    return;
  }
  if (!code || !realmId) {
    res.status(400).json({ error: "Missing code/realmId from Intuit." });
    return;
  }
  if (!/^\d+$/.test(realmId)) {
    res.status(400).json({ error: "Invalid realmId." });
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
  const payload = JSON.stringify({
    type: "qbo-connected",
    realmId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    refreshTokenExpiresAt: Date.now() + tokens.x_refresh_token_expires_in * 1000,
  });
  // JSON.stringify leaves "<" alone; escape it so a value can never terminate
  // the <script> element ("<" is a valid JSON string escape — same data).
  const safePayload = payload.replace(/</g, "\\u003c");
  res.setHeader(
    "Set-Cookie",
    "qbo_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/qbo; Max-Age=0"
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><body style="font-family:system-ui;background:#0d1220;color:#eee;display:grid;place-items:center;height:100vh">
<div>QuickBooks connected — you can close this window.</div>
<script>
  if (window.opener) {
    window.opener.postMessage(${safePayload}, ${JSON.stringify(origin)});
    setTimeout(function(){ window.close(); }, 800);
  }
</script></body></html>`);
}
