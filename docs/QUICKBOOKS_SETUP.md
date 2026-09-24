# QuickBooks Online integration — setup (one-time, ~15 minutes)

The workbench pushes **approved** drafts straight into QuickBooks Online as
invoices (Invoices screen → QuickBooks Online card). The connection is
per-browser: tokens live in the accountant's localStorage; the Vercel
serverless functions (`api/qbo/*`) are stateless and hold only the app
credentials. Nothing about the close is stored server-side.

## 1. Create the Intuit developer app

1. Go to <https://developer.intuit.com> → sign in with the company Intuit
   account → **Create an app** → *QuickBooks Online and Payments*.
2. Under **Keys & credentials**, note the **Client ID** and **Client Secret**.
   Start with the *Development* keys against a sandbox company; switch to the
   *Production* keys after a successful test run. Intuit's production-keys
   form requires live EULA and Privacy Policy URLs — use
   `https://coro-billing.vercel.app/legal/eula.html` and
   `https://coro-billing.vercel.app/legal/privacy.html` (served from
   `web/public/legal/`).
3. Add the **Redirect URI** (must match exactly):
   `https://coro-billing.vercel.app/api/qbo/callback`

## 2. Configure Vercel

Project **msp-hub1/coro-billing** → Settings → Environment Variables
(Production):

| Variable | Value |
| --- | --- |
| `QBO_CLIENT_ID` | from step 1 |
| `QBO_CLIENT_SECRET` | from step 1 |
| `QBO_REDIRECT_URI` | `https://coro-billing.vercel.app/api/qbo/callback` |
| `QBO_ENV` | `sandbox` first, then `production` |
| `QBO_DEFAULT_ITEM_ID` | optional — the QBO Item every line references (default `1`, the stock "Services" item). To use a dedicated item, create e.g. "Coro Licensing" under Products & Services in QBO and put its Id here. |

Redeploy after setting the variables (`vercel deploy --prod` or a git push).

## 3. Connect and test

1. Open the workbench → Invoices → **Connect QuickBooks** → sign in and pick
   the company file. The popup closes itself; the card shows **connected**.
2. Approve at least one draft, then **Push N approved invoices**. Each partner
   reports success (with the QBO invoice id) or a specific failure.
3. Verify the invoices in QBO (Sales → Invoices): DocNumbers are
   `HUB-<period>-<seq>`, matching the workbench's invoice documents.

## Behavior (v2)

- Customer matching is by **DisplayName = partner card name**; missing
  customers are created automatically. If your QBO file already names a
  partner differently, rename in QBO or expect a second customer.
- Held/NFR/zero-quantity lines are never pushed (mirrors the paper invoice).
- **The connection auto-renews.** Access tokens (~1 hour) refresh silently;
  the connection lives as long as Intuit's refresh token (~100 days of
  inactivity). "connected · auto-renews" means exactly that. You only
  reconnect if the app's access is revoked or unused for ~100 days. A
  temporary Intuit outage never disconnects you — the affected push rows just
  fail and can be retried.
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
  expiries no longer surface — they refresh automatically. A row that fails
  with "QuickBooks refresh failed …" is a temporary Intuit error: the
  connection is fine, just push again.)
- **"already in QBO … resolve in QuickBooks"** — the draft's numbers changed
  after the invoice was first pushed. Fix it in QBO by **deleting** the old
  invoice and re-pushing (or edit it in QBO directly). **Voiding is not
  enough** — a voided invoice keeps its DocNumber with a $0.00 total, so the
  row keeps flagging.
- **"OAuth state mismatch"** — the connect popup was opened too long ago
  (>10 min) or cookies are blocked; close it and click Connect again.
- **"Invalid docNumber"** — the push sends `HUB-<period>-<seq>` numbers only;
  seeing this means a client/server version mismatch — redeploy both.
- **"QBO invoice create failed" with an ItemRef error** — set
  `QBO_DEFAULT_ITEM_ID` to a real Item Id from your company file.
