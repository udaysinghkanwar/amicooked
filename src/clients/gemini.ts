import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writePrivateFile } from "../config.js";
import { InvalidConfigError, SERVER_NAME, type WriteResult } from "./claudeDesktop.js";
import type { HttpConnection } from "./check.js";

export const GEMINI_DOWNLOAD = "https://gemini.google/desktop/";

export function geminiDesktopHelper(home = os.homedir(), platform = process.platform): string | null {
  if (platform !== "darwin") return null;
  return ["/Applications", path.join(home, "Applications")]
    .map(root => path.join(root, "Gemini.app/Contents/Helpers/agy"))
    .find(fs.existsSync) ?? null;
}

/** A native task's virtual HOME is not the desktop application's configuration home. */
export function geminiDesktopHomeError(home = os.homedir()): string | null {
  return /[\\/]\.gemini[\\/]users[\\/]/.test(home)
    ? `Gemini is running in a sandbox home (${home}). Run amicooked setup --clients gemini in your Mac Terminal to configure the desktop user's connection.`
    : null;
}

// Native Gemini and its bundled Antigravity CLI share this HTTP registration.
export const geminiConfigPath = (home = os.homedir()) => path.join(home, ".gemini/config/mcp_config.json");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

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

export function geminiEntry(home = os.homedir()): HttpConnection | null {
  const { entry } = read(home);
  if (!entry || entry.disabled || typeof entry.serverUrl !== "string" ||
      ["command", "args", "env", "url", "httpUrl"].some(key => Object.hasOwn(entry, key)) ||
      !object(entry.headers) || !Object.values(entry.headers).every(value => typeof value === "string")) return null;
  const connection = { url: entry.serverUrl, headers: entry.headers as Record<string, string> };
  try { return localConnection(connection) ? connection : null; }
  catch { return null; }
}

/** Replace only our transport fields; preserve host preferences and unrelated servers. */
export function installGeminiHttp(connection: HttpConnection, home = os.homedir()): WriteResult {
  if (!localConnection(connection)) throw new Error("Gemini requires an authenticated loopback MCP connection.");
  const { file, config, servers, entry } = read(home);
  const next: Record<string, unknown> = { ...entry, serverUrl: connection.url, headers: connection.headers };
  for (const key of ["command", "args", "env", "url", "httpUrl"]) delete next[key];
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
