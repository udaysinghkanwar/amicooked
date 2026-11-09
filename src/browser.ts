import { chromium, type BrowserContext, type LaunchOptions } from "playwright-core";
import { getConfig, paths, type BrowserChannel } from "./config.js";

const CHANNELS: BrowserChannel[] = ["chrome", "msedge", "chromium"];

/**
 * Open the persistent profile in ~/.amicooked/browser, waiting if another
 * Am I Cooked process (e.g. a second MCP client) currently holds it.
 */
export async function openProfile(headless: boolean, channel = getConfig().browser ?? "chrome"): Promise<BrowserContext> {
  const options: LaunchOptions & { viewport: { width: number; height: number } } = {
    headless,
    viewport: { width: 1200, height: 800 },
    ...(channel === "chromium" ? {} : { channel }),
  };
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      return await chromium.launchPersistentContext(paths().browser, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ProcessSingleton") || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/** The first browser that launches here: installed Chrome, then Edge, then Playwright's Chromium. */
export async function detectChannel(): Promise<BrowserChannel | null> {
  for (const channel of CHANNELS) {
    try {
      const browser = await chromium.launch({ headless: true, ...(channel === "chromium" ? {} : { channel }) });
      await browser.close();
      return channel;
    } catch {
      // Not installed; try the next one
    }
  }
  return null;
}

/** True when a visible login window can be shown on this machine. */
export function canShowWindow(): boolean {
  if (process.platform !== "linux") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}
