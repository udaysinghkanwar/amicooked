import { vi } from "vitest";

export interface Call {
  method: string;
  path: string;
  body: unknown;
  auth: string | null;
}

type Handler = (call: Call) => { status?: number; result?: unknown; success?: boolean } | undefined;

const ok = (result: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, errors: [], result }), {
    status,
    headers: { "content-type": "application/json" },
  });

const fail = (status: number, code = 1000) =>
  new Response(JSON.stringify({ success: false, errors: [{ code, message: "nope" }], result: null }), {
    status,
    headers: { "content-type": "application/json" },
  });

export const TUNNEL_ID = "c0ffee00-1234-4abc-8def-0123456789ab";
export const DNS_ID = "dns-record-1";
export const TOKEN = "eyJhIjoiYWNjdDEyMyIsInQiOiJ0dW5uZWwiLCJzIjoic2VjcmV0In0=";

/**
 * Replaces global fetch with a fake Cloudflare API. `override` can return a
 * response for any call (e.g. to inject a failure); otherwise a happy-path
 * default is used. Every call is recorded.
 */
export function mockCloudflare(override: Handler = () => undefined) {
  const calls: Call[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init as RequestInit);
    const url = new URL(req.url);
    if (url.origin !== "https://api.cloudflare.com") throw new Error(`unexpected fetch ${req.url}`);
    const text = await req.text();
    const call: Call = {
      method: req.method,
      path: url.pathname.replace("/client/v4", ""),
      body: text ? JSON.parse(text) : undefined,
      auth: req.headers.get("authorization"),
    };
    calls.push(call);

    const o = override(call);
    if (o) return o.success === false || (o.status ?? 200) >= 400 ? fail(o.status ?? 400) : ok(o.result, o.status);

    const { method, path } = call;
    if (method === "POST" && path === "/accounts/acct123/cfd_tunnel") return ok({ id: TUNNEL_ID });
    if (method === "PUT" && path.endsWith("/configurations")) return ok({});
    if (method === "GET" && path.endsWith("/token")) return ok(TOKEN);
    if (method === "POST" && path === "/zones/zone456/dns_records") return ok({ id: DNS_ID });
    if (method === "DELETE") return ok({});
    return fail(404);
  });
  return { calls, spy };
}
