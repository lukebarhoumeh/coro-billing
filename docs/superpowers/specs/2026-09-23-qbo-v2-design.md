# QuickBooks v2 — Token Auto-Refresh + Push Dedup — Design Spec

**Date:** 2026-09-23
**Trigger:** Lita is mid-test on https://coro-billing.vercel.app (prod frozen at `a2ddcf8`), so this
round is the parallel engineering track Luke picked. v1 QBO shipped 2026-09-21 (`41d47e3`) with two
documented limits (`docs/QUICKBOOKS_SETUP.md` §"Behavior & limits (v1)"): tokens die after ~1 hour
with no refresh, and re-pushes create duplicate invoices. v2 removes both. Design approved by Luke
2026-09-23 (approach A; re-push behavior = skip + flag).
**Deployment rule for this round:** LOCAL ONLY. No `git push`, no `vercel` deploy until Lita signs
off. Everything lands as local commits on `main`. (Verified 2026-09-23: the Vercel project has no
git integration — deploys only happen via CLI — but the freeze covers pushes anyway.)

---

## 1. v1 baseline and what's wrong with it

| Piece | v1 behavior | Problem |
| --- | --- | --- |
| `api/qbo/connect.ts` | Redirects to Intuit authorize with a random `state` | Comment claims "verified by the callback via the state round-trip" — **the callback never checks it**. CSRF hole + lying comment. |
| `api/qbo/callback.ts` | Exchanges code, hands tokens to the opener via `postMessage(payload, "*")` | `"*"` target origin lets any opener receive the tokens. Payload also omits the refresh-token expiry, so the client can't know how long the connection really lives. |
| `web/src/components/QuickBooksCard.tsx` | `loadConnection()` returns `null` once `expiresAt` (access token, ~1 h) passes | Accountant reconnects every hour; a 401 mid-push kills the whole run. |
| `api/qbo/push.ts` | Find-or-create customer, create invoice. No existence check. | Pushing twice = two invoices with the same DocNumber. The runbook literally warns "push a partner once". |

## 2. Decisions (locked with Luke, 2026-09-23)

