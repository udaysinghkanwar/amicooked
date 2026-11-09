import * as fs from "fs";
import { canShowWindow, openProfile, type Tab } from "./browser.js";
import { getSchool, paths, writePrivateFile, type School } from "./config.js";

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
/** How long a tool call waits for an interactive login; MCP clients give up around 60s. */
export const IN_CALL_WAIT_MS = 40000;

let session: Session | null = null;

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

function isFresh(s: Session | null): s is Session {
  return !!s && Date.now() < s.expiresAt - EXPIRY_MARGIN_MS;
}

/** A token another Am I Cooked process (Claude Desktop, the ChatGPT service) already saved. */
function readSavedSession(): Session | null {
  try {
    return JSON.parse(fs.readFileSync(paths().token, "utf8"));
  } catch {
    return null;
  }
}

function saveSession(s: Session): void {
  session = s;
  writePrivateFile(paths().token, JSON.stringify(s));
}

function isSignedIn(url: string, school: School): boolean {
  try {
    const u = new URL(url);
    return u.host === school.host && u.pathname.startsWith("/d2l/") && !u.pathname.startsWith("/d2l/login");
  } catch {
    return false;
  }
}

/**
 * Watch one login attempt in `tab`, which opened on the school's login page: wait until
 * the browser is signed in to D2L and a page has made an authenticated API call.
 */
async function captureSession(tab: Tab, school: School, timeoutMs: number): Promise<Session | null> {
  let token = "";
  tab.onRequest((url, headers) => {
    const auth = headers["Authorization"] ?? headers["authorization"];
    if (url.includes("/d2l/api/") && auth?.startsWith("Bearer ")) token = auth.slice(7);
  });

  const deadline = Date.now() + timeoutMs;
  let visitedHome = false;
  while (Date.now() < deadline && !tab.isClosed() && !token) {
    const url = await tab.url().catch(() => "");
    if (isSignedIn(url, school) && !visitedHome) {
      // The home page's widgets call the API with a Bearer token we can capture
      visitedHome = true;
      if (!new URL(url).pathname.startsWith("/d2l/home")) await tab.goto(`https://${school.host}/d2l/home`).catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!token) return null;
  return { token, expiresAt: tokenExpiry(token), cookies: await tab.cookieHeader(`https://${school.host}`) };
}

const startUrl = (school: School) => school.loginUrl ?? `https://${school.host}/d2l/home`;

async function attempt(school: School, headless: boolean, timeoutMs: number): Promise<Session | null> {
  const profile = await openProfile(headless, startUrl(school));
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
        if (!s) throw new Error("Login timed out. Run `amicooked login` to try again.");
        saveSession(s);
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
    silentInFlight = driver
      .silent(getSchool())
      .then((s) => {
        if (s) saveSession(s);
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

export async function getToken(): Promise<string> {
  return (await getSession()).token;
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
