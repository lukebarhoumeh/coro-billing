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
      if (e.origin !== window.location.origin) return; // only our own popup may hand us tokens
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
            setPushed(
              recordPushed(localStorage, pushedKey, p.slug, {
                qboInvoiceId: o.qboInvoiceId,
                docNumber,
                totalCents,
                at: Date.now(),
              })
            );
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
            setPushed(
              recordPushed(localStorage, pushedKey, p.slug, {
                qboInvoiceId: o.qboInvoiceId,
                docNumber: o.qboDocNumber ?? docNumber,
                totalCents,
                at: Date.now(),
              })
            );
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
          setResults([...out]);
          break;
        }
        out.push({ partner: p.cardName, tone: "fail", detail: String(e) });
      }
      setResults([...out]);
    }
    setResults(out);
    setPushState("done");
  }, [connection, model, toPush, period, pushedKey]);

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
