import * as p from "@clack/prompts";
import { hasActiveSession, login } from "../auth.js";
import { detectChannel } from "../browser.js";
import { claudeDesktopDir, installClaudeDesktop, InvalidConfigError, manualSnippet } from "../clients/claudeDesktop.js";
import { hasClaudeCode, installClaudeCode, installSkill } from "../clients/claudeCode.js";
import { chatgptSteps, installChatGPT } from "../clients/chatgpt.js";
import { selfCommand } from "../clients/self.js";
import { client } from "../client.js";
import { getConfig, writeConfig, type School } from "../config.js";
import { listCourses } from "../courseResolver.js";
import { detectSchool, findPreset, PRESETS } from "../schools.js";
import { amICooked } from "../tools/cooked.js";

export type ClientId = "desktop" | "code" | "chatgpt";
const CLIENT_IDS: ClientId[] = ["desktop", "code", "chatgpt"];

export interface SetupOptions {
  school?: string;
  clients?: string;
  yes?: boolean;
  login?: boolean;
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

async function chooseClients(flag: string | undefined, detected: Record<ClientId, boolean>, yes: boolean): Promise<ClientId[]> {
  if (flag) {
    const ids = flag.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const unknown = ids.filter((id) => !CLIENT_IDS.includes(id as ClientId));
    if (unknown.length) throw new SetupStop(`Unknown app: ${unknown.join(", ")}. Use desktop, code or chatgpt.`);
    return ids as ClientId[];
  }
  const defaults = CLIENT_IDS.filter((id) => detected[id]);
  if (yes || !interactive()) return defaults;

  const chosen = await p.multiselect({
    message: "Where do you want to use it?",
    initialValues: defaults,
    required: false,
    options: [
      { value: "desktop" as const, label: "Claude Desktop", hint: detected.desktop ? "found" : "not found" },
      { value: "code" as const, label: "Claude Code", hint: detected.code ? "found" : "not found" },
      { value: "chatgpt" as const, label: "ChatGPT", hint: "runs in the background while your computer is on" },
    ],
  });
  if (p.isCancel(chosen)) throw new SetupStop("Setup cancelled.");
  return chosen;
}

async function configureClients(clients: ClientId[]): Promise<string[]> {
  const done: string[] = [];
  const launch = selfCommand(["mcp"]);

  if (clients.includes("desktop")) {
    const dir = claudeDesktopDir();
    if (!dir) {
      p.log.warn("Claude Desktop isn't installed. Get it at https://claude.ai/download, then run `amicooked setup` again.");
    } else {
      try {
        const result = installClaudeDesktop(dir, launch);
        p.log.success(`Claude Desktop: ${result === "unchanged" ? "already set up" : "set up"}`);
        done.push("desktop");
      } catch (error) {
        if (!(error instanceof InvalidConfigError)) throw error;
        p.log.warn(`${error.message}\nAdd this to it yourself:\n${manualSnippet(launch)}`);
      }
    }
  }

  if (clients.includes("code")) {
    if (!hasClaudeCode()) {
      p.log.warn("Claude Code isn't installed, so it was skipped.");
    } else {
      installClaudeCode(launch);
      installSkill();
      p.log.success("Claude Code: set up, with the amicooked skill");
      done.push("code");
    }
  }

  if (clients.includes("chatgpt")) {
    const spin = p.spinner();
    spin.start("Setting up your private ChatGPT connection");
    try {
      const { url, pairingCode } = await installChatGPT();
      spin.stop("ChatGPT: running in the background");
      p.note(chatgptSteps(url, pairingCode), "Connect ChatGPT");
      done.push("chatgpt");
    } catch (error) {
      spin.stop(`ChatGPT: ${error instanceof Error ? error.message : error}`);
    }
  }
  return done;
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

    const browser = getConfig().browser ?? (await detectChannel());
    if (!browser) {
      throw new SetupStop("Am I Cooked logs in through Google Chrome or Microsoft Edge. Install one of them, then run setup again.");
    }
    const schoolChanged = getConfig().school?.host !== school.host;
    writeConfig({ school, browser });

    if (options.login !== false && (schoolChanged || !hasActiveSession())) {
      p.log.step("A browser window is opening. Sign in to your school there; this window waits for you.");
      await login();
    }
    if (options.login !== false) {
      const me = (await client.whoami()) as { FirstName?: string };
      const courses = await listCourses();
      p.log.success(`Signed in${me.FirstName ? ` as ${me.FirstName}` : ""}. Found ${courses.length} course${courses.length === 1 ? "" : "s"}.`);
    }

    const detected = { desktop: Boolean(claudeDesktopDir()), code: hasClaudeCode(), chatgpt: false };
    const done = await configureClients(await chooseClients(options.clients, detected, Boolean(options.yes)));

    if (options.login !== false) await firstRoast();

    const next = done.includes("desktop")
      ? "Quit and reopen Claude Desktop, then ask: am I cooked?"
      : done.includes("code")
        ? "Start Claude Code and ask: am I cooked?"
        : done.includes("chatgpt")
          ? "Finish connecting in ChatGPT, then ask: am I cooked?"
          : "Run `amicooked setup` again once you've installed Claude Desktop, Claude Code or ChatGPT.";
    p.outro(next);
    return 0;
  } catch (error) {
    const code = error instanceof SetupStop ? error.code : 1;
    p.cancel(error instanceof Error ? error.message : String(error));
    return code;
  }
}
