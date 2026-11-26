// Optional update-email signups from `amicooked setup`. Kept apart from e.js, whose counters hold no personal data.
// Stores one hash, `signup:emails`: email -> { at, src, consent, v }. Nothing from Brightspace, no raw IPs.
// Rate limit keys are a salted SHA-256 of day + IP and expire after a day. Needs SIGNUP_SALT plus the Upstash env vars.

// Prompt wordings the CLI may send. Add a new id whenever the prompt text changes, so each record proves what was shown.
export const CONSENT_VERSIONS = ["2026-11-26", "2026-11-26-prompt"];
export const MAX_PER_IP_PER_DAY = 5;
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

/** The normalized email, or null if it isn't one. */
export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Vercel calls this with the request only; the rest is for tests
export function POST(request) {
  return handle(request, process.env, fetch);
}

export async function handle(request, env, fetchImpl, now = new Date()) {
  const text = await request.text();
  if (text.length > 512) return new Response(null, { status: 413 });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const email = normalizeEmail(body?.email);
  if (!email || !CONSENT_VERSIONS.includes(body.consent)) return new Response(null, { status: 400 });

  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !env.SIGNUP_SALT) return new Response(null, { status: 503 });

  const redis = async (commands) => {
    const res = await fetchImpl(`${url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(3000),
    });
    // /pipeline answers 200 even when a command fails, with { error } in place of { result } for that command
    const results = res.ok ? await res.json() : null;
    if (!Array.isArray(results) || results.length !== commands.length || results.some((r) => !r || r.error)) {
      throw new Error("redis");
    }
    return results.map((r) => r.result);
  };

  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const day = now.toISOString().slice(0, 10);
    const limitKey = `signup:rl:${await sha256Hex(`${env.SIGNUP_SALT}:${day}:${ip}`)}`;
    const [count] = await redis([["INCR", limitKey], ["EXPIRE", limitKey, "86400"]]);
    if (count > MAX_PER_IP_PER_DAY) return new Response(null, { status: 429 });

    const record = { at: now.toISOString(), src: "cli-setup", consent: body.consent, v: VERSION.test(body.version) ? body.version : null };
    // HSETNX keeps the first consent record; a repeat signup never rewrites it
    await redis([["HSETNX", "signup:emails", email, JSON.stringify(record)]]);
    // Same answer for new and existing addresses, so the endpoint can't be used to check who signed up
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 502 });
  }
}
