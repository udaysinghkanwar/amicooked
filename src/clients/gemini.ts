import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { writePrivateFile } from "../config.js";
import { USAGE_SKILL_MD } from "../skill.js";
import { InvalidConfigError, SERVER_NAME, type WriteResult } from "./claudeDesktop.js";
import type { McpConnection, HttpConnection } from "./check.js";
import type { LaunchCommand } from "./self.js";

export type GeminiClient = "gemini-desktop" | "gemini-cli";
export const GEMINI_DOWNLOAD = "https://gemini.google/desktop/";
export const GEMINI_CLI_DOWNLOAD = "https://geminicli.com/docs/get-started/installation/";

export function geminiDesktopHelper(home = os.homedir(), platform = process.platform): string | null {
  if (platform !== "darwin") return null;
  for (const root of ["/Applications", path.join(home, "Applications")]) {
    const helper = path.join(root, "Gemini.app", "Contents", "Helpers", "agy");
    if (fs.existsSync(helper)) return helper;
  }
  return null;
}

/** A native task's virtual HOME is not the desktop application's configuration home. */
export function geminiDesktopHomeError(home = os.homedir()): string | null {
  if (!/[\\/]\.gemini[\\/]users[\\/]/.test(home)) return null;
  return `Gemini is running setup in a sandbox home (${home}), which is separate from the Mac app's configuration. Run amicooked setup --clients gemini-desktop in your Mac Terminal once; it configures and tests MCP automatically. No manual MCP settings are needed.`;
}

export function hasGeminiCli(): boolean {
  const r = spawnSync("gemini", ["--version"], { encoding: "utf8", shell: process.platform === "win32", timeout: 10000 });
  return !r.error && r.status === 0;
}

export function geminiConfigPath(client: GeminiClient, home = os.homedir()): string {
  // Gemini Mac's bundled agy helper and native McpServerRegistry use this path.
  // Gemini CLI is a different host and uses settings.json instead.
  return client === "gemini-desktop"
    ? path.join(home, ".gemini", "config", "mcp_config.json")
    : path.join(process.env.GEMINI_CLI_HOME || path.join(home, ".gemini"), "settings.json");
}

function read(file: string, client: GeminiClient): { text: string; config: Record<string, any> } {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "{}\n";
  try {
    const errors: ParseError[] = [];
    const config = client === "gemini-cli" ? parse(text, errors, { allowTrailingComma: true }) : JSON.parse(text);
    if (errors.length || !config || typeof config !== "object" || Array.isArray(config) ||
        (config.mcpServers !== undefined && (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)))) throw new Error();
    return { text, config };
  } catch {
    throw new InvalidConfigError(`${file} isn't a valid Gemini config, so it was left alone. Fix it, then rerun setup.`);
  }
}

function write(file: string, text: string): void {
  const backup = `${file}.amicooked.bak`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) writePrivateFile(backup, fs.readFileSync(file, "utf8"));
  writePrivateFile(file, text);
}

export function geminiEntry(client: GeminiClient, home = os.homedir()): McpConnection | null {
  const { config } = read(geminiConfigPath(client, home), client);
  const e = config.mcpServers?.[SERVER_NAME];
  const endpoint = e?.serverUrl ?? e?.httpUrl ?? (typeof e?.command === "string" && e.command.startsWith("http:") ? e.command : undefined);
  if (client === "gemini-desktop" && !e?.disabled && typeof endpoint === "string") {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/mcp" || url.username || url.password) return null;
      if (!e.headers || typeof e.headers !== "object" || Array.isArray(e.headers) || !Object.values(e.headers).every((v) => typeof v === "string")) return null;
      return { url: endpoint, headers: e.headers };
    } catch { return null; }
  }

  if (!e || e.disabled || e.httpUrl || e.url || typeof e.command !== "string" ||
      (e.args !== undefined && (!Array.isArray(e.args) || !e.args.every((a: unknown) => typeof a === "string"))) ||
      (e.env !== undefined && (!e.env || typeof e.env !== "object" || Array.isArray(e.env) || !Object.values(e.env).every((v) => typeof v === "string")))) return null;
  return { command: e.command, args: e.args ?? [], ...(e.env ? { env: e.env } : {}) };
}

