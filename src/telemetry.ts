import * as fs from "fs";
import * as path from "path";
import { homeDir } from "./config.js";
import { findPreset } from "./schools.js";

/** Anonymous setup/upgrade counters; see site/api/e.js. */
export const REPORT_URL = "https://amicooked-mcp.vercel.app/api/e";

export function telemetryOff(env: NodeJS.ProcessEnv = process.env): boolean {
  const on = (v?: string) => Boolean(v) && v !== "0" && v !== "false";
  return on(env.AMICOOKED_NO_TELEMETRY) || on(env.DO_NOT_TRACK);
}

interface ReportOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  platform?: string;
}

/** Shared bounded, opt-out-aware delivery; telemetry must never make setup/update fail. */
async function send(event: Record<string, string>, options: ReportOptions): Promise<boolean> {
  const { env = process.env, fetchImpl = fetch, platform = `${process.platform}-${process.arch}` } = options;
  if (telemetryOff(env)) return false;
  try {
    const res = await fetchImpl(REPORT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...event, platform }),
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** First successful setup per computer; only a preset id (never the school's host) is sent. */
export async function reportSetup(schoolId: string, options: ReportOptions = {}): Promise<boolean> {
  const marker = path.join(homeDir(), "setup-reported");
  if (fs.existsSync(marker)) return false;
  try {
    if (!await send({ e: "setup", school: findPreset(schoolId)?.id ?? "custom" }, options)) return false;
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, "");
    return true;
  } catch {
    return false;
  }
}

/** Best-effort count after a successful version change; no account, school or install identifier. */
export function reportUpgrade(event: {
  from: string; to: string; mode: "manual" | "automatic"; channel: "native" | "npm";
}, options: ReportOptions = {}): Promise<boolean> {
  return send({ e: "upgrade", ...event }, options);
}
