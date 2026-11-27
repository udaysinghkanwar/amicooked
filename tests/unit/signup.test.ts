import * as fs from "fs";
import { randomUUID } from "node:crypto";
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
  const anonymous = new Map<string, string>();
  const calls: unknown[][][] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const commands = JSON.parse(String(init.body)) as string[][];
    calls.push(commands);
    return Response.json(commands.map(([cmd, key, field, value]) => {
      if (cmd === "INCR") { counters.set(key, (counters.get(key) ?? 0) + 1); return { result: counters.get(key) }; }
      if (cmd === "EXPIRE") return { result: 1 };
      if (cmd === "HSETNX") { const target = key === "signup:anonymous" ? anonymous : hash; if (target.has(field)) return { result: 0 }; target.set(field, value); return { result: 1 }; }
      return { error: "unknown" };
    }));
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, hash, anonymous, calls };
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
    vi.stubEnv("AMICOOKED_HOME", home);
    vi.stubEnv("DO_NOT_TRACK", "0");
    vi.stubEnv("AMICOOKED_NO_TELEMETRY", "0");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("accepts only N/A variants or an email; cancellation sends nothing", () => {
    for (const answer of ["n/a", "N/A", "NA", "na", " Na ", " n/A "]) expect(parseEmailAnswer(answer)).toEqual({ anonymous: true });
    for (const answer of ["", "  ", "no", "n", "none", "skip", "not-an-email", "me@", "me@mail", "@mail.com"]) expect(parseEmailAnswer(answer)).toEqual({ invalid: true });
    expect(parseEmailAnswer(undefined)).toEqual({ skip: true });
    expect(parseEmailAnswer(" Me@Mail.com ")).toEqual({ email: "me@mail.com" });
  });

  it.each(["N/A", "student@example.com"])("goes straight to the email prompt without a tracking banner (%s)", async answer => {
    const say = vi.fn();
    const prompt = vi.fn(async () => { expect(say).not.toHaveBeenCalled(); return answer; });
    const fetchImpl = (async () => new Response(null, { status: 204 })) as typeof fetch;
    await askForEmail({ host: "learn.uwaterloo.ca" }, { prompt, say, fetchImpl });
    expect(say.mock.calls).toEqual([[answer === "N/A" ? "Continuing without email updates." : "Saved. Thanks!"]]);
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

  it.each([
    ["me@mail.com", "Couldn't confirm your subscription to email updates.", 'Run "amicooked setup" later to retry subscribing to email updates.'],
    ["N/A", "Couldn't confirm your anonymous signup.", "Run amicooked setup later to retry."],
  ])("explains that optional signup failure leaves installation configured (%s)", async (answer, problem, retry) => {
    const say = vi.fn();
    const fetchImpl = (async () => new Response(null, { status: 502 })) as typeof fetch;
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, { prompt: async () => answer, say, fetchImpl })).toBe("failed");
    expect(say.mock.calls.map(([message]) => message)).toEqual([
      problem,
      "Am I Cooked is installed and configured. Follow any app reopening steps above.",
      retry,
    ]);
    expect(fs.existsSync(path.join(home, "signup-asked"))).toBe(false);
  });

  it("re-asks after invalid entries, records N/A separately and remembers acknowledgement", async () => {
    const answers = ["oops", "", "N/A"];
    const prompt = vi.fn(async () => answers.shift());
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, { prompt, say: vi.fn(), fetchImpl })).toBe("anonymous");
    expect(prompt).toHaveBeenCalledTimes(3);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    expect(body).toMatchObject({ kind: "anonymous", prompt: CONSENT_VERSION, eventId: expect.any(String) });
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("consent");
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, { prompt, say: vi.fn(), fetchImpl })).toBe("already-asked");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses the same persisted ID after a lost acknowledgement, without overwriting the first timestamp", async () => {
    const redis = fakeRedis();
    const bodies: object[] = [];
    let attempt = 0;
    const fetchImpl = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      const response = await handle(post(bodies.at(-1)), env, redis.fetchImpl,
        new Date(attempt++ === 0 ? "2026-11-26T12:00:00Z" : "2026-11-26T12:05:00Z"));
      if (attempt === 1) throw new Error("Response lost after commit");
      return response;
    }) as unknown as typeof fetch;
    const options = { prompt: async () => "N/A", say: vi.fn(), fetchImpl, version: "0.1.23" };
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, options)).toBe("failed");
    expect(fs.existsSync(path.join(home, "signup-asked"))).toBe(false);
    expect(fs.existsSync(path.join(home, "signup-anonymous-pending"))).toBe(true);
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, options)).toBe("anonymous");
    expect(bodies[0]).toEqual(bodies[1]);
    expect(redis.anonymous.size).toBe(1);
    expect(redis.hash.size).toBe(0);
    expect(JSON.parse([...redis.anonymous.values()][0])).toEqual({ at: "2026-11-26T12:00:00.000Z", src: "cli-setup", v: "0.1.23" });
    expect(fs.existsSync(path.join(home, "signup-anonymous-pending"))).toBe(false);
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, options)).toBe("already-asked");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retains the ID when the server acknowledged but writing the local completion marker fails", async () => {
    const redis = fakeRedis(); let attempt = 0;
    const fetchImpl = (async (_url, init) => {
      const response = await handle(post(JSON.parse(String(init?.body))), env, redis.fetchImpl);
      if (++attempt === 1) fs.mkdirSync(path.join(home, "signup-asked"));
      return response;
    }) as typeof fetch;
    const options = { prompt: async () => "NA", say: vi.fn(), fetchImpl };
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, options)).toBe("anonymous");
    expect(fs.existsSync(path.join(home, "signup-anonymous-pending"))).toBe(true);
    fs.rmdirSync(path.join(home, "signup-asked"));
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, options)).toBe("anonymous");
    expect(redis.anonymous.size).toBe(1);
  });

  it("does not send a second event when another setup finishes while a prompt is open", async () => {
    const redis = fakeRedis(); let answerLater: (answer: string) => void;
    const fetchImpl = (async (_url, init) => handle(post(JSON.parse(String(init?.body))), env, redis.fetchImpl)) as typeof fetch;
    const waiting = askForEmail({ host: "learn.uwaterloo.ca" }, { prompt: () => new Promise(resolve => { answerLater = resolve; }), say: vi.fn(), fetchImpl });
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, { prompt: async () => "NA", say: vi.fn(), fetchImpl })).toBe("anonymous");
    answerLater!("N/A");
    expect(await waiting).toBe("already-asked");
    expect(redis.anonymous.size).toBe(1);
  });

  it.each(["DO_NOT_TRACK", "AMICOOKED_NO_TELEMETRY"])("respects %s for anonymous events, while email remains explicit opt-in", async key => {
    vi.stubEnv(key, "1");
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const options = { prompt: async () => "NA", say: vi.fn(), fetchImpl };
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, options)).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(home, "signup-anonymous-pending"))).toBe(false);
    expect(await submitSignup("person@example.com", { fetchImpl })).toBe(true);
  });

  it("does not record cancellation or mark it as an accepted response", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, { prompt: async () => undefined, say: vi.fn(), fetchImpl })).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(home, "signup-asked"))).toBe(false);
  });

  it("never rotates a corrupt pending ID and risks a second event", async () => {
    fs.writeFileSync(path.join(home, "signup-anonymous-pending"), "corrupt");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await askForEmail({ host: "learn.uwaterloo.ca" }, { prompt: async () => "NA", say: vi.fn(), fetchImpl })).toBe("failed");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(home, "signup-anonymous-pending"), "utf8")).toBe("corrupt");
  });
});

