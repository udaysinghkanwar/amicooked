import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "node:crypto";
import { homeDir } from "./config.js";
import { VERSION } from "./version.js";
import { telemetryOff } from "./telemetry.js";
import { acquireLock } from "./lock.js";

/** Optional update-email signups and separate anonymous N/A events; see site/api/signup.js. */
export const SIGNUP_URL = "https://amicooked-mcp.vercel.app/api/signup";
export const PRIVACY_URL = "https://amicooked-mcp.vercel.app/privacy";

/** Identifies this prompt/response flow; keep the accepted versions in site/api/signup.js in sync. */
export const CONSENT_VERSION = "2026-11-26-anonymous";
export const PROMPT = "Enter your email to stay up to date (or N/A):";

const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const ANONYMOUS = new Set(["n/a", "na"]);
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Ontario school boards run on the provincial Brightspace; students there may be minors, so they're never asked. */
export function isSchoolK12(school: { host: string }): boolean {
  return /(^|\.)(elearningontario|apprentissageelectroniqueontario)\.ca$/i.test(school.host);
}

export function parseEmailAnswer(answer: string | undefined): { skip: true } | { anonymous: true } | { email: string } | { invalid: true } {
  if (answer === undefined) return { skip: true };
  const value = answer.trim().toLowerCase();
  if (ANONYMOUS.has(value)) return { anonymous: true };
  return value.length <= 254 && EMAIL.test(value) ? { email: value } : { invalid: true };
}

interface SubmitOptions {
  fetchImpl?: typeof fetch;
  version?: string;
  env?: NodeJS.ProcessEnv;
}

async function postSignup(body: object, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(SIGNUP_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

/** True only when the server acknowledged it (including an already saved retry). */
export function submitSignup(email: string, { fetchImpl = fetch, version = VERSION }: SubmitOptions = {}): Promise<boolean> {
  return postSignup({ email, consent: CONSENT_VERSION, version }, fetchImpl);
}

export async function submitAnonymousSignup(eventId: string, { fetchImpl = fetch, version = VERSION, env }: SubmitOptions = {}): Promise<boolean> {
  if (telemetryOff(env)) return false;
  return postSignup({ kind: "anonymous", eventId, prompt: CONSENT_VERSION, version }, fetchImpl);
}

/** A pending submission ID, not an installation ID. Keep it until acknowledgement AND the completion marker. */
function anonymousSubmissionId(file: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(file, randomUUID(), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const id = fs.readFileSync(file, "utf8").trim();
  // Never replace an unreadable/corrupt ID and risk counting an acknowledged submission twice.
  if (!EVENT_ID.test(id)) throw new Error("Invalid pending anonymous signup");
  return id;
}

export type SignupOutcome = "saved" | "anonymous" | "skipped" | "failed" | "already-asked" | "not-asked";

interface AskOptions extends SubmitOptions {
  /** Shows the prompt; returns undefined when the student cancels. */
  prompt: (message: string) => Promise<string | undefined>;
  say: (message: string) => void;
}

/** Asks once per computer. A failed save leaves no marker, so the next setup asks again. */
export async function askForEmail(school: { host: string }, options: AskOptions): Promise<SignupOutcome> {
  if (isSchoolK12(school)) return "not-asked";
  const marker = path.join(homeDir(), "signup-asked");
  const pending = path.join(homeDir(), "signup-anonymous-pending");
  if (fs.existsSync(marker)) return "already-asked";
  const remember = () => {
    try {
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, "");
      return true;
    } catch {
      return false;
    }
  };
  const complete = () => {
    if (remember()) {
      try { fs.rmSync(pending, { force: true }); } catch { /* completion marker prevents any further submission */ }
    }
  };

  const reportFailure = (anonymous: boolean) => {
    options.say(anonymous
      ? "Couldn't confirm your anonymous signup."
      : "Couldn't confirm your subscription to email updates.");
    options.say("Am I Cooked is installed and configured. Follow any app reopening steps above.");
    options.say(anonymous
      ? "Run amicooked setup later to retry."
      : 'Run "amicooked setup" later to retry subscribing to email updates.');
  };

  while (true) {
    const answer = parseEmailAnswer(await options.prompt(PROMPT));
    if ("skip" in answer) {
      return "skipped";
    }
    if ("invalid" in answer) {
      options.say("That doesn't look like an email address. Try again, or enter N/A to skip.");
      continue;
    }
    let release: (() => void) | undefined;
    try {
      release = acquireLock(path.join(homeDir(), "signup-submit.lock"), "signup submission");
      // Another setup may have finished while this prompt was open.
      if (fs.existsSync(marker)) return "already-asked";
      if ("anonymous" in answer) {
        if (telemetryOff(options.env)) {
          complete();
          options.say("Continuing without email updates.");
          return "skipped";
        }
        let saved = false;
        try { saved = await submitAnonymousSignup(anonymousSubmissionId(pending), options); } catch { /* setup still finishes */ }
        if (saved) {
          complete();
          options.say("Continuing without email updates.");
          return "anonymous";
        }
        reportFailure(true);
        return "failed";
      }
      if (await submitSignup(answer.email, options)) {
        complete();
        options.say("Saved. Thanks!");
        return "saved";
      }
      reportFailure(false);
      return "failed";
    } catch {
      reportFailure("anonymous" in answer);
      return "failed";
    } finally {
      try { release?.(); } catch { /* optional signup cleanup must not fail installation */ }
    }
  }
}
