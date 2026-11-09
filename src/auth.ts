import * as fs from "fs";
import type { BrowserContext } from "playwright-core";
import { canShowWindow, openProfile } from "./browser.js";
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
 * Drive one login attempt in `context`: start at the school's login page and wait until
 * the browser is signed in to D2L and a page has made an authenticated API call.
 */
async function captureSession(context: BrowserContext, school: School, timeoutMs: number): Promise<Session | null> {
  const page = context.pages()[0] ?? (await context.newPage());
  let token = "";
  const onRequest = (request: { url(): string; headers(): Record<string, string> }) => {
    const auth = request.headers()["authorization"];
    if (request.url().includes("/d2l/api/") && auth?.startsWith("Bearer ")) token = auth.slice(7);
  };
  page.on("request", onRequest);

  const deadline = Date.now() + timeoutMs;
  try {
    await page.goto(school.loginUrl ?? `https://${school.host}/d2l/home`, { waitUntil: "domcontentloaded" }).catch(() => {});
    let visitedHome = false;
    while (Date.now() < deadline && !page.isClosed()) {
      if (token) break;
      if (isSignedIn(page.url(), school) && !visitedHome) {
        // The home page's widgets call the API with a Bearer token we can capture
        visitedHome = true;
        if (!new URL(page.url()).pathname.startsWith("/d2l/home")) {
          await page.goto(`https://${school.host}/d2l/home`, { waitUntil: "domcontentloaded" }).catch(() => {});
        }
      }
      await page.waitForTimeout(500).catch(() => {});
    }
    if (!token) return null;
    const cookies = (await context.cookies(`https://${school.host}`)).map((c) => `${c.name}=${c.value}`).join("; ");
    return { token, expiresAt: tokenExpiry(token), cookies };
  } finally {
    if (!page.isClosed()) page.off("request", onRequest);
  }
}

/** How logins actually happen; swapped out in tests. */
export const driver = {
  async silent(school: School): Promise<Session | null> {
    const context = await openProfile(true);
    try {
      return await captureSession(context, school, SILENT_TIMEOUT_MS);
    } finally {
      await context.close().catch(() => {});
    }
  },
  async interactive(school: School): Promise<Session | null> {
    if (!canShowWindow()) {
      throw new Error("Logging in needs a desktop session with a display. Run `amicooked login` from your desktop.");
    }
    const context = await openProfile(false);
    try {
      return await captureSession(context, school, INTERACTIVE_TIMEOUT_MS);
    } finally {
      await context.close().catch(() => {});
    }
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
