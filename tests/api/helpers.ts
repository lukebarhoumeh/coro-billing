/**
 * Structural fakes for the api/qbo handlers' local Req/Res interfaces.
 * The handlers only ever call status/json/setHeader/send/redirect, so a
 * capturing object satisfies all of them.
 */
export interface Captured {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  sent: string | null;
  redirect: { code: number; url: string } | null;
}

export interface FakeRes {
  status(code: number): FakeRes;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  send(body: string): void;
  redirect(code: number, url: string): void;
}

export function capture(): { res: FakeRes; cap: Captured } {
  const cap: Captured = { status: 0, body: null, headers: {}, sent: null, redirect: null };
  const res: FakeRes = {
    status(code: number) {
      cap.status = code;
      return res;
    },
    json(body: unknown) {
      cap.body = body;
    },
    setHeader(name: string, value: string) {
      cap.headers[name.toLowerCase()] = value;
    },
    send(body: string) {
      cap.sent = body;
    },
    redirect(code: number, url: string) {
      cap.redirect = { code, url };
    },
  };
  return { res, cap };
}

/** Fetch-shaped response the handlers consume via ok/status/json()/text(). */
export function jsonResponse(status: number, body: unknown): {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
