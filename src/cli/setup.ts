import { prepareVideoSafely } from "../video/command.js";
import * as p from "@clack/prompts";
import * as fs from "fs";
import * as path from "path";
import { stripVTControlCharacters } from "node:util";
import { clearTokenCache, hasActiveSession, login } from "../auth.js";
import { detectChannel } from "../browser.js";
import { APPS, CLAUDE_CODE_DOWNLOAD, desktopAppsSupported, isRunning, isRunningInside, open, openUrl, quit, type DesktopApp } from "../clients/apps.js";
import { claudeDesktopDir, installClaudeDesktop, InvalidConfigError, manualSnippet } from "../clients/claudeDesktop.js";
import { scheduleAfterQuit } from "./afterQuit.js";
import { hasClaudeCode, installClaudeCode, installSkill } from "../clients/claudeCode.js";
import { chatgptSteps, installChatGPT } from "../clients/chatgpt.js";
import { codexEntryIs, codexSkillPath, hasCodex, installCodex, installCodexSkill } from "../clients/codex.js";
import { installGeminiLocal } from "../clients/geminiLocal.js";
import { checkMcp } from "../clients/check.js";
import { assertGeminiEnabled, geminiDesktopHomeError, geminiEntry, geminiStdioLaunch, hasGeminiClient, installGeminiHttp, installGeminiSkill, installGeminiStdio, ANTIGRAVITY_CLI_INSTALL, GEMINI_DOWNLOAD } from "../clients/gemini.js";
import { skillBundleIs } from "../clients/skillFiles.js";
import { refreshSkills } from "../skills.js";
import { selfCommand } from "../clients/self.js";
import { client } from "../client.js";
import { getConfig, writeConfig, type School } from "../config.js";
import { listCourses } from "../courseResolver.js";
import { detectSchool, findPreset, PRESETS } from "../schools.js";
import { amICooked } from "../tools/cooked.js";
import { reportSetup } from "../telemetry.js";

/**
 * Every app listed here starts Am I Cooked on the student's computer. `chatgpt` (ChatGPT on the web, over a
 * tunnel) is built but hidden until the tunnel service is deployed; it only runs with AMICOOKED_TUNNEL_API set.
 */
export type ClientId = "desktop" | "code" | "chatgpt-desktop" | "chatgpt" | "gemini-desktop";
const PUBLIC_IDS: ClientId[] = ["desktop", "code", "chatgpt-desktop", "gemini-desktop"];
const CLIENT_IDS: ClientId[] = [...PUBLIC_IDS, "chatgpt"];
const ALIASES: Record<string, ClientId> = { gemini: "gemini-desktop", codex: "chatgpt-desktop", "chatgpt-app": "chatgpt-desktop", "chatgpt-web": "chatgpt" };

export interface SetupOptions {
  school?: string;
  clients?: string;
  yes?: boolean;
  login?: boolean;
  skillDir?: string;
  prepareVideo?: boolean;
}

/** Exit code for "the agent needs to ask the student something first". */
export const NEEDS_INPUT = 2;

class SetupStop extends Error {
  constructor(message: string, public code = 1) {
    super(message);
  }
}

const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

function presetList(): string {
  return PRESETS.map((s) => `  ${s.id.padEnd(11)} ${s.name} (${s.lmsName})`).join("\n");
}

async function chooseSchool(flag: string | undefined): Promise<School> {
  if (flag) return findPreset(flag) ?? (await detectSchool(flag));
  const current = getConfig().school;

  if (!interactive()) {
    if (current) return current;
    throw new SetupStop(
      `Which school? Ask the student, then run setup again with --school <id> or --school <the URL they log in through>.\n\nPresets:\n${presetList()}`,
      NEEDS_INPUT
    );
  }

  const choice = await p.select({
    message: "Which school do you go to?",
    initialValue: current?.id === "custom" ? "other" : current?.id,
    options: [
      ...PRESETS.map((s) => ({ value: s.id, label: s.name, hint: s.lmsName })),
      { value: "other", label: "Somewhere else", hint: "paste the URL you log in through" },
    ],
  });
  if (p.isCancel(choice)) throw new SetupStop("Setup cancelled.");
  if (choice !== "other") return findPreset(choice)!;

  const url = await p.text({
    message: "Paste the web address you use to log in to your courses",
    placeholder: "https://learn.myschool.edu",
    validate: (v) => (v?.trim() ? undefined : "Paste a URL"),
  });
  if (p.isCancel(url)) throw new SetupStop("Setup cancelled.");
  const spin = p.spinner();
  spin.start("Finding your school's Brightspace");
  try {
    const school = await detectSchool(url);
    spin.stop(`Found ${school.host}`);
    return school;
  } catch (error) {
    spin.stop("Couldn't find it");
    throw error;
  }
}

