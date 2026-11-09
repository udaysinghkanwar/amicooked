import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { reloadConfig, writeConfig } from "../../src/config.js";
import { clearTokenCache, driver, getToken, IN_CALL_WAIT_MS, LoginPendingError, type Session } from "../../src/auth.js";

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
  vi.useRealTimers();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("getToken", () => {
  it("logs in silently and shares the token through token.json", async () => {
    const s = fresh();
    const silent = vi.spyOn(driver, "silent").mockResolvedValue(s);
    expect(await getToken()).toBe(s.token);
    expect(JSON.parse(fs.readFileSync(path.join(home, "token.json"), "utf8")).token).toBe(s.token);

    // A second process reads the saved token instead of opening a browser
    expect(await getToken()).toBe(s.token);
    expect(silent).toHaveBeenCalledTimes(1);
  });

  it("finishes the call when the student signs in within the wait", async () => {
    const s = fresh();
    vi.spyOn(driver, "silent").mockResolvedValue(null);
    vi.spyOn(driver, "interactive").mockImplementation(() => new Promise((r) => setTimeout(() => r(s), 50)));
    expect(await getToken()).toBe(s.token);
  });

  it("returns a 'sign in, then ask again' error instead of hanging", async () => {
    vi.useFakeTimers();
    vi.spyOn(driver, "silent").mockResolvedValue(null);
    const interactive = vi.spyOn(driver, "interactive").mockImplementation(() => new Promise(() => {}));

    const first = getToken();
    const second = getToken();
    const assertions = [expect(first).rejects.toBeInstanceOf(LoginPendingError), expect(second).rejects.toBeInstanceOf(LoginPendingError)];
    await vi.advanceTimersByTimeAsync(IN_CALL_WAIT_MS + 1);
    await Promise.all(assertions);
    // Both calls share one login window
    expect(interactive).toHaveBeenCalledTimes(1);
  });
});
