/**
 * QuickBooks Online integration — connect + push approved invoices.
 *
 * Tokens live in THIS browser's localStorage (handed over by the OAuth popup
 * via postMessage); the serverless functions under /api/qbo are stateless
 * pass-throughs holding only the app credentials. Push is one invoice per
 * call so the accounting team sees per-partner success/failure, not a blob.
 *
 * When the deployment has no QBO env configured, /api/qbo/connect answers 503
 * and this card explains what's missing instead of pretending.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleX, Link2, Loader2, Send } from "lucide-react";
import { Money } from "@pipeline/lib/money.js";
import { useClose } from "@/lib/closeStore";
import { money } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STORAGE_KEY = "qbo-connection";

interface QboConnection {
  readonly realmId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}

function loadConnection(): QboConnection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as QboConnection;
    return c.expiresAt > Date.now() ? c : null; // expired = disconnected (v1: no refresh flow)
  } catch {
    return null;
  }
}

type PushState = "idle" | "pushing" | "done";
interface PushResult {
  readonly partner: string;
  readonly ok: boolean;
  readonly detail: string;
}

export function QuickBooksCard() {
  const { model, review, period, demo } = useClose();
  const [connection, setConnection] = useState<QboConnection | null>(() => loadConnection());
  const [connectError, setConnectError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushState>("idle");
  const [results, setResults] = useState<readonly PushResult[]>([]);

  // Receive tokens from the OAuth popup.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string } & QboConnection;
      if (d?.type === "qbo-connected" && d.realmId && d.accessToken) {
        const c: QboConnection = {
          realmId: d.realmId,
          accessToken: d.accessToken,
          refreshToken: d.refreshToken,
          expiresAt: d.expiresAt,
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
        } catch {
          // storage full/private mode — session-only connection still works
        }
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
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // best-effort
    }
    setConnection(null);
    setResults([]);
    setPushState("idle");
  }, []);

  const approved = useMemo(
    () => (model?.partners ?? []).filter((p) => review[p.slug]?.status === "approved"),
    [model, review]
  );

  const pushApproved = useCallback(async () => {
    if (connection === null || model === null || approved.length === 0) return;
    setPushState("pushing");
    const out: PushResult[] = [];
    for (const p of approved) {
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
        out.push({ partner: p.cardName, ok: false, detail: "no billable lines" });
        continue;
      }
      try {
        const res = await fetch("/api/qbo/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            realmId: connection.realmId,
            accessToken: connection.accessToken,
            invoice: { partner: p.cardName, docNumber, lines },
          }),
        });
        const body = (await res.json().catch(() => null)) as
          | { ok?: boolean; qboInvoiceId?: string; error?: string }
          | null;
        if (res.ok && body?.ok) {
          out.push({ partner: p.cardName, ok: true, detail: `QBO invoice ${body.qboInvoiceId}` });
        } else {
          out.push({ partner: p.cardName, ok: false, detail: body?.error ?? `HTTP ${res.status}` });
          if (res.status === 401) {
            setConnection(null); // token died mid-run — stop pretending
            break;
          }
        }
      } catch (e) {
        out.push({ partner: p.cardName, ok: false, detail: String(e) });
      }
      setResults([...out]);
    }
    setResults(out);
    setPushState("done");
  }, [connection, model, approved, period]);

  if (model === null) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 normal-case tracking-normal text-foreground">
          <span className="text-sm font-medium">QuickBooks Online</span>
          {connection !== null ? (
            <Badge variant="success">connected</Badge>
          ) : (
            <Badge variant="muted">not connected</Badge>
          )}
          {demo && <Badge variant="warning">demo data — don't push</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Pushes each <b>approved</b> draft as a QuickBooks invoice (customer created by partner
          name if missing). File exports (CSV/IIF) remain available above.
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
                disabled={pushState === "pushing" || approved.length === 0 || demo}
                onClick={() => void pushApproved()}
              >
                {pushState === "pushing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Push {approved.length} approved invoice{approved.length === 1 ? "" : "s"}
              </Button>
              <Button variant="ghost" data-testid="qbo-disconnect" onClick={disconnect}>
                Disconnect
              </Button>
            </>
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
                {r.ok ? (
                  <CircleCheck className="h-3.5 w-3.5 shrink-0 text-success" />
                ) : (
                  <CircleX className="h-3.5 w-3.5 shrink-0 text-danger" />
                )}
                <span className="font-medium">{r.partner}</span>
                <span className="text-muted-foreground">{r.detail}</span>
              </li>
            ))}
          </ul>
        )}
        {pushState === "done" && results.every((r) => r.ok) && results.length > 0 && (
          <p className="text-xs text-success">
            All {results.length} invoices created —{" "}
            {money(approved.reduce((s, p) => s.add(p.totalL), Money.zero()))} total now in
            QuickBooks.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
