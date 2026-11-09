import * as cf from "./cloudflare";
import { digestsEqual, randomBase32, randomSecret, sha256Hex } from "./crypto";
import { type Env, intVar } from "./env";
import { checkRateLimit } from "./rate-limit";
import * as store from "./store";

export { RateLimiter } from "./rate-limit";
export type { Env } from "./env";

const USER_AGENT = /^amicooked\/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?:\s|$)/;
const SUBDOMAIN_LENGTH = 16; // 80 bits of base32
const DAY_MS = 86_400_000;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

const error = (status: number, code: string, headers?: Record<string, string>) =>
  json(status, { error: code }, headers);

export async function provisionTunnel(env: Env, now = Date.now()) {
  const subdomain = randomBase32(SUBDOMAIN_LENGTH);
  const hostname = `${subdomain}.${env.TUNNEL_DOMAIN}`;
  let tunnelId: string | undefined;
  let dnsRecordId: string | undefined;
  try {
    tunnelId = await cf.createTunnel(env, `amicooked-${subdomain}`);
    await cf.configureTunnel(env, tunnelId, hostname);
    dnsRecordId = await cf.createCname(env, hostname, tunnelId);
    const tunnelToken = await cf.getTunnelToken(env, tunnelId);
    const heartbeatSecret = randomSecret();
    await store.insertTunnel(env.DB, {
      subdomain,
      tunnelId,
      dnsRecordId,
      createdAt: store.dayStart(now),
      lastSeen: store.dayStart(now),
      secretHash: await sha256Hex(heartbeatSecret),
    });
    return { subdomain, url: `https://${hostname}`, tunnelId, tunnelToken, heartbeatSecret };
  } catch (err) {
    // Roll back so a failed request leaves nothing behind in the account.
    await Promise.allSettled([
      dnsRecordId ? cf.deleteDnsRecord(env, dnsRecordId) : undefined,
      tunnelId ? cf.deleteTunnel(env, tunnelId) : undefined,
    ]);
    throw err;
  }
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return error(400, "missing_client_ip");

  const limit = await checkRateLimit(env, ip, intVar(env.RATE_LIMIT_PER_DAY, 5));
  if (!limit.allowed) {
    return error(429, "rate_limited", { "retry-after": String(limit.retryAfterSeconds) });
  }

  if ((await store.countTunnels(env.DB)) >= intVar(env.MAX_TUNNELS, 1000)) {
    return error(503, "at_capacity");
  }

  try {
    return json(201, await provisionTunnel(env));
  } catch (err) {
    console.error(`provision failed: ${err instanceof cf.CloudflareApiError ? err.message : "internal"}`);
    return error(502, "provision_failed");
  }
}

async function handleHeartbeat(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const secret = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  let tunnelId: unknown;
  try {
    tunnelId = ((await request.json()) as { tunnelId?: unknown }).tunnelId;
  } catch {
    return error(400, "invalid_body");
  }
  if (typeof tunnelId !== "string" || !/^[0-9a-f-]{36}$/i.test(tunnelId) || !secret) {
    return error(400, "invalid_body");
  }

  const record = await store.findByTunnelId(env.DB, tunnelId.toLowerCase());
  if (!record) return error(404, "unknown_tunnel");
  if (!digestsEqual(await sha256Hex(secret), record.secretHash)) return error(401, "unauthorized");

  await store.touch(env.DB, record.subdomain, store.dayStart(Date.now()));
  return new Response(null, { status: 204 });
}

export async function cleanupStale(env: Env, now = Date.now()): Promise<{ deleted: number; failed: number }> {
  const cutoff = store.dayStart(now) - intVar(env.STALE_AFTER_DAYS, 30) * DAY_MS;
  const stale = await store.listStale(env.DB, cutoff, intVar(env.CLEANUP_BATCH_SIZE, 15));
  let deleted = 0;
  let failed = 0;
  for (const t of stale) {
    try {
      await cf.deleteDnsRecord(env, t.dnsRecordId);
      await cf.deleteTunnel(env, t.tunnelId);
      await store.deleteRecord(env.DB, t.subdomain);
      deleted++;
    } catch {
      failed++; // row stays; retried on the next run
    }
  }
  return { deleted, failed };
}

export default {
  async fetch(request, env): Promise<Response> {
    const ua = request.headers.get("user-agent") ?? "";
    if (!USER_AGENT.test(ua)) return error(403, "unsupported_client");

    const { pathname } = new URL(request.url);
    if (pathname === "/tunnels") {
      return request.method === "POST" ? handleCreate(request, env) : error(405, "method_not_allowed");
    }
    if (pathname === "/tunnels/heartbeat") {
      return request.method === "POST" ? handleHeartbeat(request, env) : error(405, "method_not_allowed");
    }
    return error(404, "not_found");
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      cleanupStale(env).then(({ deleted, failed }) => {
        console.log(`cleanup: deleted=${deleted} failed=${failed}`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
