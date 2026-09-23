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
