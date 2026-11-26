import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JS Vercel function
import { CONSENT_VERSIONS, handle, MAX_PER_IP_PER_DAY, normalizeEmail } from "../../site/api/signup.js";
import { CONSENT_VERSION, SIGNUP_URL, askForEmail, isSchoolK12, parseEmailAnswer, submitSignup } from "../../src/signup.js";

const env = { KV_REST_API_URL: "https://redis.example", KV_REST_API_TOKEN: "t", SIGNUP_SALT: "salt" };

/** Fake Upstash /pipeline that keeps state across calls. */
function fakeRedis() {
  const counters = new Map<string, number>();
  const hash = new Map<string, string>();
  const calls: unknown[][][] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const commands = JSON.parse(String(init.body)) as string[][];
    calls.push(commands);
    return Response.json(commands.map(([cmd, key, field, value]) => {
      if (cmd === "INCR") { counters.set(key, (counters.get(key) ?? 0) + 1); return { result: counters.get(key) }; }
      if (cmd === "EXPIRE") return { result: 1 };
      if (cmd === "HSETNX") { if (hash.has(field)) return { result: 0 }; hash.set(field, value); return { result: 1 }; }
      return { error: "unknown" };
    }));
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, hash, calls };
}

const post = (body: unknown, ip = "1.2.3.4") =>
  new Request("https://x/api/signup", { method: "POST", headers: { "x-forwarded-for": ip }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("site/api/signup.js", () => {
  it("stores a normalized email with its consent record", async () => {
    const redis = fakeRedis();
    const now = new Date("2026-11-26T12:00:00Z");
    const res = await handle(post({ email: "  Student@Example.CA ", consent: CONSENT_VERSION, version: "0.1.19" }), env, redis.fetchImpl, now);
    expect(res.status).toBe(204);
    expect(JSON.parse(redis.hash.get("student@example.ca")!)).toEqual({ at: now.toISOString(), src: "cli-setup", consent: CONSENT_VERSION, v: "0.1.19" });
  });

  it("never stores the raw IP and keeps the first record on a repeat signup", async () => {
    const redis = fakeRedis();
    await handle(post({ email: "a@b.ca", consent: CONSENT_VERSION }), env, redis.fetchImpl, new Date("2026-11-26T00:00:00Z"));
    const again = await handle(post({ email: "a@b.ca", consent: CONSENT_VERSION }), env, redis.fetchImpl, new Date("2026-11-27T00:00:00Z"));
    expect(again.status).toBe(204);
    expect(JSON.parse(redis.hash.get("a@b.ca")!).at).toBe("2026-11-26T00:00:00.000Z");
    expect(JSON.stringify(redis.calls)).not.toContain("1.2.3.4");
  });

  it("rate limits per IP per day without writing", async () => {
    const redis = fakeRedis();
    for (let i = 0; i < MAX_PER_IP_PER_DAY; i++) {
      expect((await handle(post({ email: `s${i}@b.ca`, consent: CONSENT_VERSION }), env, redis.fetchImpl)).status).toBe(204);
    }
    expect((await handle(post({ email: "late@b.ca", consent: CONSENT_VERSION }), env, redis.fetchImpl)).status).toBe(429);
    expect(redis.hash.has("late@b.ca")).toBe(false);
    expect((await handle(post({ email: "other@b.ca", consent: CONSENT_VERSION }, "5.6.7.8"), env, redis.fetchImpl)).status).toBe(204);
  });

  it("rejects bad input, unknown consent wording and oversized bodies", async () => {
    const redis = fakeRedis();
    expect((await handle(post("not json"), env, redis.fetchImpl)).status).toBe(400);
    expect((await handle(post({ email: "nope", consent: CONSENT_VERSION }), env, redis.fetchImpl)).status).toBe(400);
    expect((await handle(post({ email: "a@b.ca" }), env, redis.fetchImpl)).status).toBe(400);
    expect((await handle(post({ email: "a@b.ca", consent: "made-up" }), env, redis.fetchImpl)).status).toBe(400);
    expect((await handle(post("x".repeat(600)), env, redis.fetchImpl)).status).toBe(413);
    expect(redis.calls).toHaveLength(0);
  });

  it("reports missing config and Redis failures instead of claiming success", async () => {
    const redis = fakeRedis();
    expect((await handle(post({ email: "a@b.ca", consent: CONSENT_VERSION }), { ...env, SIGNUP_SALT: undefined }, redis.fetchImpl)).status).toBe(503);
    const failing = (async () => Response.json([{ error: "OOM" }, { result: 1 }])) as unknown as typeof fetch;
    expect((await handle(post({ email: "a@b.ca", consent: CONSENT_VERSION }), env, failing)).status).toBe(502);
    const offline = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect((await handle(post({ email: "a@b.ca", consent: CONSENT_VERSION }), env, offline)).status).toBe(502);
  });

  it("knows the CLI's consent wording and validates like the CLI", () => {
    expect(CONSENT_VERSIONS).toContain(CONSENT_VERSION);
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail(`${"a".repeat(250)}@b.ca`)).toBeNull();
    expect(normalizeEmail("A@B.CA")).toBe("a@b.ca");
  });
});

describe("CLI signup", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-signup-"));
    process.env.AMICOOKED_HOME = home;
  });
  afterEach(() => {
    delete process.env.AMICOOKED_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("treats blank, N/A and cancel as a skip", () => {
    for (const answer of ["", "  ", "n/a", "N/A", "na", "no", "n", undefined]) expect(parseEmailAnswer(answer)).toEqual({ skip: true });
    expect(parseEmailAnswer(" Me@Mail.com ")).toEqual({ email: "me@mail.com" });
    expect(parseEmailAnswer("not-an-email")).toEqual({ invalid: true });
  });

  it("recognizes K-12 boards by their provincial Brightspace host", () => {
    expect(isSchoolK12({ host: "tdsb.elearningontario.ca" })).toBe(true);
    expect(isSchoolK12({ host: "csv.apprentissageelectroniqueontario.ca" })).toBe(true);
    expect(isSchoolK12({ host: "avenue.cllmcmaster.ca" })).toBe(false);
  });

  it("posts the email with the consent version and reports the outcome", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    expect(await submitSignup("me@mail.com", { fetchImpl, version: "0.1.19" })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SIGNUP_URL);
    expect(JSON.parse(String(init.body))).toEqual({ email: "me@mail.com", consent: CONSENT_VERSION, version: "0.1.19" });
    expect(await submitSignup("me@mail.com", { fetchImpl: (async () => new Response(null, { status: 502 })) as unknown as typeof fetch })).toBe(false);
    expect(await submitSignup("me@mail.com", { fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch })).toBe(false);
  });

  it("asks once per computer, and asks again only after a failed save", async () => {
    const answers = ["me@mail.com"];
    const prompt = vi.fn(async () => answers.shift());
    const say = vi.fn();
    const failing = (async () => new Response(null, { status: 502 })) as unknown as typeof fetch;
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, { prompt, say, fetchImpl: failing })).toBe("failed");
    answers.push("me@mail.com");
    const ok = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, { prompt, say, fetchImpl: ok })).toBe("saved");
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, { prompt, say, fetchImpl: ok })).toBe("already-asked");
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("never asks K-12 students", async () => {
    const prompt = vi.fn();
    expect(await askForEmail({ host: "pdsb.elearningontario.ca" }, { prompt, say: vi.fn() })).toBe("not-asked");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("re-asks after an invalid entry, and remembers a skip", async () => {
    const answers = ["oops", "N/A"];
    const prompt = vi.fn(async () => answers.shift());
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, { prompt, say: vi.fn(), fetchImpl })).toBe("skipped");
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, { prompt, say: vi.fn(), fetchImpl })).toBe("already-asked");
  });
});
