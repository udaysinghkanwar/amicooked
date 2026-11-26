import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getSchool, reloadConfig, writeConfig } from "../../src/config.js";
import { clearTokenCache, driver, getApiHeaders, hasActiveSession, IN_CALL_WAIT_MS, LoginPendingError, WHOAMI_PATH, type Session } from "../../src/auth.js";

import { openProfile } from "../../src/browser.js";
import { D2LClient } from "../../src/client.js";

vi.mock("../../src/browser.js", () => ({ openProfile: vi.fn(), canShowWindow: () => true }));

let home: string;

function jwt(expSeconds: number): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ exp: expSeconds })}.sig`;
}

const fresh = (): Session => ({ token: jwt(Math.floor(Date.now() / 1000) + 3600), expiresAt: Date.now() + 3600_000, cookies: "a=b" });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-"));
  process.env.AMICOOKED_HOME = home;
  reloadConfig();
  writeConfig({ school: { id: "test", name: "Test", lmsName: "D2L", host: "d2l.example.edu" } });
  clearTokenCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("getApiHeaders", () => {
  it("logs in silently and shares the token through token.json", async () => {
    const s = fresh();
    const silent = vi.spyOn(driver, "silent").mockResolvedValue(s);
    expect(await getApiHeaders()).toEqual({ Authorization: `Bearer ${s.token}` });
    expect(JSON.parse(fs.readFileSync(path.join(home, "token.json"), "utf8")).token).toBe(s.token);

    // A second process reads the saved token instead of opening a browser
    expect(await getApiHeaders()).toEqual({ Authorization: `Bearer ${s.token}` });
    expect(silent).toHaveBeenCalledTimes(1);
  });

  it("keeps a verified login scoped to the school it was obtained for", async () => {
    vi.spyOn(driver, "silent").mockResolvedValue(fresh());
    await getApiHeaders();
    expect(hasActiveSession()).toBe(true);
    writeConfig({ school: { id: "other", name: "Other school", lmsName: "D2L", host: "d2l.other.edu" } });
    expect(hasActiveSession()).toBe(false);
  });

  it("finishes the call when the student signs in within the wait", async () => {
    const s = fresh();
    vi.spyOn(driver, "silent").mockResolvedValue(null);
    vi.spyOn(driver, "interactive").mockImplementation(() => new Promise((r) => setTimeout(() => r(s), 50)));
    expect(await getApiHeaders()).toEqual({ Authorization: `Bearer ${s.token}` });
  });

  it("returns a 'sign in, then ask again' error instead of hanging", async () => {
    vi.useFakeTimers();
    vi.spyOn(driver, "silent").mockResolvedValue(null);
    let finishLogin!: (session: Session | null) => void;
    const interactive = vi.spyOn(driver, "interactive").mockImplementation(() => new Promise((resolve) => { finishLogin = resolve; }));

    const first = getApiHeaders();
    const second = getApiHeaders();
    const assertions = [expect(first).rejects.toBeInstanceOf(LoginPendingError), expect(second).rejects.toBeInstanceOf(LoginPendingError)];
    await vi.advanceTimersByTimeAsync(IN_CALL_WAIT_MS + 1);
    await Promise.all(assertions);
    // Both calls share one login window
    expect(interactive).toHaveBeenCalledTimes(1);
    finishLogin(null);
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("Brightspace login verification", () => {
  const origin = "https://learn.uwaterloo.ca";
  const identity = () => Response.json({ Identifier: "123" });

  function browser(cookies: string, request?: { url: string; token: string }) {
    let onRequest: (url: string, headers: Record<string, string>) => void;
    const profile = {
      close: vi.fn(async () => {}),
      tab: {
        url: vi.fn(async () => origin + "/d2l/home"),
        goto: vi.fn(async () => {
          if (request) onRequest(request.url, { authorization: `Bearer ${request.token}` });
        }),
        onRequest: vi.fn((listener) => { onRequest = listener; }),
        cookieHeader: vi.fn(async () => cookies),
        isClosed: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
      },
    };
    vi.mocked(openProfile).mockResolvedValue(profile);
    return profile;
  }

  beforeEach(() => {
    writeConfig({ school: { id: "waterloo", name: "Waterloo", host: "learn.uwaterloo.ca", lmsName: "LEARN" } });
  });

  it("uses a verified browser session to read enrollments with no Bearer request", async () => {
    const profile = browser("session=example");
    const fetch = vi.fn().mockResolvedValueOnce(identity()).mockResolvedValueOnce(Response.json({ Items: [] }));
    vi.stubGlobal("fetch", fetch);
    await expect(new D2LClient().getMyEnrollments()).resolves.toEqual({ Items: [] });
    expect(openProfile).toHaveBeenCalledWith(true, "about:blank");
    expect(profile.tab.goto).toHaveBeenCalledWith(origin + "/d2l/home");
    expect(profile.close).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenNthCalledWith(1, origin + WHOAMI_PATH, expect.objectContaining({
      headers: { Cookie: "session=example" }, redirect: "manual",
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining("/enrollments/myenrollments/"), expect.objectContaining({
      headers: { Cookie: "session=example" }, redirect: "manual",
    }));
  });

  it("captures a Bearer request during the initial navigation", async () => {
    const { token } = fresh();
    browser("session=example", { url: origin + WHOAMI_PATH, token });
    const fetch = vi.fn().mockResolvedValueOnce(identity());
    vi.stubGlobal("fetch", fetch);
    await expect(driver.silent(getSchool())).resolves.toMatchObject({ token });
    expect(fetch).toHaveBeenCalledWith(origin + WHOAMI_PATH, expect.objectContaining({
      headers: { Authorization: `Bearer ${token}` },
    }));
  });

  it("does not reopen login for an unreleased grade when the cookie session is valid", async () => {
    const session = { ...fresh(), token: "" };
    const silent = vi.spyOn(driver, "silent").mockResolvedValue(session);
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(identity());
    vi.stubGlobal("fetch", fetch);
    await expect(new D2LClient().getMyFinalGrade(123)).rejects.toMatchObject({ status: 403 });
    expect(silent).toHaveBeenCalledOnce();
    expect(hasActiveSession()).toBe(true);
  });

  it("refreshes a rejected cookie session and retries the read once", async () => {
    const expired = { ...fresh(), token: "", cookies: "session=expired" };
    const replacement = { ...expired, cookies: "session=current" };
    const silent = vi.spyOn(driver, "silent").mockResolvedValueOnce(expired).mockResolvedValueOnce(replacement);
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 })).mockResolvedValueOnce(identity());
    vi.stubGlobal("fetch", fetch);
    await expect(new D2LClient().whoami()).resolves.toEqual({ Identifier: "123" });
    expect(silent).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(origin + WHOAMI_PATH, expect.objectContaining({
      headers: { Cookie: replacement.cookies },
    }));
  });

  it.each([
    ["403", () => new Response(null, { status: 403 })],
    ["redirect", () => Response.redirect(origin + "/d2l/login")],
    ["login HTML", () => new Response("<html>Sign in</html>")],
  ] as const)("leaves setup unverified when whoami returns %s", async (_label, response) => {
    vi.useFakeTimers();
    browser("session=example", { url: "https://other.example.edu" + WHOAMI_PATH, token: fresh().token });
    const fetch = vi.fn().mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetch);
    const result = driver.silent(getSchool());
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(origin + WHOAMI_PATH, expect.objectContaining({
      headers: { Cookie: "session=example" },
    }));
    expect(hasActiveSession()).toBe(false);
  });
});