// Each HSETNX below is the backend's existing atomic primitive, now in a separate event hash.
describe("anonymous signup storage", () => {
  const anonymous = (eventId = randomUUID()) => ({ kind: "anonymous", eventId, prompt: CONSENT_VERSION, version: "0.1.23" });
  it("keeps distinct submissions and concurrent retries separate from the email list", async () => {
    const redis = fakeRedis();
    const body = anonymous();
    const replies = await Promise.all([handle(post(body), env, redis.fetchImpl), handle(post(body), env, redis.fetchImpl)]);
    expect(replies.map(r => r.status)).toEqual([204, 204]);
    expect(redis.anonymous.size).toBe(1);
    expect((await handle(post(anonymous()), env, redis.fetchImpl)).status).toBe(204);
    expect(redis.anonymous.size).toBe(2);
    expect(redis.hash.size).toBe(0);
    expect(JSON.stringify([...redis.anonymous.values()])).not.toMatch(/email|consent|1\.2\.3\.4/);
  });

  it("normalizes UUID case so a replay cannot count twice", async () => {
    const redis = fakeRedis(); const body = anonymous();
    await handle(post(body), env, redis.fetchImpl);
    await handle(post({ ...body, eventId: body.eventId.toUpperCase() }), env, redis.fetchImpl);
    expect(redis.anonymous.size).toBe(1);
  });

  it("rejects malformed or mixed anonymous requests before touching Redis", async () => {
    const redis = fakeRedis(); const body = anonymous();
    for (const invalid of [{ ...body, eventId: "bad" }, { ...body, eventId: undefined },
      { ...body, prompt: "unknown" }, { ...body, email: "person@example.com" }, { ...body, consent: CONSENT_VERSION },
      { ...body, kind: "unknown" }]) {
      expect((await handle(post(invalid), env, redis.fetchImpl)).status).toBe(400);
    }
    expect(redis.calls).toEqual([]);
  });

  it("retains legacy email-client compatibility", async () => {
    const redis = fakeRedis();
    expect((await handle(post({ email: "legacy@example.com", consent: "2026-11-26-prompt", version: "0.1.23" }), env, redis.fetchImpl)).status).toBe(204);
    expect(redis.hash.size).toBe(1);
    expect(redis.anonymous.size).toBe(0);
  });

  it("applies rate limits and storage failures to anonymous writes too", async () => {
    const redis = fakeRedis();
    for (let i = 0; i < MAX_PER_IP_PER_DAY; i++) expect((await handle(post(anonymous()), env, redis.fetchImpl)).status).toBe(204);
    expect((await handle(post(anonymous()), env, redis.fetchImpl)).status).toBe(429);
    expect(redis.anonymous.size).toBe(MAX_PER_IP_PER_DAY);
    expect((await handle(post(anonymous()), {}, redis.fetchImpl)).status).toBe(503);
    expect((await handle(post(anonymous()), env, async () => { throw new Error("offline"); })).status).toBe(502);
  });
});
