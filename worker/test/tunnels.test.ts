import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { cleanupStale } from "../src/index";
import { dayStart } from "../src/store";
import { DNS_ID, TOKEN, TUNNEL_ID, mockCloudflare } from "./cf-mock";

const UA = "amicooked/0.1.0 (darwin; node 24)";
let ipCounter = 0;

type IncomingRequest = Parameters<typeof worker.fetch>[0];

function request(path: string, init: RequestInit & { ip?: string } = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", UA);
  headers.set("cf-connecting-ip", init.ip ?? `203.0.113.${++ipCounter}`);
  const req = new Request(`https://tunnels.example${path}`, { ...init, headers }) as IncomingRequest;
  return worker.fetch(req, env);
}

async function rows() {
  return (await env.DB.prepare("SELECT * FROM tunnels").all()).results as Record<string, unknown>[];
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM tunnels");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /tunnels", () => {
  it("creates a config-managed tunnel, a proxied CNAME and returns the token", async () => {
    const { calls } = mockCloudflare();
    const res = await request("/tunnels", { method: "POST" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, string>;

    expect(body.subdomain).toMatch(/^[a-z2-7]{16}$/);
    expect(body.url).toBe(`https://${body.subdomain}.amicooked.app`);
    expect(body.tunnelToken).toBe(TOKEN);
    expect(body.tunnelId).toBe(TUNNEL_ID);
    expect(body.heartbeatSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const hostname = `${body.subdomain}.amicooked.app`;
    expect(calls.every((c) => c.auth === "Bearer test-token")).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /accounts/acct123/cfd_tunnel",
      `PUT /accounts/acct123/cfd_tunnel/${TUNNEL_ID}/configurations`,
      "POST /zones/zone456/dns_records",
      `GET /accounts/acct123/cfd_tunnel/${TUNNEL_ID}/token`,
    ]);
    expect(calls[0].body).toEqual({ name: `amicooked-${body.subdomain}`, config_src: "cloudflare" });
    expect(calls[1].body).toEqual({
      config: {
        ingress: [{ hostname, service: "http://127.0.0.1:8787" }, { service: "http_status:404" }],
      },
    });
    expect(calls[2].body).toEqual({
      type: "CNAME",
      name: hostname,
      content: `${TUNNEL_ID}.cfargotunnel.com`,
      proxied: true,
      ttl: 1,
    });

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]).sort()).toEqual(
      ["created_at", "dns_record_id", "last_seen", "secret_hash", "subdomain", "tunnel_id"].sort(),
    );
    expect(stored[0]).toMatchObject({ subdomain: body.subdomain, tunnel_id: TUNNEL_ID, dns_record_id: DNS_ID });
    expect(stored[0].secret_hash).not.toContain(body.heartbeatSecret);
    expect(stored[0].created_at).toBe(dayStart(Date.now()));
  });

  it("issues a different unguessable subdomain each time", async () => {
    let n = 0;
    mockCloudflare((c) =>
      c.method === "POST" && c.path.endsWith("/cfd_tunnel")
        ? { result: { id: `c0ffee00-1234-4abc-8def-00000000000${n++}` } }
        : undefined,
    );
    const a = (await (await request("/tunnels", { method: "POST" })).json()) as { subdomain: string };
    const b = (await (await request("/tunnels", { method: "POST" })).json()) as { subdomain: string };
    expect(a.subdomain).not.toBe(b.subdomain);
  });

  it.each([
    ["missing", undefined],
    ["a browser", "Mozilla/5.0 (Macintosh)"],
    ["a lookalike", "amicooked-evil/1.0.0"],
    ["no version", "amicooked/"],
  ])("rejects %s user agent", async (_label, ua) => {
    const { calls } = mockCloudflare();
    const headers: Record<string, string> = { "user-agent": ua ?? "" };
    const res = await request("/tunnels", { method: "POST", headers });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rate-limits to 5 requests per IP per day", async () => {
    let n = 0;
    const { calls } = mockCloudflare((c) =>
      c.method === "POST" && c.path.endsWith("/cfd_tunnel")
        ? { result: { id: `c0ffee00-1234-4abc-8def-00000000001${n++}` } }
        : undefined,
    );
    const ip = "198.51.100.7";
    for (let i = 0; i < 5; i++) {
      const res = await request("/tunnels", { method: "POST", ip });
      expect(res.status).toBe(201);
    }
    const before = calls.length;
    const limited = await request("/tunnels", { method: "POST", ip });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(calls.length).toBe(before);

    // A different IP is unaffected.
    expect((await request("/tunnels", { method: "POST", ip: "198.51.100.8" })).status).toBe(201);
  });

  it("refuses new tunnels when at capacity", async () => {
    const { calls } = mockCloudflare();
    const capped = { ...env, MAX_TUNNELS: "1" };
    const call = () =>
      worker.fetch(
        new Request("https://tunnels.example/tunnels", {
          method: "POST",
          headers: { "user-agent": UA, "cf-connecting-ip": `192.0.2.${++ipCounter}` },
        }) as IncomingRequest,
        capped,
      );
    expect((await call()).status).toBe(201);
    const n = calls.length;
    const res = await call();
    expect(res.status).toBe(503);
    expect(calls.length).toBe(n);
  });

  it("rolls back the tunnel when DNS creation fails", async () => {
    const { calls } = mockCloudflare((c) =>
      c.method === "POST" && c.path.endsWith("/dns_records") ? { status: 400 } : undefined,
    );
    const res = await request("/tunnels", { method: "POST" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "provision_failed" });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain(`DELETE /accounts/acct123/cfd_tunnel/${TUNNEL_ID}`);
    expect(await rows()).toHaveLength(0);
  });

  it("rolls back both DNS and tunnel when fetching the token fails", async () => {
    const { calls } = mockCloudflare((c) => (c.path.endsWith("/token") ? { status: 500 } : undefined));
    const res = await request("/tunnels", { method: "POST" });
    expect(res.status).toBe(502);
    const deletes = calls.filter((c) => c.method === "DELETE").map((c) => c.path);
    expect(deletes).toContain(`/zones/zone456/dns_records/${DNS_ID}`);
    expect(deletes).toContain(`/accounts/acct123/cfd_tunnel/${TUNNEL_ID}`);
    expect(await rows()).toHaveLength(0);
  });

  it("rejects other methods and paths", async () => {
    mockCloudflare();
    expect((await request("/tunnels", { method: "GET" })).status).toBe(405);
    expect((await request("/nope", { method: "POST" })).status).toBe(404);
  });
});

