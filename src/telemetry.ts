import * as fs from "fs";
import * as path from "path";
import { homeDir } from "./config.js";
import { findPreset } from "./schools.js";

/** Counts finished setups; see site/api/e.js. */
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

/**
 * Sends one anonymous "setup finished" count, the first time setup finishes on this computer. It carries the
 * school preset id (or "custom", never the URL) and the platform. A marker file in ~/.amicooked stops repeat
 * setups being counted again, so nothing identifying is sent. Never throws and gives up after 1.5 s.
 */
export async function reportSetup(schoolId: string, options: ReportOptions = {}): Promise<boolean> {
  const { env = process.env, fetchImpl = fetch, platform = `${process.platform}-${process.arch}` } = options;
  if (telemetryOff(env)) return false;
  const marker = path.join(homeDir(), "setup-reported");
  if (fs.existsSync(marker)) return false;
  try {
    const res = await fetchImpl(REPORT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ e: "setup", school: findPreset(schoolId)?.id ?? "custom", platform }),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, "");
    return true;
  } catch {
    return false;
  }
}
