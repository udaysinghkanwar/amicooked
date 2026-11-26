import * as fs from "fs";
import { canShowWindow, openProfile, type Tab } from "./browser.js";
import { getConfig, getSchool, paths, writePrivateFile, type School } from "./config.js";
import { API_VERSIONS } from "./schools.js";

export interface Session {
  token: string;
  expiresAt: number;
  /** D2L cookies from the same login; /content/enforced/ file downloads need these, not the token. */
  cookies: string;
}

/** Thrown when a login window is open but the student hasn't finished signing in yet. */
export class LoginPendingError extends Error {
  constructor() {
    super("A login window for your school just opened on your computer. Sign in there, then ask again.");
    this.name = "LoginPendingError";
  }
}

// Refresh this long before the token actually expires
const EXPIRY_MARGIN_MS = 3 * 60 * 1000;
const SILENT_TIMEOUT_MS = 15000;
const INTERACTIVE_TIMEOUT_MS = 5 * 60 * 1000;
const COOKIE_SESSION_MS = 30 * 60 * 1000;
/** How long a tool call waits for an interactive login; MCP clients give up around 60s. */
export const IN_CALL_WAIT_MS = 40000;

type SavedSession = Session & { schoolHost?: string };
let session: SavedSession | null = null;

/**
 * Expiry time of a D2L access token. They're JWTs that live about an hour,
 * so read the real `exp` claim rather than assuming a lifetime.
 */
export function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch {
    // Not a JWT; fall through to a conservative default
  }
  return Date.now() + 50 * 60 * 1000;
}

function isFresh(s: SavedSession | null): s is SavedSession {
  return !!s && Date.now() < s.expiresAt - EXPIRY_MARGIN_MS &&
    (s.schoolHost === undefined || s.schoolHost === getConfig().school?.host);
}

/** A token another Am I Cooked process (Claude Desktop, the ChatGPT service) already saved. */
function readSavedSession(): SavedSession | null {
  try {
    return JSON.parse(fs.readFileSync(paths().token, "utf8"));
  } catch {
    return null;
  }
}

function saveSession(s: Session, school: School): void {
  session = { ...s, schoolHost: school.host };
  writePrivateFile(paths().token, JSON.stringify(session));
}

function isBrightspacePage(url: string, origin: string): boolean {
  try {
    const u = new URL(url);
    return u.origin === origin && u.pathname.startsWith("/d2l/") &&
      !u.pathname.startsWith("/d2l/login") && !u.pathname.startsWith("/d2l/lp/auth/");
  } catch {
    return false;
  }
}

export const WHOAMI_PATH = `/d2l/api/lp/${API_VERSIONS.lp}/users/whoami`;

type ApiHeaders = { Authorization: string } | { Cookie: string };

async function verifySession(origin: string, headers: ApiHeaders): Promise<boolean> {
  try {
    const response = await fetch(origin + WHOAMI_PATH, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    const user = await response.json();
    return typeof user?.Identifier === "string" && user.Identifier.length > 0;
  } catch {
    return false;
  }
}

/** Verify school access even when the dashboard never sends a Bearer request. */
async function captureSession(tab: Tab, school: School, timeoutMs: number): Promise<Session | null> {
  const origin = `https://${school.host}`;
  let token = "";
  let checkedToken = "";
  let nextCookieCheck = 0;
  tab.onRequest((url, headers) => {
    const auth = headers["Authorization"] ?? headers["authorization"];
    if (url.startsWith(origin + "/d2l/api/") && auth?.startsWith("Bearer ")) token = auth.slice(7);
  });
  await tab.goto(school.loginUrl ?? origin + "/d2l/home");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !tab.isClosed()) {
    const url = await tab.url().catch(() => "");
    if (isBrightspacePage(url, origin)) {
      if (token && token !== checkedToken) {
        checkedToken = token;
        const expiresAt = tokenExpiry(checkedToken);
        if (expiresAt > Date.now() + EXPIRY_MARGIN_MS &&
            await verifySession(origin, { Authorization: `Bearer ${checkedToken}` })) {
          const cookies = await tab.cookieHeader(origin).catch(() => "");
          return { token: checkedToken, expiresAt, cookies };
        }
      }
      if (Date.now() >= nextCookieCheck) {
        const cookies = await tab.cookieHeader(origin).catch(() => "");
        if (cookies && await verifySession(origin, { Cookie: cookies })) {
          return { token: "", expiresAt: Date.now() + COOKIE_SESSION_MS, cookies };
        }
        nextCookieCheck = Date.now() + 3000;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function attempt(school: School, headless: boolean, timeoutMs: number): Promise<Session | null> {
  const profile = await openProfile(headless, "about:blank");
  try {
    return await captureSession(profile.tab, school, timeoutMs);
  } finally {
    await profile.close().catch(() => {});
  }
}

/** How logins actually happen; swapped out in tests. */
export const driver = {
  silent: (school: School) => attempt(school, true, SILENT_TIMEOUT_MS),
  async interactive(school: School): Promise<Session | null> {
    if (!canShowWindow()) {
      throw new Error("Logging in needs a desktop session with a display. Run `amicooked login` from your desktop.");
    }
    return attempt(school, false, INTERACTIVE_TIMEOUT_MS);
  },
};

let silentInFlight: Promise<Session | null> | null = null;
let interactiveInFlight: Promise<Session> | null = null;

/** Open the login window, or join the one that's already open. Resolves once signed in. */
export function login(): Promise<Session> {
  if (!interactiveInFlight) {
    const school = getSchool();
    interactiveInFlight = driver
      .interactive(school)
      .then((s) => {
        if (!s) throw new Error("Could not verify your Brightspace login. Rerun setup and finish signing in in the browser it opens. If you can already see your courses and setup still stops here, report your school and this message.");
        saveSession(s, school);
        return s;
      })
      .finally(() => {
        interactiveInFlight = null;
      });
  }
  return interactiveInFlight;
}

/** Log in without showing anything, using the saved browser profile. */
async function silentLogin(): Promise<Session | null> {
  if (!silentInFlight) {
    const school = getSchool();
    silentInFlight = driver
      .silent(school)
      .then((s) => {
        if (s) saveSession(s, school);
        return s;
      })
      .finally(() => {
        silentInFlight = null;
      });
  }
  return silentInFlight;
}

async function getSession(): Promise<Session> {
  if (isFresh(session)) return session;
  const saved = readSavedSession();
  if (isFresh(saved)) return (session = saved);

  const silent = interactiveInFlight ? null : await silentLogin();
  if (silent) return silent;

  // The saved login expired: show the login window and give the student a moment to finish
  const pending = login();
  pending.catch(() => {}); // a later call reports the failure
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new LoginPendingError()), IN_CALL_WAIT_MS).unref());
  return Promise.race([pending, timeout]);
}

export async function getApiHeaders(): Promise<ApiHeaders> {
  const { token, cookies } = await getSession();
  return token ? { Authorization: `Bearer ${token}` } : { Cookie: cookies };
}

/** Cookie header for fetching D2L files directly. */
export async function getD2LCookies(): Promise<string> {
  return (await getSession()).cookies;
}

/** Forget the current token, e.g. after D2L rejects it with a 401. */
export function clearTokenCache(): void {
  session = null;
  fs.rmSync(paths().token, { force: true });
}

/** True if a login is already cached, i.e. D2L requests won't open a browser. */
export function hasActiveSession(): boolean {
  return isFresh(session) || isFresh(readSavedSession());
}
