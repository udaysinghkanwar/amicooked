import { spawn, spawnSync, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CdpConnection } from "./cdp.js";
import { getConfig, paths, type BrowserChannel } from "./config.js";

/** Where each browser usually lives, per platform. */
export function browserCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir()
): Array<{ channel: BrowserChannel; path: string }> {
  if (platform === "darwin") {
    const app = (dir: string, name: string) => path.join(dir, `${name}.app`, "Contents", "MacOS", name);
    return ["/Applications", path.join(home, "Applications")].flatMap((dir) => [
      { channel: "chrome" as const, path: app(dir, "Google Chrome") },
      { channel: "msedge" as const, path: app(dir, "Microsoft Edge") },
      { channel: "chromium" as const, path: app(dir, "Chromium") },
    ]);
  }
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter((r): r is string => Boolean(r));
    return [
      ...roots.map((r) => ({ channel: "chrome" as const, path: path.win32.join(r, "Google", "Chrome", "Application", "chrome.exe") })),
      ...roots.map((r) => ({ channel: "msedge" as const, path: path.win32.join(r, "Microsoft", "Edge", "Application", "msedge.exe") })),
    ];
  }
  const which = (name: string) => spawnSync("which", [name], { encoding: "utf8" }).stdout?.trim() || "";
  return [
    { channel: "chrome" as const, path: which("google-chrome") || which("google-chrome-stable") },
    { channel: "msedge" as const, path: which("microsoft-edge") || which("microsoft-edge-stable") },
    { channel: "chromium" as const, path: which("chromium") || which("chromium-browser") },
  ].filter((c) => c.path);
}

/** The installed browser to log in with: the configured one if present, else Chrome, Edge, then Chromium. */
export function findBrowser(preferred = getConfig().browser): { channel: BrowserChannel; path: string } | null {
  const found = browserCandidates().filter((c) => fs.existsSync(c.path));
  return found.find((c) => c.channel === preferred) ?? found[0] ?? null;
}

export async function detectChannel(): Promise<BrowserChannel | null> {
  return findBrowser(undefined)?.channel ?? null;
}

/** True when a visible login window can be shown on this machine. */
export function canShowWindow(): boolean {
  if (process.platform !== "linux") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

export interface Tab {
  url(): Promise<string>;
  goto(url: string): Promise<void>;
  /** Called with each request's URL and headers, including ones set by page scripts. */
  onRequest(fn: (url: string, headers: Record<string, string>) => void): void;
  cookieHeader(origin: string): Promise<string>;
  /** True once the student closed the window. */
  isClosed(): boolean;
}

export interface Profile {
  tab: Tab;
  close(): Promise<void>;
}

/** Start the browser on our profile and wait for its DevTools address. Exits early if the profile is in use. */
function launch(executable: string, headless: boolean, startUrl: string): Promise<{ child: ChildProcess; wsUrl: string }> {
  const args = [
    `--user-data-dir=${paths().browser}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    "--window-size=1200,800",
    // Without a desktop keyring, Linux Chrome would prompt to unlock one
    ...(process.platform === "linux" ? ["--password-store=basic"] : []),
    ...(headless ? ["--headless=new"] : []),
    startUrl,
  ];
  fs.mkdirSync(paths().browser, { recursive: true });
  const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => (child.kill(), reject(new Error("The browser didn't start in time."))), 30000);
    child.stderr!.on("data", (d) => {
      output += String(d);
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) clearTimeout(timer), resolve({ child, wsUrl: match[1] });
    });
    child.on("exit", () => {
      clearTimeout(timer);
      reject(new ProfileBusyError());
    });
  });
}

class ProfileBusyError extends Error {
  constructor() {
    super("The login browser is already open in another Am I Cooked process.");
  }
}

/**
 * Open the persistent profile in ~/.amicooked/browser on `startUrl`, waiting if another
 * Am I Cooked process (e.g. a second AI app) currently has it open.
 */
export async function openProfile(headless: boolean, startUrl: string): Promise<Profile> {
  const browser = findBrowser();
  if (!browser) throw new Error("Am I Cooked logs in through Google Chrome or Microsoft Edge. Install one, then try again.");

  const deadline = Date.now() + 30000;
  let launched: { child: ChildProcess; wsUrl: string };
  for (;;) {
    try {
      launched = await launch(browser.path, headless, startUrl);
      break;
    } catch (error) {
      if (!(error instanceof ProfileBusyError) || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  const { child, wsUrl } = launched;
  const cdp = await CdpConnection.connect(wsUrl);
  const { targetInfos } = await cdp.send<{ targetInfos: Array<{ targetId: string; type: string }> }>("Target.getTargets");
  const page = targetInfos.find((t) => t.type === "page");
  if (!page) throw new Error("The browser opened without a tab.");
  const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  await cdp.send("Network.enable", {}, sessionId);

  let closed = false;
  cdp.on("Target.detachedFromTarget", (p) => p.sessionId === sessionId && (closed = true));
  child.on("exit", () => (closed = true));

  const tab: Tab = {
    url: async () =>
      (await cdp.send<{ result: { value: string } }>("Runtime.evaluate", { expression: "location.href", returnByValue: true }, sessionId)).result.value,
    goto: async (url) => {
      await cdp.send("Page.navigate", { url }, sessionId);
    },
    onRequest: (fn) => {
      cdp.on("Network.requestWillBeSent", (p, sid) => sid === sessionId && fn(p.request.url, p.request.headers ?? {}));
    },
    cookieHeader: async (origin) => {
      const { cookies } = await cdp.send<{ cookies: Array<{ name: string; value: string }> }>("Network.getCookies", { urls: [origin] }, sessionId);
      return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    },
    isClosed: () => closed || cdp.isClosed,
  };

  return {
    tab,
    close: async () => {
      // A clean Browser.close lets Chrome save cookies to the profile
      await Promise.race([cdp.send("Browser.close").catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
      cdp.close();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        const timer = setTimeout(() => (child.kill(), resolve()), 5000);
        child.once("exit", () => (clearTimeout(timer), resolve()));
      });
    },
  };
}
