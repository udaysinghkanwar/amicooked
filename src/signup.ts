import * as fs from "fs";
import * as path from "path";
import { homeDir } from "./config.js";
import { VERSION } from "./version.js";

/** Optional update-email list; see site/api/signup.js. Unlike telemetry, the student typing an email is the opt-in. */
export const SIGNUP_URL = "https://amicooked-mcp.vercel.app/api/signup";
export const PRIVACY_URL = "https://amicooked-mcp.vercel.app/privacy";

/** Id of the prompt wording below. Change it with the wording and add it to CONSENT_VERSIONS in site/api/signup.js. */
export const CONSENT_VERSION = "2026-11-26-prompt";
export const PROMPT = "Enter your email to stay up to date (or N/A):";

const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const SKIP = new Set(["", "n/a", "na", "n", "no", "none", "skip"]);

/** Ontario school boards run on the provincial Brightspace; students there may be minors, so they're never asked. */
export function isSchoolK12(school: { host: string }): boolean {
  return /(^|\.)(elearningontario|apprentissageelectroniqueontario)\.ca$/i.test(school.host);
}

export function parseEmailAnswer(answer: string | undefined): { skip: true } | { email: string } | { invalid: true } {
  const value = (answer ?? "").trim().toLowerCase();
  if (SKIP.has(value)) return { skip: true };
  return value.length <= 254 && EMAIL.test(value) ? { email: value } : { invalid: true };
}

interface SubmitOptions {
  fetchImpl?: typeof fetch;
  version?: string;
}

/** True only when the server stored it. */
export async function submitSignup(email: string, { fetchImpl = fetch, version = VERSION }: SubmitOptions = {}): Promise<boolean> {
  try {
    const res = await fetchImpl(SIGNUP_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, consent: CONSENT_VERSION, version }),
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

export type SignupOutcome = "saved" | "skipped" | "failed" | "already-asked" | "not-asked";

interface AskOptions extends SubmitOptions {
  /** Shows the prompt; returns undefined when the student cancels. */
  prompt: (message: string) => Promise<string | undefined>;
  say: (message: string) => void;
}

/** Asks once per computer. A failed save leaves no marker, so the next setup asks again. */
export async function askForEmail(school: { host: string }, options: AskOptions): Promise<SignupOutcome> {
  if (isSchoolK12(school)) return "not-asked";
  const marker = path.join(homeDir(), "signup-asked");
  if (fs.existsSync(marker)) return "already-asked";
  const remember = () => {
    try {
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, "");
    } catch {
      // Asking again next setup is harmless
    }
  };

  while (true) {
    const answer = parseEmailAnswer(await options.prompt(PROMPT));
    if ("skip" in answer) {
      remember();
      return "skipped";
    }
    if ("invalid" in answer) {
      options.say("That doesn't look like an email address. Try again, or enter N/A to skip.");
      continue;
    }
    if (await submitSignup(answer.email, options)) {
      remember();
      options.say("Saved. Thanks!");
      return "saved";
    }
    options.say("Couldn't save your email right now. Nothing was stored. Run `amicooked setup` again later to retry.");
    return "failed";
  }
}
