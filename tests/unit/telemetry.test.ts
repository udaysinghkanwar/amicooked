import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESETS } from "../../src/schools.js";
import { REPORT_URL, reportSetup, reportUpgrade, telemetryOff } from "../../src/telemetry.js";
// @ts-expect-error plain JS Vercel function
import { commandsFor, handle, PLATFORMS, SCHOOLS, TABS } from "../../site/api/e.js";

const ok = () => vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("reportSetup", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-telemetry-"));
    process.env.AMICOOKED_HOME = home;
  });
  afterEach(() => {
    delete process.env.AMICOOKED_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("sends the preset id and platform once per computer", async () => {
    const fetchImpl = ok();
    expect(await reportSetup("mcmaster", { env: {}, fetchImpl, platform: "darwin-arm64" })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(REPORT_URL);
    expect(JSON.parse(String(init.body))).toEqual({ e: "setup", school: "mcmaster", platform: "darwin-arm64" });

    expect(await reportSetup("mcmaster", { env: {}, fetchImpl })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never sends a custom school's host", async () => {
    const fetchImpl = ok();
    await reportSetup("learn.example.edu", { env: {}, fetchImpl });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body)).school).toBe("custom");
  });

  it("sends nothing when turned off", async () => {
    const fetchImpl = ok();
    expect(await reportSetup("mcmaster", { env: { AMICOOKED_NO_TELEMETRY: "1" }, fetchImpl })).toBe(false);
    expect(await reportSetup("mcmaster", { env: { DO_NOT_TRACK: "1" }, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(telemetryOff({ DO_NOT_TRACK: "0" })).toBe(false);
  });

  it("sends only upgrade versions, mode, channel and platform without touching the setup marker", async () => {
    const fetchImpl = ok();
    const event = { from: "0.1.7", to: "0.1.8", mode: "automatic" as const, channel: "native" as const };
    expect(await reportUpgrade(event, { env: {}, fetchImpl, platform: "darwin-arm64" })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(REPORT_URL);
    expect(JSON.parse(String(init.body))).toEqual({ e: "upgrade", ...event, platform: "darwin-arm64" });
    expect(fs.existsSync(path.join(home, "setup-reported"))).toBe(false);
    for (const env of [{ AMICOOKED_NO_TELEMETRY: "1" }, { DO_NOT_TRACK: "1" }]) {
      expect(await reportUpgrade(event, { env, fetchImpl })).toBe(false);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await reportUpgrade(event, { env: {}, fetchImpl: async () => { throw new Error("offline"); } })).toBe(false);
    expect(await reportUpgrade(event, { env: {}, fetchImpl: async () => new Response(null, { status: 503 }) })).toBe(false);
  });

  it("stays quiet and retries next time when the request fails", async () => {
    const failing = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await reportSetup("mcmaster", { env: {}, fetchImpl: failing })).toBe(false);
    expect(fs.existsSync(path.join(home, "setup-reported"))).toBe(false);
  });
});

describe("site/api/e.js", () => {
  it("knows every school preset", () => {
    expect([...SCHOOLS].sort()).toEqual([...PRESETS.map((s) => s.id), "custom"].sort());
  });

  it("turns a setup event into counters", () => {
    expect(commandsFor({ e: "setup", school: "waterloo", platform: "win32-x64" }, new Date("2026-11-20T12:00:00Z"))).toEqual([
      ["INCR", "setup:total"],
      ["HINCRBY", "setup:days", "2026-11-20", "1"],
      ["HINCRBY", "setup:schools", "waterloo", "1"],
      ["HINCRBY", "setup:platforms", "win32-x64", "1"],
      ["HINCRBY", "setup:hours", "2026-11-20T12", "1"],
    ]);
    expect(PLATFORMS).toContain("darwin-arm64");
  });

  it("counts upgrades separately without changing existing setup keys", () => {
    const event = { e: "upgrade", from: "0.1.7", to: "0.1.8", mode: "automatic", channel: "native", platform: "darwin-arm64" };
    expect(commandsFor(event, new Date("2026-11-25T12:00:00Z"))).toEqual([
      ["INCR", "upgrade:total"], ["HINCRBY", "upgrade:days", "2026-11-25", "1"],
      ["HINCRBY", "upgrade:modes", "automatic", "1"], ["HINCRBY", "upgrade:channels", "native", "1"],
      ["HINCRBY", "upgrade:platforms", "darwin-arm64", "1"], ["HINCRBY", "upgrade:versions", "0.1.7->0.1.8", "1"],
      ["HINCRBY", "upgrade:hours", "2026-11-25T12", "1"],
    ]);
    for (const patch of [{ from: "private.example.edu" }, { to: "0.1.7" }, { mode: "check" }, { channel: "other" }, { from: 123 }]) {
      expect(commandsFor({ ...event, ...patch })).toBeNull();
    }
  });

  it("counts copies per install tab, and opens of the full prompt", () => {
    expect(commandsFor({ e: "copy", tab: "win" }, new Date("2026-11-20T12:00:00Z"))).toEqual([
      ["HINCRBY", "copy:tabs", "win", "1"],
      ["HINCRBY", "copy:days", "2026-11-20", "1"],
      ["HINCRBY", "copy:hours", "2026-11-20T12", "1"],
    ]);
    expect(commandsFor({ e: "copy", tab: "elsewhere" })).toBeNull();
    expect(commandsFor({ e: "prompt" }, new Date("2026-11-25T09:30:00Z"))).toEqual([
      ["INCR", "prompt:opens"],
      ["HINCRBY", "prompt:hours", "2026-11-25T09", "1"],
    ]);
  });

  it("knows every copy button on the site", () => {
    const main = fs.readFileSync(new URL("../../site/main.js", import.meta.url), "utf8");
    const html = fs.readFileSync(new URL("../../site/index.html", import.meta.url), "utf8");
    const buttons = [...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);
    const map = JSON.parse(main.match(/const COPY_TABS = (\{[^}]+\})/)![1].replace(/"?([\w-]+)"?:/g, '"$1":'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const id of buttons) {
      // Update actions are separate from setup-copy analytics.
      if (id.endsWith("-update")) expect(map[id]).toBeUndefined();
      else expect(TABS).toContain(map[id]);
    }
  });

  it("buckets unknown values instead of storing them", () => {
    const commands = commandsFor({ e: "setup", school: "learn.example.edu", platform: "plan9" });
    expect(commands[2][2]).toBe("custom");
    expect(commands[3][2]).toBe("other");
  });

  it("rejects unsupported events and malformed/oversized requests", async () => {
    expect(commandsFor({ e: "grades" })).toBeNull();
    const env = { KV_REST_API_URL: "https://redis.test", KV_REST_API_TOKEN: "t" };
    const fetchImpl = ok();
    const bad = await handle(new Request("https://x/api/e", { method: "POST", body: "not json" }), env, fetchImpl);
    expect(bad.status).toBe(400);
    const big = await handle(new Request("https://x/api/e", { method: "POST", body: "x".repeat(600) }), env, fetchImpl);
    expect(big.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  const redis = (results: unknown) =>
    vi.fn(async () => Response.json(results)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const setupEvent = () =>
    new Request("https://x/api/e", { method: "POST", body: JSON.stringify({ e: "setup", school: "mcmaster" }) });

  it("writes the counters to Redis in one pipeline", async () => {
    const env = { KV_REST_API_URL: "https://redis.test", KV_REST_API_TOKEN: "t" };
    const fetchImpl = redis([{ result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }]);
    const res = await handle(new Request("https://x/api/e", { method: "POST", body: JSON.stringify({ e: "setup", school: "mcmaster" }) }), env, fetchImpl);
    expect(res.status).toBe(204);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://redis.test/pipeline");
    expect(JSON.parse(String(init.body))).toHaveLength(5);
  });

  it("reports a failure when Redis rejects a command inside a 200 response", async () => {
    const env = { KV_REST_API_URL: "https://redis.test", KV_REST_API_TOKEN: "t" };
    const fetchImpl = redis([{ result: 1 }, { error: "ERR wrong type" }, { result: 1 }, { result: 1 }]);
    expect((await handle(setupEvent(), env, fetchImpl)).status).toBe(502);
  });

  it("answers 503 when Redis isn't connected", async () => {
    expect((await handle(setupEvent(), {}, ok())).status).toBe(503);
  });
});
