import * as fs from "fs";
import { hasActiveSession, login } from "../auth.js";
import { claudeDesktopDir, SERVER_NAME, uninstallClaudeDesktop } from "../clients/claudeDesktop.js";
import { hasClaudeCode, skillPath, uninstallClaudeCode, uninstallSkill } from "../clients/claudeCode.js";
import { chatgptSteps, chatgptUrl, uninstallChatGPT } from "../clients/chatgpt.js";
import { OAuthStore } from "../remote/oauth.js";
import { client } from "../client.js";
import { getConfig, paths } from "../config.js";
import { VERSION } from "../version.js";

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

export async function statusCommand(json: boolean): Promise<number> {
  const config = getConfig();
  const status = {
    version: VERSION,
    school: config.school ? `${config.school.name} (${config.school.host})` : null,
    browser: config.browser ?? null,
    signedIn: hasActiveSession(),
    claudeDesktop: claudeDesktopDir() ? (desktopConfigured() ? "set up" : "installed, not set up") : "not installed",
    claudeCode: hasClaudeCode() ? (fs.existsSync(skillPath()) ? "set up" : "installed") : "not installed",
    chatgpt: chatgptUrl() ?? "not set up",
    dataFolder: paths().home,
    filesFolder: config.filesDir,
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
  console.log(`  ChatGPT:        ${status.chatgpt}`);
  console.log(`  Data:           ${status.dataFolder}`);
  console.log(`  Files:          ${status.filesFolder}`);
  return 0;
}

export async function uninstallCommand(purge: boolean): Promise<number> {
  const dir = claudeDesktopDir();
  if (dir) console.log(`Claude Desktop: ${uninstallClaudeDesktop(dir)}`);
  if (hasClaudeCode()) {
    uninstallClaudeCode();
    console.log(`Claude Code: removed (skill ${uninstallSkill()})`);
  }
  if (uninstallChatGPT()) console.log("ChatGPT: background service stopped and disconnected");
  if (purge) {
    fs.rmSync(paths().home, { recursive: true, force: true });
    console.log(`Deleted ${paths().home} (login, settings and file index). Downloaded files in ${getConfig().filesDir} were kept.`);
  } else {
    console.log(`Kept your login and settings in ${paths().home}. Use --purge to delete them.`);
  }
  return 0;
}