1. **Re-push of an invoice that already exists in QBO: SKIP + FLAG.** The tool never updates or
   voids an existing QBO invoice. It reports "already in QBO (invoice N)" and, when our current
   draft total differs from QBO's `TotalAmt`, flags both numbers loudly for manual resolution in
   QBO. Rationale: numbers legitimately change between pushes (the 2026-09-22 corrected pricing
   file moved several partners' totals); silently rewriting a ledger — possibly already sent or
   partially paid — is the one unforgivable behavior for an accounting tool.
2. **Refresh architecture: approach A** — dedicated `api/qbo/refresh.ts` + a client token helper
   (`web/src/lib/qbo.ts`). Rejected: refresh-inside-push (every response, including errors, would
   have to carry maybe-rotated tokens); server-side token store (abandons the deliberate v1
   stateless design).

## 3. Components

| File | Change |
| --- | --- |
| `api/qbo/refresh.ts` | **New.** POST `{ refreshToken }` → Intuit token endpoint (`grant_type=refresh_token`, Basic auth with app credentials) → `{ ok, accessToken, refreshToken, expiresAt, refreshTokenExpiresAt }`. |
| `api/qbo/connect.ts` | Sets the CSRF state in an `HttpOnly; Secure; SameSite=Lax; Path=/api/qbo; Max-Age=600` cookie (`qbo_oauth_state`) alongside the query param. Comment finally tells the truth. |
| `api/qbo/callback.ts` | Verifies `state` query param against the cookie (400 on mismatch/absence). `postMessage` targets `new URL(QBO_REDIRECT_URI).origin`, not `"*"`. Payload gains `refreshTokenExpiresAt` (from Intuit's `x_refresh_token_expires_in`, ~100 days). |
| `api/qbo/push.ts` | Dedup query before create (§5). Request shape unchanged — the expected total is computed server-side from the submitted lines. Response gains `deduped`, and when deduped: `qboDocNumber`, `qboTotalCents`, `expectedTotalCents`, `totalsMatch`, `duplicateCount`. |
| `web/src/lib/qbo.ts` | **New.** Owns the connection lifecycle: `loadConnection` / `persistConnection` / `clearConnection`, `ensureFresh` (proactive refresh when the access token is within 5 min of expiry), `pushInvoice` (calls `/api/qbo/push`; on 401 refreshes once and retries once; second 401 → `reconnect` signal). Persists rotated tokens **immediately** on every refresh — Intuit rotates the refresh token on each use, and losing the new one kills the connection. |
| `web/src/components/QuickBooksCard.tsx` | Uses the helper. Connection counts as connected while the **refresh token** lives (v1 shape without `refreshTokenExpiresAt` = treat as alive and let the first refresh decide). Push results distinguish created / already-in-QBO / totals-differ / failed. Button label: "Push N approved" with an "M already pushed" note; known-pushed invoices are skipped client-side (§6). |
| `docs/QUICKBOOKS_SETUP.md` | "Behavior & limits (v1)" rewritten for v2; troubleshooting updated (401 mid-push now auto-recovers; "already in QBO" row explained). |

## 4. Token lifecycle

- Access token ~1 h (`expires_in`), refresh token ~100 days (`x_refresh_token_expires_in`), and
  **Intuit rotates the refresh token on every refresh** — the response's `refresh_token` replaces
  the stored one, every time, no exceptions.
- Client semantics: *connected* = stored connection whose `refreshTokenExpiresAt` (when known) is
  in the future. `ensureFresh` refreshes when `expiresAt − now < 5 min`; `pushInvoice` additionally
  refresh-retries once on a 401 (covers revocation-then-reauth races and clock skew).
- `refresh.ts` error mapping: Intuit 4xx (`invalid_grant` = expired/revoked) → **401**
  `"QuickBooks session expired — reconnect."` (client uniformly drops the connection and shows
  Connect); other Intuit failures → 502 with detail; missing env → 503 (parity with connect);
  non-POST → 405.
- v1→v2 storage migration: a stored v1 connection (no `refreshTokenExpiresAt`) is loaded as
  connected; the first `ensureFresh` either rotates it into a full v2 record or fails into the
  reconnect path. No migration code beyond the optional field.

## 5. Push dedup (server, authoritative)

After resolving the customer and before creating:

```
select Id, DocNumber, TotalAmt from Invoice
where CustomerRef = '<customerId>' and DocNumber like 'HUB-<period>-%'
```

- The prefix comes from the request's `docNumber` up to and including the last `-`
  (`HUB-202608-001` → `HUB-202608-%`). **Prefix + customer, not exact DocNumber**, because the
  sequence part is the partner's index in the model and partner ordering can shift when the
  pricing file changes — an exact match would miss the earlier push and duplicate.
- Hit → **no write.** Respond 200 `{ ok: true, deduped: true, qboInvoiceId, qboDocNumber,
  qboTotalCents, expectedTotalCents, totalsMatch, duplicateCount }`. Multiple hits (shouldn't
  happen, but ledgers are ledgers): report the first so the card can say "2 invoices already carry
  this period".
- Miss → create exactly as v1 → `{ ok: true, deduped: false, qboInvoiceId, docNumber }`.
- Totals compare in **integer cents**, both sides computed server-side from what it already has:
  `expectedTotalCents = round(Σ request lines' amount × 100)` (line amounts are cent-exact `Money`
  values serialized as floats; sum then round once) vs `qboTotalCents = round(TotalAmt × 100)`.
  `totalsMatch` is always present on a dedup hit — no extra request field for the client to get
  wrong.

## 6. Pushed-state (client, best-effort UX layer)

- localStorage `qbo-pushed`, records keyed exactly like the review store — **period + file
  fingerprints + partner slug** (reuse `closeStore`'s existing key derivation; do not invent a
  second convention) — holding `{ qboInvoiceId, docNumber, totalCents, at }`.
- Card behavior: known-pushed invoices render a "pushed ✓ invoice N" chip and are skipped without
  an API call. The server query (§5) remains the backstop for other browsers / cleared storage.
- Migration story falls out for free: after the pricing-file change, old pushed-records key against
  the old fingerprints and don't rehydrate → the card re-pushes → the server dedups and flags
  totals-differ where the corrected sheet moved a partner's total. Which is precisely the honest
  outcome we want surfaced.
- Demo mode: unchanged — push stays disabled on demo data.

## 7. Error handling summary

| Failure | Where | Response / UX |
| --- | --- | --- |
| State cookie missing/mismatched | callback | 400 "OAuth state mismatch — close this window and retry Connect." |
| Refresh token expired/revoked | refresh | 401 → card drops connection, shows Connect |
| Access token 401 mid-push | client helper | refresh once → retry once → else reconnect UX; run continues for remaining partners only after a successful retry (a dead connection still stops the run, as v1) |
| Invoice exists, totals equal | push | success row "already in QBO — invoice N" (muted) |
| Invoice exists, totals differ | push | warning row "already in QBO — invoice N — ours $A vs QBO $B, resolve in QuickBooks" |
| QBO query/create failure | push | 502 with Intuit detail, per-partner failure row (as v1) |

## 8. Testing

Vitest, all mocked-`fetch` unit tests (handlers are plain default-export functions taking fake
req/res; `vi.stubGlobal("fetch", …)`, fake timers for expiry math):

- `tests/api/qbo.refresh.test.ts` — happy rotation (new pair + both expiries returned), Intuit
  `invalid_grant` → 401, other Intuit failure → 502, missing env → 503, non-POST → 405.
- `tests/api/qbo.push.test.ts` — dedup hit (no create call issued; totalsMatch true and false;
  duplicateCount), dedup miss → create as v1, prefix derivation, 401 pass-through, customer
  find-or-create unchanged (regression).
- `tests/api/qbo.oauth.test.ts` — connect sets the state cookie and embeds the same value in the
  redirect; callback 400s on mismatch; callback payload carries `refreshTokenExpiresAt`; postMessage
  script targets the redirect-URI origin, never `"*"`.
- `tests/web/qboClient.test.ts` — `ensureFresh` skew boundary (refreshes at <5 min, not at >5 min),
  rotated tokens persisted before the retried call, 401→refresh→retry-once (never twice),
  v1-shaped stored connection loads as connected, `clearConnection` on reconnect signal.

Suite stays green end-to-end (286 existing + new). `pnpm --dir web build` stays the deploy gate.

## 9. Success criteria

1. A connection survives past the 1-hour access-token expiry with zero user action, up to
   refresh-token expiry (~100 days).
2. Pushing the same close twice — same browser or a different one — creates **zero** duplicate QBO
   invoices; second push reports "already in QBO" per partner.
3. A re-push after draft numbers changed surfaces "totals differ (ours $A vs QBO $B)" and touches
   nothing in QBO.
4. OAuth callback rejects forged/absent state; tokens are posted only to our own origin.
5. Runbook describes v2 behavior; the v1 "reconnect hourly / push once" warnings are gone.

## 10. Out of scope (YAGNI)

- Updating/voiding QBO invoices from the workbench (decision §2.1 forbids it).
- QBO-side credit memos (the $1,041.38 CREDIT_EXPECTED is Coro→MSP Hub, not our AR).
- Sending invoice emails/PDFs from QBO; multi-company (multi-realm) support; server-side token or
  close-state storage; encrypting localStorage beyond what the browser provides.
- Creating the Intuit developer app + the 4 Vercel env vars — that's Luke's external clock
  (`docs/QUICKBOOKS_SETUP.md` §1–2), unchanged by this round.
