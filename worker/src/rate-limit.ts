import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { hmacSha256Hex } from "./crypto";

const DAY_MS = 86_400_000;

interface Window {
  count: number;
}

/**
 * Fixed-window counter, one object per (client IP, UTC day). The object name is
 * an HMAC of the day and IP, so the IP itself is never stored, and the object
 * wipes its storage when the day ends.
 */
export class RateLimiter extends DurableObject<Env> {
  async hit(limit: number, windowEnd: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const w = (await this.ctx.storage.get<Window>("w")) ?? { count: 0 };
    const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd - Date.now()) / 1000));
    if (w.count >= limit) return { allowed: false, retryAfterSeconds };
    w.count += 1;
    await this.ctx.storage.put("w", w);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(windowEnd);
    return { allowed: true, retryAfterSeconds };
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export async function checkRateLimit(
  env: Env,
  ip: string,
  limit: number,
  now = Date.now(),
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const day = Math.floor(now / DAY_MS);
  // Keyed with the API token so the name can't be brute-forced back to an IPv4.
  const name = await hmacSha256Hex(`rate-limit:${env.CF_API_TOKEN}`, `${day}:${ip}`);
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(name));
  return stub.hit(limit, (day + 1) * DAY_MS);
}
