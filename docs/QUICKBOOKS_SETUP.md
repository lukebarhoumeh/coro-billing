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
   *Production* keys after a successful test run.
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

## Behavior & limits (v1)

- Customer matching is by **DisplayName = partner card name**; missing
  customers are created automatically. If your QBO file already names a
  partner differently, rename in QBO or expect a second customer.
- Held/NFR/zero-quantity lines are never pushed (mirrors the paper invoice).
- Tokens expire after ~1 hour and v1 does **not** auto-refresh — the card
  shows *not connected* again; reconnect and re-push (already-pushed invoices
  are not deduplicated, so push a partner once).
- Demo data: the push button is disabled in demo mode on purpose.

## Troubleshooting

- **"QuickBooks is not configured"** — env vars missing on the deployment.
- **401 mid-push** — token expired; reconnect. Re-push only the failed rows.
- **"QBO invoice create failed" with an ItemRef error** — set
  `QBO_DEFAULT_ITEM_ID` to a real Item Id from your company file.
