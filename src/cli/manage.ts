import * as fs from "fs";
import { hasActiveSession, login } from "../auth.js";
import { claudeDesktopDir, InvalidConfigError, SERVER_NAME, uninstallClaudeDesktop } from "../clients/claudeDesktop.js";
import { hasClaudeCode, skillPath, uninstallClaudeCode, uninstallSkill } from "../clients/claudeCode.js";
import { chatgptSteps, chatgptUrl, uninstallChatGPT } from "../clients/chatgpt.js";
import { codexConfigured, hasCodex, uninstallCodex, uninstallCodexSkill } from "../clients/codex.js";
import { geminiConfigPath, geminiEntry, hasGeminiClient, uninstallGemini, uninstallGeminiSkill } from "../clients/gemini.js";
import { uninstallGeminiLocal } from "../clients/geminiLocal.js";
import { OAuthStore } from "../remote/oauth.js";
import { client } from "../client.js";
import { getConfig, paths, writeConfig } from "../config.js";
import { VERSION } from "../version.js";
import { removeExtraSkills } from "../skills.js";
import { automaticUpdateStatus } from "./autoUpdate.js";

export async function loginCommand(): Promise<number> {
  if (!getConfig().school) {
    console.log("Run `amicooked setup` first to pick your school.");
    return 1;
  }
  console.log("A browser window is opening. Sign in to your school there; this waits for you.");
  await login();
  const me = (await client.whoami()) as { FirstName?: string };
  console.log(`Signed in${me.FirstName ? ` as ${me.FirstName}` : ""}.`);
  return 0;
}

/** A fresh code for ChatGPT's "connect" page. */
export async function pairCommand(): Promise<number> {
  const url = chatgptUrl();
  if (!url) {
    console.log("ChatGPT isn't set up on this computer. Run `amicooked setup --clients chatgpt`.");
    return 1;
  }
  console.log(chatgptSteps(url, new OAuthStore().newPairingCode()));
  return 0;
}

function desktopConfigured(): boolean {
  const dir = claudeDesktopDir();
  if (!dir) return false;
  try {
    const config = JSON.parse(fs.readFileSync(`${dir}/claude_desktop_config.json`, "utf8"));
    return Boolean(config.mcpServers?.[SERVER_NAME]);
  } catch {
    return false;
  }
}

function geminiStatus(): string {
  try {
    if (geminiEntry()) return "set up";
    return hasGeminiClient() ? "installed, not set up or disabled" : "not installed";
  } catch {
    return `invalid config: ${geminiConfigPath()}`;
  }
}

export async function statusCommand(json: boolean): Promise<number> {
  const config = getConfig();
  const status = {
    version: VERSION,
    school: config.school ? `${config.school.name} (${config.school.host})` : null,
    browser: config.browser ?? null,
    signedIn: hasActiveSession(),
    claudeDesktop: claudeDesktopDir() ? (desktopConfigured() ? "set up" : "installed, not set up") : "not installed",
    claudeCode: hasClaudeCode() ? (fs.existsSync(skillPath()) ? "set up" : "installed") : "not installed",
    chatgptDesktop: hasCodex() ? (codexConfigured() ? "set up" : "installed, not set up") : "not installed",
    geminiDesktop: geminiStatus(),
    chatgpt: chatgptUrl() ?? "not set up",
    dataFolder: paths().home,
    filesFolder: config.filesDir,
    automaticUpdates: automaticUpdateStatus().enabled,
  };
  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return 0;
  }
  console.log(`Am I Cooked ${status.version}`);
  console.log(`  School:         ${status.school ?? "not set up (run `amicooked setup`)"}`);
  console.log(`  Browser:        ${status.browser ?? "not chosen yet"}`);
  console.log(`  Signed in:      ${status.signedIn ? "yes" : "no (signs in again when needed, or run `amicooked login`)"}`);
  console.log(`  Claude Desktop: ${status.claudeDesktop}`);
  console.log(`  Claude Code:    ${status.claudeCode}`);
  console.log(`  ChatGPT app:    ${status.chatgptDesktop}`);
  // ChatGPT on the web is hidden until the tunnel service exists; only show it where it's been set up
  if (chatgptUrl()) console.log(`  ChatGPT web:    ${status.chatgpt}`);
  console.log(`  Gemini:         ${status.geminiDesktop}`);
  console.log(`  Data:           ${status.dataFolder}`);
  console.log(`  Files:          ${status.filesFolder}`);
  console.log(`  Auto updates:   ${status.automaticUpdates ? "on (patches at next startup)" : "off"}`);
  return 0;
}

export async function uninstallCommand(purge: boolean): Promise<number> {
  if (getConfig().school) writeConfig({ uninstalled: true });
  const dir = claudeDesktopDir();
  if (dir) console.log(`Claude Desktop: ${uninstallClaudeDesktop(dir)}`);
  if (hasClaudeCode()) uninstallClaudeCode();
  const codeSkill = uninstallSkill();
  if (codeSkill !== "absent") console.log(`Claude Code skill: ${codeSkill}`);
  const codex = uninstallCodex();
  const codexSkill = uninstallCodexSkill();
  if (codex !== "absent" || codexSkill !== "absent") console.log(`ChatGPT desktop app: ${codex} (skill ${codexSkill})`);
  if (uninstallChatGPT()) console.log("ChatGPT: background service stopped and disconnected");
  let geminiRemoved = true;
  try {
    const gemini = uninstallGemini();
    if (gemini !== "absent") console.log(`Gemini: ${gemini}`);
  } catch (error) {
    if (!(error instanceof InvalidConfigError)) throw error;
    console.error(`Gemini: ${error.message}`);
    geminiRemoved = false;
  }
  const geminiSkill = uninstallGeminiSkill();
  if (geminiSkill !== "absent") console.log(`Gemini skill: ${geminiSkill}`);
  if (process.platform === "darwin" && uninstallGeminiLocal()) console.log("Gemini desktop: local service stopped");
  removeExtraSkills();
  if (purge) {
    fs.rmSync(paths().home, { recursive: true, force: true });
    console.log(`Deleted ${paths().home} (login, settings and file index). Downloaded files in ${getConfig().filesDir} were kept.`);
  } else {
    console.log(`Kept your login and settings in ${paths().home}. Use --purge to delete them.`);
  }
  return geminiRemoved ? 0 : 1;
}
