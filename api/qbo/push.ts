/**
 * POST /api/qbo/push — create ONE invoice in QuickBooks Online.
 *
 * The workbench sends the approved draft (partner + lines) plus the tokens it
 * holds in localStorage; this function finds-or-creates the QBO Customer by
 * display name and creates the Invoice. Stateless: tokens pass through, never
 * stored. One invoice per call keeps errors granular for the accounting team.
 *
 * Body: {
 *   realmId, accessToken,
 *   invoice: {
 *     partner: string,                // QBO Customer DisplayName
 *     docNumber: string,              // HUB-202608-001
 *     lines: [{ description, quantity, rate, amount }],
 *   }
 * }
 * Dedup: if the customer already has an invoice whose DocNumber starts with
 * the same HUB-<period>- prefix, nothing is written; the response reports the
 * existing invoice and whether totals match (integer-cents comparison).
 * Env: QBO_DEFAULT_ITEM_ID (optional — the generic service Item; QBO requires
 * an ItemRef on every line; "1" is the stock "Services" item on most files),
 * QBO_ENV ("production" | "sandbox", default sandbox).
 */
interface Req {
  method?: string;
  body: unknown;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
}

interface PushLine {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}
interface PushBody {
  realmId?: string;
  accessToken?: string;
  invoice?: { partner?: string; docNumber?: string; lines?: PushLine[] };
}

function qboBase(): string {
  return (process.env["QBO_ENV"] ?? "sandbox") === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

async function qbo(
  realmId: string,
  token: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`${qboBase()}/v3/company/${realmId}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const body = req.body as PushBody;
  const { realmId, accessToken, invoice } = body ?? {};
  if (!realmId || !accessToken || !invoice?.partner || !invoice.lines?.length) {
    res.status(400).json({ error: "Missing realmId/accessToken/invoice{partner,lines}" });
    return;
  }
  const itemId = process.env["QBO_DEFAULT_ITEM_ID"] ?? "1";

  // 1) Find-or-create the Customer by DisplayName.
  const safeName = invoice.partner.replace(/'/g, "\\'");
  const q = await qbo(
    realmId,
    accessToken,
    `/query?query=${encodeURIComponent(`select Id from Customer where DisplayName = '${safeName}'`)}`
  );
  if (!q.ok) {
    res.status(q.status === 401 ? 401 : 502).json({
      error: q.status === 401 ? "QuickBooks session expired — reconnect." : "QBO query failed",
      detail: q.json,
    });
    return;
  }
  let customerId: string | undefined = (
    q.json as { QueryResponse?: { Customer?: { Id: string }[] } }
  )?.QueryResponse?.Customer?.[0]?.Id;

  if (customerId === undefined) {
    const created = await qbo(realmId, accessToken, "/customer", {
      method: "POST",
      body: { DisplayName: invoice.partner },
    });
    if (!created.ok) {
      res.status(502).json({ error: "Could not create QBO customer", detail: created.json });
      return;
    }
    customerId = (created.json as { Customer?: { Id: string } })?.Customer?.Id;
  }
  if (customerId === undefined) {
    res.status(502).json({ error: "QBO customer id missing after create" });
    return;
  }

  // 2) Dedup — never write when this partner+period already has an invoice.
  // Prefix + customer rather than exact DocNumber: the sequence part is the
  // partner's index in the model, which can shift when the pricing file
  // changes; an exact match would miss the earlier push and duplicate.
  const docNumber = invoice.docNumber ?? "";
  const prefix = docNumber.slice(0, docNumber.lastIndexOf("-") + 1);
  if (prefix.length > 0) {
    const existing = await qbo(
      realmId,
      accessToken,
      `/query?query=${encodeURIComponent(
        `select Id, DocNumber, TotalAmt from Invoice where CustomerRef = '${customerId}' and DocNumber like '${prefix}%'`
      )}`
    );
    if (!existing.ok) {
      res.status(existing.status === 401 ? 401 : 502).json({
        error:
          existing.status === 401
            ? "QuickBooks session expired — reconnect."
            : "QBO invoice query failed",
        detail: existing.json,
      });
      return;
    }
    const found =
      (existing.json as { QueryResponse?: { Invoice?: { Id: string; DocNumber?: string; TotalAmt?: number }[] } })
        ?.QueryResponse?.Invoice ?? [];
    if (found.length > 0) {
      // Skip + flag (decision 2026-09-23): report, compare totals in integer
      // cents, and let the accountant resolve any difference in QBO itself.
      const hit = found[0]!;
      const expectedTotalCents = Math.round(invoice.lines.reduce((s, l) => s + l.amount, 0) * 100);
      const qboTotalCents = Math.round((hit.TotalAmt ?? 0) * 100);
      res.status(200).json({
        ok: true,
        deduped: true,
        qboInvoiceId: hit.Id,
        qboDocNumber: hit.DocNumber,
        qboTotalCents,
        expectedTotalCents,
        totalsMatch: qboTotalCents === expectedTotalCents,
        duplicateCount: found.length,
      });
      return;
    }
  }

  // 3) Create the invoice.
  const inv = await qbo(realmId, accessToken, "/invoice", {
    method: "POST",
    body: {
      CustomerRef: { value: customerId },
      DocNumber: invoice.docNumber,
      Line: invoice.lines.map((l) => ({
        DetailType: "SalesItemLineDetail",
        Amount: l.amount,
        Description: l.description,
        SalesItemLineDetail: {
          ItemRef: { value: itemId },
          Qty: l.quantity,
          UnitPrice: l.rate,
        },
      })),
    },
  });
  if (!inv.ok) {
    res.status(502).json({ error: "QBO invoice create failed", detail: inv.json });
    return;
  }
  const createdInv = (inv.json as { Invoice?: { Id: string; DocNumber?: string } })?.Invoice;
  res
    .status(200)
    .json({ ok: true, deduped: false, qboInvoiceId: createdInv?.Id, docNumber: createdInv?.DocNumber });
}
