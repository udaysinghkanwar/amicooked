// Counts finished setups, successful upgrades and install-command copies. Stores counters only: no IPs, no install IDs, nothing from Brightspace.
// The same Redis also holds opt-in update emails under separate signup:* keys, written only by signup.js.
// Redis comes from the Upstash integration on Vercel (KV_REST_API_* or UPSTASH_REDIS_REST_* env vars).

// Must match the preset ids in src/schools.ts; a unit test checks this.
export const SCHOOLS = [
  "mcmaster", "waterloo", "western", "queens", "guelph", "laurier", "tmu",
  "uottawa", "carleton", "brock", "windsor", "laurentian", "lakehead",
  "tdsb", "tcdsb", "pdsb", "dpcdsb", "yrdsb", "ycdsb", "ddsb", "dcdsb", "hdsb", "hcdsb", "viamonde", "monavenir",
  "hwdsb", "hwcdsb", "ocdsb", "ocsb", "cepeo", "cecce", "wrdsb", "wcdsb", "tvdsb", "ldcsb", "gecdsb", "wecdsb",
  "dsbn", "ncdsb", "scdsb", "smcdsb", "ldsb", "alcdsb", "ugdsb", "welcdsb", "lakehead-dsb", "tbcdsb", "rainbow", "sudbury-cdsb",
  "custom",
];
export const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64", "win32-arm64"];

// The install tabs on the site, as site/main.js names them
export const TABS = ["agent", "mac", "win", "npm"];

/**
 * Redis commands for one event, or null if the event isn't one we count. Every event also adds to
 * `<event>:hours`, keyed by UTC hour ("2026-11-25T14"), so stats can show when things happen.
 */
export function commandsFor(event, now = new Date()) {
  const commands = countsFor(event, now);
  if (commands) commands.push(["HINCRBY", `${event.e}:hours`, now.toISOString().slice(0, 13), "1"]);
  return commands;
}

function countsFor(event, now) {
  if (!event || typeof event !== "object") return null;
  const day = now.toISOString().slice(0, 10);
  if (event.e === "copy") {
    if (!TABS.includes(event.tab)) return null;
    return [
      ["HINCRBY", "copy:tabs", event.tab, "1"],
      ["HINCRBY", "copy:days", day, "1"],
    ];
  }
  if (event.e === "prompt") return [["INCR", "prompt:opens"]];
  if (event.e === "upgrade") {
    const version = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
    if (!["manual", "automatic"].includes(event.mode) || !["native", "npm"].includes(event.channel) ||
        typeof event.from !== "string" || typeof event.to !== "string" ||
        !version.test(event.from) || !version.test(event.to) || event.from === event.to) return null;
    return [
      ["INCR", "upgrade:total"],
      ["HINCRBY", "upgrade:days", day, "1"],
      ["HINCRBY", "upgrade:modes", event.mode, "1"],
      ["HINCRBY", "upgrade:channels", event.channel, "1"],
      ["HINCRBY", "upgrade:platforms", PLATFORMS.includes(event.platform) ? event.platform : "other", "1"],
      ["HINCRBY", "upgrade:versions", `${event.from}->${event.to}`, "1"],
    ];
  }
  if (event.e !== "setup") return null;
  const school = SCHOOLS.includes(event.school) ? event.school : "custom";
  const platform = PLATFORMS.includes(event.platform) ? event.platform : "other";
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
