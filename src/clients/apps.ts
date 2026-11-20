import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// The desktop apps setup can connect, and how to find, open, quit and download them.
// Nothing here forces an app closed: quitting always asks the app to quit, the way Cmd+Q does.

export type AppId = "claude" | "chatgpt";

export interface DesktopApp {
  id: AppId;
  name: string;
  download: string;
  /** macOS: the app's name for `open -a` and AppleScript, and its main executable. */
  macName: string;
  macExe: RegExp;
  /** Windows: the process name, and where a normal install keeps the executable (if anywhere fixed). */
  winProcess: string;
  winExe: (env: NodeJS.ProcessEnv) => string | null;
  /**
   * True when the app saves its own copy of our config file when it quits, wiping what setup wrote while it
   * was open. Claude Desktop does; the ChatGPT app (checked by hand) doesn't.
   */
  overwritesOnQuit: boolean;
}

export const APPS: Record<AppId, DesktopApp> = {
  claude: {
    id: "claude",
    name: "Claude Desktop",
    download: "https://claude.ai/download",
    macName: "Claude",
    // Claude Code ships a lowercase claude.app inside Claude's support folder; only the real app counts
    macExe: /\/Claude\.app\/Contents\/MacOS\/Claude$/m,
    winProcess: "Claude.exe",
    winExe: (env) => (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "AnthropicClaude", "claude.exe") : null),
    overwritesOnQuit: true,
  },
  chatgpt: {
    id: "chatgpt",
    name: "the ChatGPT app",
    download: "https://chatgpt.com/download",
    macName: "ChatGPT",
    macExe: /\/ChatGPT\.app\/Contents\/MacOS\/ChatGPT$/m,
    winProcess: "ChatGPT.exe",
    // The Windows app comes from the Microsoft Store, which has no fixed path to launch
    winExe: () => null,
    overwritesOnQuit: false,
  },
};

export const CLAUDE_CODE_DOWNLOAD = "https://code.claude.com/docs/en/overview";

/** Desktop apps exist for macOS and Windows only. */
export const desktopAppsSupported = (platform: NodeJS.Platform = process.platform) => platform === "darwin" || platform === "win32";

export type Run = (command: string, args: string[]) => { status: number | null; stdout: string };
const run: Run = (command, args) => {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: 10000 });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? "" };
};

export interface Host {
  platform: NodeJS.Platform;
  run: Run;
  env: NodeJS.ProcessEnv;
}
const host = (): Host => ({ platform: process.platform, run, env: process.env });

export function isRunning(app: DesktopApp, h: Host = host()): boolean {
  // ps, not pgrep: pgrep skips its own ancestors, so it misses the app when setup runs from inside it
  if (h.platform === "darwin") return app.macExe.test(h.run("ps", ["-axo", "comm="]).stdout);
  if (h.platform === "win32") {
    return h.run("tasklist", ["/FI", `IMAGENAME eq ${app.winProcess}`, "/NH"]).stdout.toLowerCase().includes(app.winProcess.toLowerCase());
  }
  return false;
}

/**
 * True when this process was started by the app, e.g. an agent in Claude Desktop running setup.
 * Quitting that app would end the very session asking for it, so setup must not.
 */
export function isRunningInside(app: DesktopApp, h: Host = host(), pid = process.pid): boolean {
  if (h.platform !== "darwin") return false;
  const table = new Map<number, { ppid: number; comm: string }>();
  for (const line of h.run("ps", ["-axo", "pid=,ppid=,comm="]).stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3] });
  }
  for (let p = pid, hops = 0; p > 1 && hops < 64; hops++) {
    const row = table.get(p);
    if (!row) return false;
    if (app.macExe.test(row.comm)) return true;
    p = row.ppid;
  }
  return false;
}

/** Asks the app to quit and waits until it's gone. False if it's still open (unsaved work, a dialog). */
export async function quit(app: DesktopApp, h: Host = host(), waitMs = 15000): Promise<boolean> {
  if (h.platform === "darwin") h.run("osascript", ["-e", `tell application "${app.macName}" to quit`]);
  else if (h.platform === "win32") h.run("taskkill", ["/IM", app.winProcess]);
  else return false;
  for (const end = Date.now() + waitMs; Date.now() < end; ) {
    if (!isRunning(app, h)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return !isRunning(app, h);
}

/** Opens the app. False when there's no reliable way to on this computer; then the student opens it. */
export function open(app: DesktopApp, h: Host = host(), launch = detachedLaunch): boolean {
  if (h.platform === "darwin") return launch("open", ["-a", app.macName]);
  if (h.platform === "win32") {
    const exe = app.winExe(h.env);
    return exe !== null && fs.existsSync(exe) && launch(exe, []);
  }
  return false;
}

/** Opens a web page in the default browser. */
export function openUrl(url: string, platform: NodeJS.Platform = process.platform, launch = detachedLaunch): boolean {
  if (platform === "darwin") return launch("open", [url]);
  if (platform === "win32") return launch("cmd", ["/c", "start", "", url]);
  return launch("xdg-open", [url]);
}

function detachedLaunch(command: string, args: string[]): boolean {
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
