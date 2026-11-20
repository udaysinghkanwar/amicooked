// Counts finished setups. Stores counters only: no IPs, no install IDs, nothing from Brightspace.
// Redis comes from the Upstash integration on Vercel (KV_REST_API_* or UPSTASH_REDIS_REST_* env vars).

// Must match the preset ids in src/schools.ts; a unit test checks this.
export const SCHOOLS = [
  "mcmaster", "waterloo", "western", "queens", "guelph", "laurier", "tmu",
  "uottawa", "carleton", "brock", "windsor", "laurentian", "lakehead", "custom",
];
export const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64", "win32-arm64"];

/** Redis commands for one event, or null if the event isn't one we count. */
export function commandsFor(event, now = new Date()) {
  if (!event || typeof event !== "object" || event.e !== "setup") return null;
  const school = SCHOOLS.includes(event.school) ? event.school : "custom";
  const platform = PLATFORMS.includes(event.platform) ? event.platform : "other";
  const day = now.toISOString().slice(0, 10);
  return [
    ["INCR", "setup:total"],
    ["HINCRBY", "setup:days", day, "1"],
    ["HINCRBY", "setup:schools", school, "1"],
    ["HINCRBY", "setup:platforms", platform, "1"],
  ];
}

// Vercel calls this with the request only; the rest is for tests
export function POST(request) {
  return handle(request, process.env, fetch);
}

export async function handle(request, env, fetchImpl) {
  const text = await request.text();
  if (text.length > 512) return new Response(null, { status: 413 });
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const commands = commandsFor(event);
  if (!commands) return new Response(null, { status: 400 });

  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return new Response(null, { status: 503 });
  try {
    const res = await fetchImpl(`${url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(3000),
    });
    // /pipeline answers 200 even when a command fails, with { error } in place of { result } for that command
    const results = res.ok ? await res.json() : null;
    const written = Array.isArray(results) && results.length === commands.length && results.every((r) => r && !r.error);
    return new Response(null, { status: written ? 204 : 502 });
  } catch {
    return new Response(null, { status: 502 });
  }
}
