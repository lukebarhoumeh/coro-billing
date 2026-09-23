import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/qbo/push.js";
import { capture, jsonResponse } from "./helpers.js";

function body(overrides?: { lines?: { description: string; quantity: number; rate: number; amount: number }[] }) {
  return {
    realmId: "realm9",
    accessToken: "tok",
    invoice: {
      partner: "Rocker Cybersecurity",
      docNumber: "HUB-202608-004",
      lines: overrides?.lines ?? [
        { description: "Coro Complete", quantity: 2, rate: 10, amount: 20 },
        { description: "SAT Flex", quantity: 1, rate: 3.45, amount: 3.45 },
      ],
    },
  };
}

const CUSTOMER_HIT = { QueryResponse: { Customer: [{ Id: "9" }] } };
const NO_INVOICES = { QueryResponse: {} };

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/qbo/push — dedup", () => {
  it("skips creation when the partner+period already has an invoice (totals equal)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, CUSTOMER_HIT))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          QueryResponse: { Invoice: [{ Id: "77", DocNumber: "HUB-202608-004", TotalAmt: 23.45 }] },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const { res, cap } = capture();
    await handler({ method: "POST", body: body() }, res);
    expect(cap.status).toBe(200);
    expect(cap.body).toEqual({
      ok: true,
      deduped: true,
      qboInvoiceId: "77",
      qboDocNumber: "HUB-202608-004",
      qboTotalCents: 2345,
      expectedTotalCents: 2345,
      totalsMatch: true,
      duplicateCount: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // customer query + invoice query, NO create
    // Prefix + customer, not exact DocNumber (sequence can shift between pushes).
    // NB: encodeURIComponent leaves apostrophes as-is and turns % into %25.
    const invoiceQueryUrl = String(fetchMock.mock.calls[1]![0]);
    expect(invoiceQueryUrl).toContain("'HUB-202608-%25'");
    expect(invoiceQueryUrl).toContain("CustomerRef%20%3D%20'9'");
  });

  it("flags totals-differ without touching the existing invoice", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, CUSTOMER_HIT))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          QueryResponse: {
            Invoice: [
              { Id: "77", DocNumber: "HUB-202608-004", TotalAmt: 21.0 },
              { Id: "78", DocNumber: "HUB-202608-011", TotalAmt: 5.0 },
            ],
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const { res, cap } = capture();
    await handler({ method: "POST", body: body() }, res);
    const b = cap.body as { totalsMatch: boolean; qboTotalCents: number; expectedTotalCents: number; duplicateCount: number };
    expect(b.totalsMatch).toBe(false);
    expect(b.qboTotalCents).toBe(2100);
    expect(b.expectedTotalCents).toBe(2345);
    expect(b.duplicateCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("creates as v1 when no invoice exists yet", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, CUSTOMER_HIT))
      .mockResolvedValueOnce(jsonResponse(200, NO_INVOICES))
      .mockResolvedValueOnce(jsonResponse(200, { Invoice: { Id: "501", DocNumber: "HUB-202608-004" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, cap } = capture();
    await handler({ method: "POST", body: body() }, res);
    expect(cap.status).toBe(200);
    expect(cap.body).toEqual({ ok: true, deduped: false, qboInvoiceId: "501", docNumber: "HUB-202608-004" });
    const createCall = fetchMock.mock.calls[2]! as [string, { method: string }];
    expect(createCall[0]).toContain("/invoice");
    expect(createCall[1].method).toBe("POST");
  });

  it("still finds-or-creates the customer (regression)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: {} })) // no customer
      .mockResolvedValueOnce(jsonResponse(200, { Customer: { Id: "31" } })) // create customer
      .mockResolvedValueOnce(jsonResponse(200, NO_INVOICES)) // dedup query
      .mockResolvedValueOnce(jsonResponse(200, { Invoice: { Id: "600", DocNumber: "HUB-202608-004" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, cap } = capture();
    await handler({ method: "POST", body: body() }, res);
    expect((cap.body as { qboInvoiceId: string }).qboInvoiceId).toBe("600");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("401s uniformly when the dedup query hits an expired token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, CUSTOMER_HIT))
      .mockResolvedValueOnce(jsonResponse(401, { fault: "expired" }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, cap } = capture();
    await handler({ method: "POST", body: body() }, res);
    expect(cap.status).toBe(401);
    expect((cap.body as { error: string }).error).toBe("QuickBooks session expired — reconnect.");
  });
});
