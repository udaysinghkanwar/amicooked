import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { LaunchCommand } from "./self.js";

export const SERVER_NAME = "amicooked";

interface Env {
  platform: NodeJS.Platform;
  home: string;
  appData?: string;
  localAppData?: string;
}

const currentEnv = (): Env => ({
  platform: process.platform,
  home: os.homedir(),
  appData: process.env.APPDATA,
  localAppData: process.env.LOCALAPPDATA,
});

/** Where Claude Desktop keeps its config folder, if it's installed. */
export function claudeDesktopDir(env: Env = currentEnv()): string | null {
  const candidates: string[] = [];
  if (env.platform === "darwin") candidates.push(path.join(env.home, "Library", "Application Support", "Claude"));
  if (env.platform === "win32") {
    if (env.appData) candidates.push(path.join(env.appData, "Claude"));
    // The Microsoft Store build keeps its data inside the package folder
    const packages = env.localAppData && path.join(env.localAppData, "Packages");
    if (packages && fs.existsSync(packages)) {
      for (const dir of fs.readdirSync(packages).filter((d) => d.startsWith("Claude_"))) {
        candidates.push(path.join(packages, dir, "LocalCache", "Roaming", "Claude"));
      }
    }
  }
  if (env.platform === "linux") candidates.push(path.join(env.home, ".config", "Claude"));
  return candidates.find((dir) => fs.existsSync(dir)) ?? null;
}

export class InvalidConfigError extends Error {}

export type WriteResult = "added" | "updated" | "unchanged" | "removed" | "absent";

function readConfig(file: string): Record<string, any> {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  throw new InvalidConfigError(`${file} isn't valid JSON, so it was left alone.`);
}

function writeConfig(file: string, config: Record<string, any>): void {
  // One backup of the student's original config, the first time we touch it
  const backup = `${file}.amicooked.bak`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** Add or update our entry in claude_desktop_config.json, keeping everything else as it was. */
export function installClaudeDesktop(dir: string, launch: LaunchCommand): WriteResult {
  const file = path.join(dir, "claude_desktop_config.json");
  const config = readConfig(file);
  const entry = { command: launch.command, args: launch.args, ...(launch.env ? { env: launch.env } : {}) };
  const existing = config.mcpServers?.[SERVER_NAME];
  if (JSON.stringify(existing) === JSON.stringify(entry)) return "unchanged";
  config.mcpServers = { ...(config.mcpServers ?? {}), [SERVER_NAME]: entry };
  writeConfig(file, config);
  return existing ? "updated" : "added";
}

export function uninstallClaudeDesktop(dir: string): WriteResult {
  const file = path.join(dir, "claude_desktop_config.json");
  const config = readConfig(file);
  if (!config.mcpServers?.[SERVER_NAME]) return "absent";
  delete config.mcpServers[SERVER_NAME];
  writeConfig(file, config);
  return "removed";
}

/** The JSON a student can paste by hand when we can't edit the file. */
export function manualSnippet(launch: LaunchCommand): string {
  const entry = { command: launch.command, args: launch.args, ...(launch.env ? { env: launch.env } : {}) };
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2);
}

// ---- the running app ----
// Claude Desktop keeps its config in memory and saves it back when it quits, which wipes anything
// written while it was open. So setup closes it first, writes, and opens it again.

type Probe = (command: string, args: string[]) => { status: number | null; stdout: string };
const probe: Probe = (command, args) => {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: 10000 });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? "" };
};

export function isClaudeDesktopRunning(platform: NodeJS.Platform = process.platform, run: Probe = probe): boolean {
  if (platform === "darwin") return run("pgrep", ["-x", "Claude"]).status === 0;
  if (platform === "win32") return /claude\.exe/i.test(run("tasklist", ["/FI", "IMAGENAME eq Claude.exe", "/NH"]).stdout);
  return false;
}

/** Asks the app to quit (never forces it) and waits until it's gone. False if it's still open. */
export async function quitClaudeDesktop(platform: NodeJS.Platform = process.platform, run: Probe = probe, waitMs = 15000): Promise<boolean> {
  if (platform === "darwin") run("osascript", ["-e", 'tell application "Claude" to quit']);
  else if (platform === "win32") run("taskkill", ["/IM", "Claude.exe"]);
  else return false;
  for (const end = Date.now() + waitMs; Date.now() < end; ) {
    if (!isClaudeDesktopRunning(platform, run)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return !isClaudeDesktopRunning(platform, run);
}

/** Opens the app again. Only macOS has a reliable way to find it; elsewhere the student opens it. */
export function openClaudeDesktop(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "darwin") return false;
  spawn("open", ["-a", "Claude"], { stdio: "ignore", detached: true }).unref();
  return true;
}