describe("POST /tunnels/heartbeat", () => {
  async function provision() {
    mockCloudflare();
    const body = (await (await request("/tunnels", { method: "POST" })).json()) as {
      tunnelId: string;
      heartbeatSecret: string;
      subdomain: string;
    };
    vi.restoreAllMocks();
    return body;
  }

  const heartbeat = (tunnelId: unknown, secret?: string) =>
    request("/tunnels/heartbeat", {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
      body: JSON.stringify({ tunnelId }),
    });

  it("updates lastSeen with the right secret, without calling Cloudflare", async () => {
    const t = await provision();
    const old = dayStart(Date.now()) - 10 * 86_400_000;
    await env.DB.prepare("UPDATE tunnels SET last_seen = ?").bind(old).run();

    const { calls } = mockCloudflare();
    const res = await heartbeat(t.tunnelId, t.heartbeatSecret);
    expect(res.status).toBe(204);
    expect(calls).toHaveLength(0);
    expect((await rows())[0].last_seen).toBe(dayStart(Date.now()));
  });

  it("rejects a wrong secret", async () => {
    const t = await provision();
    expect((await heartbeat(t.tunnelId, "wrong-secret")).status).toBe(401);
  });

  it("rejects a missing secret or malformed body", async () => {
    const t = await provision();
    expect((await heartbeat(t.tunnelId)).status).toBe(400);
    expect((await heartbeat(42, t.heartbeatSecret)).status).toBe(400);
    const res = await request("/tunnels/heartbeat", {
      method: "POST",
      headers: { authorization: `Bearer ${t.heartbeatSecret}` },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a tunnel that was cleaned up, so the client re-provisions", async () => {
    expect((await heartbeat("00000000-0000-4000-8000-000000000000", "x")).status).toBe(404);
  });

  it("requires the amicooked user agent", async () => {
    const t = await provision();
    const res = await request("/tunnels/heartbeat", {
      method: "POST",
      headers: { "user-agent": "curl/8.0", authorization: `Bearer ${t.heartbeatSecret}` },
      body: JSON.stringify({ tunnelId: t.tunnelId }),
    });
    expect(res.status).toBe(403);
  });
});

describe("daily cleanup", () => {
  const DAY = 86_400_000;

  async function seed(subdomain: string, tunnelId: string, lastSeen: number) {
    await env.DB.prepare(
      "INSERT INTO tunnels (subdomain, tunnel_id, dns_record_id, created_at, last_seen, secret_hash) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(subdomain, tunnelId, `dns-${subdomain}`, lastSeen, lastSeen, "h")
      .run();
  }

  it("deletes DNS, connections and tunnel for rows unseen for 30+ days", async () => {
    const today = dayStart(Date.now());
    await seed("stale", "11111111-1111-4111-8111-111111111111", today - 31 * DAY);
    await seed("fresh", "22222222-2222-4222-8222-222222222222", today - 29 * DAY);

    const { calls } = mockCloudflare();
    expect(await cleanupStale(env)).toEqual({ deleted: 1, failed: 0 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "DELETE /zones/zone456/dns_records/dns-stale",
      "DELETE /accounts/acct123/cfd_tunnel/11111111-1111-4111-8111-111111111111/connections",
      "DELETE /accounts/acct123/cfd_tunnel/11111111-1111-4111-8111-111111111111",
    ]);
    expect((await rows()).map((r) => r.subdomain)).toEqual(["fresh"]);
  });

  it("treats already-deleted resources as success", async () => {
    await seed("gone", "33333333-3333-4333-8333-333333333333", 0);
    mockCloudflare((c) => (c.method === "DELETE" ? { status: 404 } : undefined));
    expect(await cleanupStale(env)).toEqual({ deleted: 1, failed: 0 });
    expect(await rows()).toHaveLength(0);
  });

  it("keeps the row for retry when Cloudflare errors", async () => {
    await seed("flaky", "44444444-4444-4444-8444-444444444444", 0);
    mockCloudflare((c) => (c.method === "DELETE" && !c.path.includes("dns") ? { status: 500 } : undefined));
    expect(await cleanupStale(env)).toEqual({ deleted: 0, failed: 1 });
    expect(await rows()).toHaveLength(1);
  });

  it("stops at CLEANUP_BATCH_SIZE per run", async () => {
    for (let i = 0; i < 4; i++) await seed(`s${i}`, `5555555${i}-5555-4555-8555-555555555555`, i);
    mockCloudflare();
    expect(await cleanupStale({ ...env, CLEANUP_BATCH_SIZE: "3" })).toEqual({ deleted: 3, failed: 0 });
    expect((await rows()).map((r) => r.subdomain)).toEqual(["s3"]);
  });

  it("runs from the scheduled handler", async () => {
    await seed("cron", "66666666-6666-4666-8666-666666666666", 0);
    mockCloudflare();
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} };
    await worker.scheduled({} as ScheduledController, env, ctx as unknown as ExecutionContext);
    await Promise.all(waits);
    expect(await rows()).toHaveLength(0);
  });
});
