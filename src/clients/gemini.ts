import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "node:child_process";
import { homeDir, writePrivateFile } from "../config.js";
import { InvalidConfigError, SERVER_NAME, type WriteResult } from "./claudeDesktop.js";
import type { HttpConnection } from "./check.js";
import { selfCommand, type LaunchCommand } from "./self.js";

export const GEMINI_DOWNLOAD = "https://gemini.google/desktop/";
export const ANTIGRAVITY_CLI_INSTALL = "https://antigravity.google/docs/cli-getting-started";

export function geminiDesktopHelper(home = os.homedir(), platform = process.platform): string | null {
  if (platform !== "darwin") return null;
  return ["/Applications", path.join(home, "Applications")]
    .map(root => path.join(root, "Gemini.app/Contents/Helpers/agy"))
    .find(fs.existsSync) ?? null;
}

export function hasGeminiClient(): boolean {
  if (process.platform !== "win32") return Boolean(geminiDesktopHelper());
  const appData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return fs.existsSync(path.join(appData, "agy", "bin", "agy.exe")) ||
    spawnSync("where.exe", ["agy.exe"], { windowsHide: true, timeout: 3000 }).status === 0;
}

export function geminiStdioLaunch(): LaunchCommand {
  const launch = selfCommand(["mcp"]);
  return { ...launch, env: { ...launch.env, AMICOOKED_HOME: homeDir() } };
}

/** A native task's virtual HOME is not the desktop application's configuration home. */
export function geminiDesktopHomeError(home = os.homedir()): string | null {
  return /[\\/]\.gemini[\\/]users[\\/]/.test(home)
    ? `Gemini is running in a sandbox home (${home}). Run amicooked setup --clients gemini in your Mac Terminal to configure the desktop user's connection.`
    : null;
}

// The Mac app and Antigravity CLI use this shared registration path.
export const geminiConfigPath = (home = os.homedir()) => path.join(home, ".gemini/config/mcp_config.json");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const stringMap = (value: unknown): value is Record<string, string> =>
  object(value) && Object.values(value).every(item => typeof item === "string");
const stdioFields = ["command", "args", "env"];
const httpFields = ["serverUrl", "url", "httpUrl", "headers"];

function read(home: string) {
  const file = geminiConfigPath(home);
  try {
    const config: unknown = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    if (!object(config) || (config.mcpServers !== undefined && !object(config.mcpServers))) throw new Error();
    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    const entry = servers[SERVER_NAME];
    if (entry !== undefined && !object(entry)) throw new Error();
    return { file, config, servers, entry };
  } catch {
    throw new InvalidConfigError(`${file} isn't a valid Gemini config, so it was left alone. Fix it, then rerun setup.`);
  }
}

export function assertGeminiEnabled(home = os.homedir()): void {
  if (read(home).entry?.disabled) throw new Error("Enable Am I Cooked in Gemini, then rerun setup.");
}

function write(file: string, config: Record<string, unknown>): void {
  const backup = `${file}.amicooked.bak`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) writePrivateFile(backup, fs.readFileSync(file, "utf8"));
  writePrivateFile(file, JSON.stringify(config, null, 2) + "\n");
}

function localConnection(connection: HttpConnection): boolean {
  const url = new URL(connection.url);
  return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.pathname === "/mcp" &&
    !url.username && !url.password && connection.headers.Authorization?.startsWith("Bearer ") === true;
}

export function geminiEntry(home = os.homedir()): HttpConnection | LaunchCommand | null {
  const { entry } = read(home);
  if (!entry || entry.disabled) return null;
  if (typeof entry.command === "string" && Array.isArray(entry.args) && entry.args.every(arg => typeof arg === "string") &&
      (entry.env === undefined || stringMap(entry.env)) && !httpFields.some(key => Object.hasOwn(entry, key))) {
    return { command: entry.command, args: entry.args, env: entry.env };
  }
  if (typeof entry.serverUrl !== "string" || !stringMap(entry.headers) ||
      [...stdioFields, "url", "httpUrl"].some(key => Object.hasOwn(entry, key))) return null;
  const connection = { url: entry.serverUrl, headers: entry.headers };
  try { return localConnection(connection) ? connection : null; }
  catch { return null; }
}

/** Replace only our transport fields; preserve host preferences and unrelated servers. */
export function installGeminiHttp(connection: HttpConnection, home = os.homedir()): WriteResult {
  if (!localConnection(connection)) throw new Error("Gemini requires an authenticated loopback MCP connection.");
  return setTransport({ serverUrl: connection.url, headers: connection.headers }, [...stdioFields, "url", "httpUrl"], home);
}

export function installGeminiStdio(launch: LaunchCommand, home = os.homedir()): WriteResult {
  return setTransport({ command: launch.command, args: launch.args, ...(launch.env && { env: launch.env }) }, [...httpFields, ...stdioFields], home);
}

function setTransport(transport: Record<string, unknown>, replacedFields: string[], home: string): WriteResult {
  const { file, config, servers, entry } = read(home);
  const next = { ...entry };
  for (const key of replacedFields) delete next[key];
  Object.assign(next, transport);
  if (JSON.stringify(entry) === JSON.stringify(next)) return "unchanged";
  write(file, { ...config, mcpServers: { ...servers, [SERVER_NAME]: next } });
  return entry ? "updated" : "added";
}

export function uninstallGemini(home = os.homedir()): WriteResult {
  const { file, config, servers } = read(home);
  if (!Object.hasOwn(servers, SERVER_NAME)) return "absent";
  delete servers[SERVER_NAME];
  write(file, { ...config, mcpServers: servers });
  return "removed";
}
