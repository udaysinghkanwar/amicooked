import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRESETS } from "../../src/schools.js";
import { REPORT_URL, reportSetup, telemetryOff } from "../../src/telemetry.js";
// @ts-expect-error plain JS Vercel function
import { commandsFor, PLATFORMS, POST, SCHOOLS } from "../../site/api/e.js";

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
    ]);
    expect(PLATFORMS).toContain("darwin-arm64");
  });

  it("buckets unknown values instead of storing them", () => {
    const commands = commandsFor({ e: "setup", school: "learn.example.edu", platform: "plan9" });
    expect(commands[2][2]).toBe("custom");
    expect(commands[3][2]).toBe("other");
  });

  it("rejects anything that isn't a setup event", async () => {
    expect(commandsFor({ e: "grades" })).toBeNull();
    const env = { KV_REST_API_URL: "https://redis.test", KV_REST_API_TOKEN: "t" };
    const fetchImpl = ok();
    const bad = await POST(new Request("https://x/api/e", { method: "POST", body: "not json" }), env, fetchImpl);
    expect(bad.status).toBe(400);
    const big = await POST(new Request("https://x/api/e", { method: "POST", body: "x".repeat(600) }), env, fetchImpl);
    expect(big.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("writes the counters to Redis in one pipeline", async () => {
    const env = { KV_REST_API_URL: "https://redis.test", KV_REST_API_TOKEN: "t" };
    const fetchImpl = ok();
    const res = await POST(new Request("https://x/api/e", { method: "POST", body: JSON.stringify({ e: "setup", school: "mcmaster" }) }), env, fetchImpl);
    expect(res.status).toBe(204);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://redis.test/pipeline");
    expect(JSON.parse(String(init.body))).toHaveLength(4);
  });
});
