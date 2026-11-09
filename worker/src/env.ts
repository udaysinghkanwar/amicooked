import type { RateLimiter } from "./rate-limit";

export interface Env {
  DB: D1Database;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;

  // Secrets
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  CF_ZONE_ID: string;

  // Vars (wrangler.toml)
  TUNNEL_DOMAIN: string;
  ORIGIN_SERVICE: string;
  RATE_LIMIT_PER_DAY: string;
  MAX_TUNNELS: string;
  STALE_AFTER_DAYS: string;
  CLEANUP_BATCH_SIZE: string;
}

export function intVar(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