/** Merge just our server. Never change host trust, sandbox, permissions, or other servers. */
export function installGemini(client: GeminiClient, launch: LaunchCommand, home = os.homedir()): WriteResult {
  const file = geminiConfigPath(client, home);
  const { text, config } = read(file, client);
  const existing = config.mcpServers?.[SERVER_NAME];
  if (existing !== undefined && (!existing || typeof existing !== "object" || Array.isArray(existing))) {
    throw new InvalidConfigError(`${file} has an invalid Am I Cooked server entry, so it was left alone. Fix it, then rerun setup.`);
  }
  // Preserve per-server approval/sandbox preferences on reinstall, including disabled state.
  const entry = { ...existing, command: launch.command, args: launch.args, env: launch.env ?? {} };
  delete entry.url;
  delete entry.httpUrl;
  delete entry.serverUrl;
  delete entry.headers;
  if (JSON.stringify(existing) === JSON.stringify(entry)) return "unchanged";
  const next = client === "gemini-cli"
    ? applyEdits(text, modify(text, ["mcpServers", SERVER_NAME], entry, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
    : JSON.stringify({ ...config, mcpServers: { ...config.mcpServers, [SERVER_NAME]: entry } }, null, 2) + "\n";
  write(file, next);
  return existing ? "updated" : "added";
}

/** Native Gemini uses authenticated loopback HTTP: its default sandbox rejects stdio executables. */
export function installGeminiHttp(connection: HttpConnection, home = os.homedir()): WriteResult {
  const endpoint = new URL(connection.url);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.pathname !== "/mcp" || endpoint.username || endpoint.password || !connection.headers.Authorization?.startsWith("Bearer ")) throw new Error("Gemini desktop requires an authenticated loopback MCP connection.");
  const target = "gemini-desktop";
  const file = geminiConfigPath(target, home);
  const { config } = read(file, target);
  const existing = config.mcpServers?.[SERVER_NAME];
  if (existing !== undefined && (!existing || typeof existing !== "object" || Array.isArray(existing))) throw new InvalidConfigError(`${file} has an invalid server entry, so it was left alone.`);
  const entry = { ...existing, command: connection.url, serverUrl: connection.url, headers: connection.headers };
  for (const key of ["args", "env", "url", "httpUrl"]) delete entry[key];
  if (JSON.stringify(existing) === JSON.stringify(entry)) return "unchanged";
  write(file, JSON.stringify({ ...config, mcpServers: { ...config.mcpServers, [SERVER_NAME]: entry } }, null, 2) + "\n");
  return existing ? "updated" : "added";
}

export function uninstallGemini(client: GeminiClient, home = os.homedir()): WriteResult {
  const file = geminiConfigPath(client, home);
  const { text, config } = read(file, client);
  if (!Object.hasOwn(config.mcpServers ?? {}, SERVER_NAME)) return "absent";
  delete config.mcpServers[SERVER_NAME];
  write(file, client === "gemini-cli"
    ? applyEdits(text, modify(text, ["mcpServers", SERVER_NAME], undefined, {}))
    : JSON.stringify(config, null, 2) + "\n");
  return "removed";
}

export const geminiSkillPath = (home = os.homedir()) => path.join(process.env.GEMINI_CLI_HOME || path.join(home, ".gemini"), "skills", SERVER_NAME, "SKILL.md");

/** CLI skill only. Native Gemini receives guidance through MCP server instructions. */
export function installGeminiSkill(home = os.homedir()): void {
  const file = geminiSkillPath(home);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === USAGE_SKILL_MD) return;
  writePrivateFile(file, USAGE_SKILL_MD);
}

export function uninstallGeminiSkill(home = os.homedir()): void {
  const file = geminiSkillPath(home);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === USAGE_SKILL_MD) fs.unlinkSync(file);
}
