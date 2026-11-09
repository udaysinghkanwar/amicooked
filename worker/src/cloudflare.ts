import type { Env } from "./env";

const API = "https://api.cloudflare.com/client/v4";

export class CloudflareApiError extends Error {
  constructor(
    readonly status: number,
    readonly codes: number[],
  ) {
    super(`Cloudflare API error ${status}${codes.length ? ` (codes ${codes.join(",")})` : ""}`);
    this.name = "CloudflareApiError";
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  errors?: { code: number; message?: string }[];
  result: T;
}

async function call<T>(env: Env, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.CF_API_TOKEN}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: ApiEnvelope<T> | undefined;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    json = undefined;
  }
  if (!res.ok || !json?.success) {
    throw new CloudflareApiError(res.status, (json?.errors ?? []).map((e) => e.code));
  }
  return json.result;
}

/** Runs a delete and treats "already gone" (404) as success. */
async function ignoreNotFound(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (err) {
    if (err instanceof CloudflareApiError && err.status === 404) return;
    throw err;
  }
}

const tunnelPath = (env: Env, tunnelId = "") =>
  `/accounts/${env.CF_ACCOUNT_ID}/cfd_tunnel${tunnelId ? `/${tunnelId}` : ""}`;

export async function createTunnel(env: Env, name: string): Promise<string> {
  const result = await call<{ id: string }>(env, "POST", tunnelPath(env), {
    name,
    config_src: "cloudflare",
  });
  return result.id;
}

export async function configureTunnel(env: Env, tunnelId: string, hostname: string): Promise<void> {
  await call(env, "PUT", `${tunnelPath(env, tunnelId)}/configurations`, {
    config: {
      ingress: [
        { hostname, service: env.ORIGIN_SERVICE },
        { service: "http_status:404" },
      ],
    },
  });
}

export async function getTunnelToken(env: Env, tunnelId: string): Promise<string> {
  return call<string>(env, "GET", `${tunnelPath(env, tunnelId)}/token`);
}

export async function createCname(env: Env, hostname: string, tunnelId: string): Promise<string> {
  const result = await call<{ id: string }>(env, "POST", `/zones/${env.CF_ZONE_ID}/dns_records`, {
    type: "CNAME",
    name: hostname,
    content: `${tunnelId}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
  });
  return result.id;
}

export async function deleteDnsRecord(env: Env, recordId: string): Promise<void> {
  await ignoreNotFound(call(env, "DELETE", `/zones/${env.CF_ZONE_ID}/dns_records/${recordId}`));
}

/** Drops any live cloudflared connections, then deletes the tunnel. */
export async function deleteTunnel(env: Env, tunnelId: string): Promise<void> {
  await ignoreNotFound(call(env, "DELETE", `${tunnelPath(env, tunnelId)}/connections`));
  await ignoreNotFound(call(env, "DELETE", tunnelPath(env, tunnelId)));
}