export async function chooseClients(flag: string | undefined, detected: Record<ClientId, boolean>, yes: boolean): Promise<ClientId[]> {
  if (flag) {
    if (flag === "none") return [];
    const ids = flag.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).map((id) => ALIASES[id] ?? id);
    const unknown = ids.filter((id) => !CLIENT_IDS.includes(id as ClientId));
    if (unknown.length) throw new SetupStop(`Unknown app: ${unknown.join(", ")}. Use ${PUBLIC_IDS.join(", ")}.`);
    return [...new Set(ids)] as ClientId[];
  }
  const defaults = PUBLIC_IDS.filter((id) => detected[id]);
  if (yes || !interactive()) return defaults;

  const chosen = await p.multiselect({
    message: "Where do you want to use it?",
    initialValues: defaults,
    required: false,
    options: [
      { value: "desktop" as const, label: "Claude Desktop", hint: detected.desktop ? "found" : "not found" },
      { value: "code" as const, label: "Claude Code", hint: detected.code ? "found" : "not found" },
      { value: "chatgpt-desktop" as const, label: "ChatGPT desktop (Codex)", hint: detected["chatgpt-desktop"] ? "found" : "not found" },
      ...(desktopAppsSupported() ? [{ value: "gemini-desktop" as const, label: process.platform === "win32" ? "Gemini (Antigravity CLI)" : "Gemini", hint: detected["gemini-desktop"] ? "found" : "not found" }] : []),
    ],
  });
  if (p.isCancel(chosen)) throw new SetupStop("Setup cancelled.");
  return chosen;
}

// ---- finishing each app ----
// Every app the student picks ends in one clear next step: it's open and ready, it needs a restart,
// it needs opening, or it needs installing (with the link). setup prints them all at the end.

export interface Outcome {
  app: string;
  next: string;
  /** True when the student can ask straight away. */
  ready: boolean;
  /** True when our server is in the app's config (it may still need a restart). Only these count as a setup. */
  connected: boolean;
  /** A selected app could not be connected and needs attention. */
  failed?: boolean;
}

const quitHow = () => (process.platform === "darwin" ? "with Cmd+Q" : "fully, from its icon by the clock if it has one");

async function missingApp(app: string, name: string, url: string): Promise<Outcome> {
  if (interactive()) {
    const ok = await p.confirm({ message: `${name} isn't installed. Open its download page?` });
    if (ok === true) openUrl(url);
  }
  return { app, next: `install ${name} from ${url}, then run \`amicooked setup\` again.`, ready: false, connected: false };
}

/**
 * Connects a desktop app and leaves it open with the new config loaded, or says exactly what's left.
 * `write` adds our server to the app's config; `current` says whether it's already there.
 */
async function connectDesktopApp(app: DesktopApp, label: string, write: () => void, current: () => boolean): Promise<Outcome> {
  const ask = "Ask it: am I cooked?";
  if (current()) {
    // Already set up. Make sure it's open; no restart needed
    if (isRunning(app)) return { app: label, next: `already set up. ${ask}`, ready: true, connected: true };
    return open(app)
      ? { app: label, next: `already set up, and opening now. ${ask}`, ready: true, connected: true }
      : { app: label, next: `already set up. Open ${app.name} and ask: am I cooked?`, ready: false, connected: true };
  }

  let running = isRunning(app);
  const inside = running && isRunningInside(app);
  // An open app only loads the change after a restart. Offer one, unless setup is running inside that app
  // (an agent there) or nobody's at the keyboard to say yes
  if (running && !inside && interactive()) {
    const ok = await p.confirm({ message: `${app.name} is open and needs a restart to pick this up. Restart it now?` });
    if (ok === true) running = !(await quit(app));
  }

  write();
  if (running && app.overwritesOnQuit) {
    // Quitting it would save its old config over ours, so a background helper waits for the quit, writes
    // the config again and reopens the app
    return scheduleAfterQuit()
      ? { app: label, next: `quit ${app.name} ${quitHow()}. Am I Cooked finishes setting it up and reopens it. Then ask it: am I cooked?`, ready: false, connected: true }
      : { app: label, next: `quit ${app.name} ${quitHow()}, then run \`amicooked setup\` again.`, ready: false, connected: false };
  }
  if (running) return { app: label, next: `quit ${app.name} ${quitHow()} and open it again. Then ask it: am I cooked?`, ready: false, connected: true };
  return open(app)
    ? { app: label, next: `set up, and opening now. ${ask}`, ready: true, connected: true }
    : { app: label, next: `set up. Open ${app.name} and ask: am I cooked?`, ready: false, connected: true };
}

