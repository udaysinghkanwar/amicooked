import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installSkillBundle } from "./skillFiles.js";
import { SERVER_NAME, type WriteResult } from "./claudeDesktop.js";
import type { LaunchCommand } from "./self.js";

// The ChatGPT desktop app is built on Codex (its bundle ID is com.openai.codex) and, like the Codex CLI,
// starts local MCP servers listed in ~/.codex/config.toml. So "ChatGPT desktop" here means a local
// stdio connection: no tunnel, no domain. ChatGPT on the web is the separate remote target.

interface Env {
  platform: NodeJS.Platform;
  home: string;
  codexHome?: string;
}

const currentEnv = (): Env => ({ platform: process.platform, home: os.homedir(), codexHome: process.env.CODEX_HOME });

export const codexHome = (env: Env = currentEnv()) => env.codexHome || path.join(env.home, ".codex");
export const codexConfigPath = (env: Env = currentEnv()) => path.join(codexHome(env), "config.toml");

/** macOS app bundles that are the Codex-based desktop app, under either name. */
const MAC_APPS = ["/Applications/ChatGPT.app", "/Applications/Codex.app"];

function isCodexBundle(app: string): boolean {
  const plist = path.join(app, "Contents", "Info.plist");
  if (!fs.existsSync(plist)) return false;
  const id = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", plist], { encoding: "utf8" });
  return id.status === 0 && id.stdout.trim() === "com.openai.codex";
}

/** True when the ChatGPT desktop app (or Codex) is on this computer. */
export function hasCodex(env: Env = currentEnv(), hasMacApp: () => boolean = () => MAC_APPS.some(isCodexBundle)): boolean {
  if (fs.existsSync(codexHome(env))) return true;
  return env.platform === "darwin" && hasMacApp();
}

// ---- config.toml, edited as text so every other setting stays byte for byte ----

const TABLE = `mcp_servers.${SERVER_NAME}`;
const header = (line: string) => line.match(/^\s*\[\s*([^\]]+?)\s*\]\s*(#.*)?$/)?.[1] ?? null;

/** Splits the file into our table (and its sub-tables, like `.env`) and everything else. */
function splitOurTable(text: string): { rest: string; ours: string | null } {
  const kept: string[] = [];
  const ours: string[] = [];
  // Comments and blank lines after our table usually belong to the table that follows, so they
  // wait here until we know which side they're on
  let pending: string[] = [];
  let inOurs = false;
  for (const line of text.split("\n")) {
    const name = header(line);
    if (name !== null) {
      kept.push(...pending);
      pending = [];
      inOurs = name === TABLE || name.startsWith(`${TABLE}.`);
      (inOurs ? ours : kept).push(line);
    } else if (inOurs && /^\s*(#.*)?$/.test(line)) {
      pending.push(line);
    } else {
      if (inOurs) ours.push(...pending);
      else kept.push(...pending);
      pending = [];
      (inOurs ? ours : kept).push(line);
    }
  }
  kept.push(...pending);
  return { rest: kept.join("\n"), ours: ours.length ? ours.join("\n").trim() : null };
}

/** TOML basic strings use the same escapes as JSON for everything we'd ever write. */
const str = (s: string) => JSON.stringify(s);

export function tomlEntry(launch: LaunchCommand): string {
  const lines = [`[${TABLE}]`, `command = ${str(launch.command)}`, `args = [${launch.args.map(str).join(", ")}]`];
  if (launch.env && Object.keys(launch.env).length) {
    lines.push("", `[${TABLE}.env]`, ...Object.entries(launch.env).map(([k, v]) => `${k} = ${str(v)}`));
  }
  return lines.join("\n");
}

function writeAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const backup = `${file}.amicooked.bak`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Add or update our server in config.toml. Re-running changes nothing; other servers are untouched. */
export function installCodex(launch: LaunchCommand, file = codexConfigPath()): WriteResult {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const { rest, ours } = splitOurTable(text);
  const entry = tomlEntry(launch);
  if (ours === entry) return "unchanged";
  const body = rest.replace(/\s+$/, "");
  writeAtomic(file, `${body ? `${body}\n\n` : ""}${entry}\n`);
  return ours ? "updated" : "added";
}

export function uninstallCodex(file = codexConfigPath()): WriteResult {
  if (!fs.existsSync(file)) return "absent";
  const { rest, ours } = splitOurTable(fs.readFileSync(file, "utf8"));
  if (!ours) return "absent";
  writeAtomic(file, `${rest.replace(/\s+$/, "")}\n`);
  return "removed";
}

/** True when config.toml already starts exactly this command. */
export function codexEntryIs(launch: LaunchCommand, file = codexConfigPath()): boolean {
  return fs.existsSync(file) && splitOurTable(fs.readFileSync(file, "utf8")).ours === tomlEntry(launch);
}

export function codexConfigured(file = codexConfigPath()): boolean {
  return fs.existsSync(file) && splitOurTable(fs.readFileSync(file, "utf8")).ours !== null;
}

// ---- the skill: the desktop app reads skills from ~/.agents/skills ----

export const codexSkillPath = (home = os.homedir()) => path.join(home, ".agents", "skills", SERVER_NAME, "SKILL.md");

export function installCodexSkill(home = os.homedir()): WriteResult {
  return installSkillBundle(path.dirname(codexSkillPath(home)));
}

export function uninstallCodexSkill(home = os.homedir()): WriteResult {
  const dir = path.dirname(codexSkillPath(home));
  if (!fs.existsSync(dir)) return "absent";
  fs.rmSync(dir, { recursive: true, force: true });
  return "removed";
}
