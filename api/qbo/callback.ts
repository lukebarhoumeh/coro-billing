/**
 * GET /api/qbo/callback — Intuit OAuth2 redirect target.
 *
 * Exchanges the authorization code for tokens (server-side, using the client
 * secret) and hands them to the opener window via postMessage; the workbench
 * stores them in localStorage. Nothing is persisted server-side.
 *
 * Env: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI.
 */
interface Req {
  query: Record<string, string | string[] | undefined>;
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

export default async function handler(req: Req, res: Res): Promise<void> {
  const clientId = process.env["QBO_CLIENT_ID"];
  const clientSecret = process.env["QBO_CLIENT_SECRET"];
  const redirectUri = process.env["QBO_REDIRECT_URI"];
  const code = first(req.query["code"]);
  const realmId = first(req.query["realmId"]);

  if (!clientId || !clientSecret || !redirectUri) {
    res.status(503).json({ error: "QuickBooks is not configured (missing env)." });
    return;
  }
  if (!code || !realmId) {
    res.status(400).json({ error: "Missing code/realmId from Intuit." });
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
  };

  // Hand off to the opener and close. The payload never touches our servers again.
  const payload = JSON.stringify({
    type: "qbo-connected",
    realmId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><body style="font-family:system-ui;background:#0d1220;color:#eee;display:grid;place-items:center;height:100vh">
<div>QuickBooks connected — you can close this window.</div>
<script>
  if (window.opener) {
    window.opener.postMessage(${payload}, "*");
    setTimeout(function(){ window.close(); }, 800);
  }
</script></body></html>`);
}
