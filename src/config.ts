import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface School {
  id: string;
  name: string;
  /** What students call it, e.g. "Avenue to Learn". Used for folder names. */
  lmsName: string;
  /** The D2L API host, e.g. "avenue.cllmcmaster.ca". */
  host: string;
  /** Where login starts when it differs from https://<host>, e.g. an SSO portal. */
  loginUrl?: string;
}

export type BrowserChannel = "chrome" | "msedge" | "chromium";

export interface Config {
  version: 1;
  school?: School;
  browser?: BrowserChannel;
  filesDir: string;
  chatgpt?: { subdomain: string };
}

export function homeDir(): string {
  return process.env.AMICOOKED_HOME || path.join(os.homedir(), ".amicooked");
}

export function paths() {
  const home = homeDir();
  return {
    home,
    config: path.join(home, "config.json"),
    browser: path.join(home, "browser"),
    token: path.join(home, "token.json"),
    library: path.join(home, "library.json"),
    textCache: path.join(home, "text-cache"),
    oauth: path.join(home, "oauth.json"),
    tunnel: path.join(home, "tunnel.json"),
    bin: path.join(home, "bin"),
    logs: path.join(home, "logs"),
  };
}

function defaults(): Config {
  return { version: 1, filesDir: path.join(os.homedir(), "Downloads", "amicooked") };
}

let cached: Config | null = null;

function readFile(): Partial<Config> {
  try {
    return JSON.parse(fs.readFileSync(paths().config, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Couldn't read ${paths().config}: ${(error as Error).message}`);
  }
}

/** Config file merged over defaults, with D2L_HOST / D2L_LOGIN_URL env vars on top. */
export function getConfig(): Config {
  if (cached) return cached;
  const config: Config = { ...defaults(), ...readFile(), version: 1 };

  const host = process.env.D2L_HOST;
  if (host) {
    config.school = {
      ...(config.school?.host === host ? config.school : { id: "custom", name: host, lmsName: "D2L" }),
      host,
    };
  }
  if (process.env.D2L_LOGIN_URL && config.school) {
    config.school = { ...config.school, loginUrl: process.env.D2L_LOGIN_URL };
  }

  cached = config;
  return config;
}

export function reloadConfig(): Config {
  cached = null;
  return getConfig();
}

/** The configured school, or a clear error telling the student to run setup. */
export function getSchool(): School {
  const school = getConfig().school;
  if (!school) throw new Error("Am I Cooked isn't set up yet. Run `amicooked setup` first.");
  return school;
}

/** Write a file atomically with owner-only permissions. */
export function writePrivateFile(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function writeConfig(update: Partial<Config>): Config {
  const next = { ...defaults(), ...readFile(), ...update, version: 1 as const };
  writePrivateFile(paths().config, JSON.stringify(next, null, 2) + "\n");
  return reloadConfig();
}