async function configureClients(clients: ClientId[]): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  const launch = selfCommand(["mcp"]);
  // Persist the school/session location even when an agent or test uses a custom home.

  if (clients.includes("desktop")) {
    const dir = claudeDesktopDir();
    if (!desktopAppsSupported()) {
      outcomes.push({ app: "Claude Desktop", next: `isn't available on Linux. Use Claude Code instead: ${CLAUDE_CODE_DOWNLOAD}`, ready: false, connected: false });
    } else if (!dir) {
      outcomes.push(await missingApp("Claude Desktop", "Claude Desktop", APPS.claude.download));
    } else {
      try {
        outcomes.push(
          await connectDesktopApp(APPS.claude, "Claude Desktop", () => installClaudeDesktop(dir, launch), () => desktopHas(dir, launch))
        );
      } catch (error) {
        if (!(error instanceof InvalidConfigError)) throw error;
        p.log.warn(`${error.message}\nAdd this to it yourself:\n${manualSnippet(launch)}`);
        outcomes.push({ app: "Claude Desktop", next: "add the snippet above to its config, then restart it.", ready: false, connected: false });
      }
    }
  }

  if (clients.includes("code")) {
    if (!hasClaudeCode()) {
      outcomes.push(await missingApp("Claude Code", "Claude Code", CLAUDE_CODE_DOWNLOAD));
    } else {
      installClaudeCode(launch);
      installSkill();
      // Claude Code loads servers when a session starts, so an agent already running needs a new one
      outcomes.push({ app: "Claude Code", next: "set up. Start a new Claude Code session and ask: am I cooked?", ready: true, connected: true });
    }
  }

  if (clients.includes("chatgpt-desktop")) {
    if (!hasCodex() && !desktopAppsSupported()) {
      outcomes.push({ app: "ChatGPT app", next: `isn't available on Linux. Use Claude Code instead: ${CLAUDE_CODE_DOWNLOAD}`, ready: false, connected: false });
    } else if (!hasCodex()) {
      outcomes.push(await missingApp("ChatGPT app", "the ChatGPT app", APPS.chatgpt.download));
    } else {
      // Runs on this computer like Claude Desktop does; no tunnel or domain involved
      outcomes.push(
        await connectDesktopApp(
          APPS.chatgpt,
          "ChatGPT desktop (Codex)",
          () => {
            installCodex(launch);
            installCodexSkill();
          },
          () => codexHas(launch)
        )
      );
    }
  }

  if (clients.includes("gemini-desktop")) {
    const windows = process.platform === "win32";
    if (!desktopAppsSupported()) {
      outcomes.push({ app: "Gemini", next: "is available on Mac or through Antigravity CLI on Windows.", ready: false, connected: false, failed: true });
    } else if (!hasGeminiClient()) {
      const missing = windows
        ? await missingApp("Gemini", "Antigravity CLI", ANTIGRAVITY_CLI_INSTALL)
        : await missingApp("Gemini", "Gemini", GEMINI_DOWNLOAD);
      outcomes.push({ ...missing, failed: true });
    } else {
      try {
        assertGeminiEnabled();
        if (windows) {
          installGeminiStdio(geminiStdioLaunch());
        } else {
          installGeminiHttp(await installGeminiLocal(selfCommand(["gemini-serve"])));
        }
        const configured = geminiEntry();
        if (!configured) throw new Error("Gemini did not accept the connection. Rerun setup.");
        const tools = await checkMcp(configured);
        installGeminiSkill();
        p.log.success(`Gemini: MCP handshake and ${tools} read-only tools verified.`);
        const reopen = windows ? "Start a new Antigravity CLI session" : "Reopen Gemini or start a new Antigravity CLI session";
        outcomes.push({ app: "Gemini", ready: false, connected: true, next: `set up. ${reopen}, then ask: am I cooked?` });
      } catch (error) {
        outcomes.push({ app: "Gemini", ready: false, connected: false, failed: true, next: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  if (clients.includes("chatgpt") && !process.env.AMICOOKED_TUNNEL_API) {
    outcomes.push({ app: "ChatGPT on the web", next: "isn't available yet. Use the ChatGPT app instead: `--clients chatgpt-desktop`.", ready: false, connected: false });
  } else if (clients.includes("chatgpt")) {
    const spin = p.spinner();
    spin.start("Setting up your private ChatGPT connection");
    try {
      const { url, pairingCode } = await installChatGPT();
      spin.stop("ChatGPT: running in the background");
      p.note(chatgptSteps(url, pairingCode), "Connect ChatGPT");
      outcomes.push({ app: "ChatGPT on the web", next: "finish connecting with the steps above, then ask: am I cooked?", ready: false, connected: true });
    } catch (error) {
      spin.stop(`ChatGPT: ${error instanceof Error ? error.message : error}`);
    }
  }
  return outcomes;
}

/** True when Claude Desktop's config already starts this exact install. */
function desktopHas(dir: string, launch: ReturnType<typeof selfCommand>): boolean {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(dir, "claude_desktop_config.json"), "utf8"));
    const entry = { command: launch.command, args: launch.args, ...(launch.env ? { env: launch.env } : {}) };
    return JSON.stringify(config.mcpServers?.amicooked) === JSON.stringify(entry);
  } catch {
    return false;
  }
}

/** True when the ChatGPT app's config already starts this exact install, and the skill is in place. */
function codexHas(launch: ReturnType<typeof selfCommand>): boolean {
  return codexEntryIs(launch) && skillBundleIs(path.dirname(codexSkillPath()));
}

/** The end of setup: every app's next step, then one line saying whether they're done. */
export function finishMessage(outcomes: Outcome[]): { steps: string | null; outro: string } {
  if (!outcomes.length) {
    const gemini = process.platform === "darwin" ? `, or Gemini (${GEMINI_DOWNLOAD})`
      : process.platform === "win32" ? `, or Antigravity CLI (${ANTIGRAVITY_CLI_INSTALL})` : "";
    return {
      steps: null,
      outro: `Nothing was set up. Get Claude Desktop (${APPS.claude.download}) or the ChatGPT app (${APPS.chatgpt.download})${gemini}, then run \`amicooked setup\` again.`,
    };
  }
  const steps = outcomes.map((o) => `${o.app}: ${o.next}`).join("\n");
  return { steps, outro: outcomes.some((o) => o.ready) ? "You're set." : "Almost there. Do the step above." };
}

async function firstRoast(): Promise<void> {
  const spin = p.spinner();
  spin.start("Checking whether you're cooked");
  try {
    const report = await amICooked({});
    const { heat, heatLabel, dueSoon, overdue } = report.summary;
    spin.stop(`Heat: ${heatLabel} (${heat}/10) · ${dueSoon} due this week${overdue ? ` · ${overdue} overdue` : ""}`);
  } catch (error) {
    spin.stop(`Couldn't build your first report: ${error instanceof Error ? error.message : error}`);
  }
}

export async function setup(options: SetupOptions): Promise<number> {
  p.intro("Am I Cooked");
  try {
    const school = await chooseSchool(options.school);
    p.log.info(`School: ${school.name} (${school.host})`);

    const detected = { desktop: Boolean(claudeDesktopDir()), code: hasClaudeCode(), "chatgpt-desktop": hasCodex(), chatgpt: false, "gemini-desktop": hasGeminiClient() };
    const clients = await chooseClients(options.clients, detected, Boolean(options.yes));
    const sandboxError = process.platform === "darwin" && clients.includes("gemini-desktop") ? geminiDesktopHomeError() : null;
    if (sandboxError) throw new SetupStop(sandboxError);

    const browser = getConfig().browser ?? (await detectChannel());
    if (!browser) {
      throw new SetupStop("Am I Cooked logs in through Google Chrome or Microsoft Edge. Install one of them, then run setup again.");
    }
    const schoolChanged = getConfig().school?.host !== school.host;
    if (schoolChanged) clearTokenCache();
    writeConfig({ school, browser, ...(options.prepareVideo === undefined ? {} : { prepareVideo: options.prepareVideo }) });

    if (options.login !== false && (schoolChanged || !hasActiveSession())) {
      p.log.step("A browser window is opening. Sign in to your school there; this window waits for you.");
      await login();
    }
    if (options.login !== false) {
      const me = (await client.whoami()) as { FirstName?: string };
      const courses = await listCourses();
      p.log.success(`Signed in${me.FirstName ? ` as ${me.FirstName}` : ""}. Found ${courses.length} course${courses.length === 1 ? "" : "s"}.`);
    }

    if (getConfig().uninstalled) writeConfig({ uninstalled: undefined });
    const outcomes = await configureClients(clients);
    if (options.skillDir) {
      const dir = path.resolve(options.skillDir);
      writeConfig({ skillDirs: [...new Set([...(getConfig().skillDirs ?? []), dir])] });
      outcomes.push({ app: "Other AI client", next: `skill folder: ${dir}. Configure its MCP server with ${JSON.stringify(selfCommand(["mcp"]))}, then start a new session.`, ready: false, connected: false });
    }
    refreshSkills();

    // Count the setup only if an app was connected. Started now so it runs alongside the first report
    const reported = outcomes.some((o) => o.connected) ? reportSetup(school.id) : undefined;

    if (options.login !== false) await firstRoast();

    const { steps, outro } = finishMessage(outcomes);
    if (steps) p.note(steps, "Next");
    p.outro(outro);
    await reported;
    await prepareVideoSafely({ humanOutput: true });
    return outcomes.some((o) => o.failed) ? 1 : 0;
  } catch (error) {
    const code = error instanceof SetupStop ? error.code : 1;
    p.outro(stripVTControlCharacters(error instanceof Error ? error.message : String(error)));
    return code;
  }
}
