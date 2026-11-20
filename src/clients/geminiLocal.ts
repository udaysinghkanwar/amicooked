import { spawnSync } from "child_process";
import { randomBytes } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as net from "net";
import { homeDir, writePrivateFile } from "../config.js";
import { createRemoteServer } from "../remote/http.js";
import { launchAgentPlist } from "../remote/service.js";
import { checkMcp, type HttpConnection } from "./check.js";
import type { LaunchCommand } from "./self.js";

export const GEMINI_SERVICE_LABEL = "app.amicooked.gemini";
export interface LocalState { version: 1; port: number; token: string }
export const localStatePath = (home = homeDir()) => path.join(home, "gemini-local.json");
export const localPlistPath = (home = os.homedir()) => path.join(home, "Library", "LaunchAgents", `${GEMINI_SERVICE_LABEL}.plist`);

export function readLocalState(home = homeDir()): LocalState | null {
  const file = localStatePath(home);
  if (!fs.existsSync(file)) return null;
  let state;
  try { state = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new Error(`Invalid Gemini local service state in ${file}.`); }
  if (state?.version !== 1 || !Number.isInteger(state.port) || state.port < 1024 || state.port > 65535 ||
      typeof state.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state.token)) throw new Error(`Invalid Gemini local service state in ${file}.`);
  return state;
}

export function localConnection(state: LocalState): HttpConnection {
  return { url: `http://127.0.0.1:${state.port}/mcp`, headers: { Authorization: `Bearer ${state.token}` } };
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  return port;
}

function launchctl(args: string[], required = true): void {
  const r = spawnSync("launchctl", args, { encoding: "utf8", timeout: 15000 });
  if (required && (r.error || r.status !== 0)) throw new Error("Could not start Gemini's local MCP service. Run setup from your Mac Terminal and check amicooked status.");
}

/** Dedicated local LaunchAgent; no tunnel, public endpoint, or Gemini filesystem grants. */
export async function installGeminiLocal(launch: LaunchCommand): Promise<HttpConnection> {
  if (process.platform !== "darwin") throw new Error("The Gemini desktop local service currently supports macOS only.");
  const uid = String(os.userInfo().uid);
  const file = localPlistPath();
  let state = readLocalState();
  launchctl(["bootout", `gui/${uid}`, file], false);
  if (!state) state = { version: 1, port: await freePort(), token: randomBytes(32).toString("base64url") };
  // A port might now belong to another program. Do not kill it or reuse its endpoint.
  const probe = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(state!.port, "127.0.0.1", resolve); });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    state = { ...state, port: await freePort() };
  }
  const text = JSON.stringify(state, null, 2) + "\n";
  if (!fs.existsSync(localStatePath()) || fs.readFileSync(localStatePath(), "utf8") !== text) writePrivateFile(localStatePath(), text);
  fs.chmodSync(localStatePath(), 0o600);
  const logs = path.join(homeDir(), "logs");
  fs.mkdirSync(logs, { recursive: true, mode: 0o700 });
  const serviceLaunch = { ...launch, env: { ...launch.env, AMICOOKED_HOME: homeDir() } };
  writePrivateFile(file, launchAgentPlist(serviceLaunch, path.join(logs, "gemini-local.log"), GEMINI_SERVICE_LABEL));
  launchctl(["bootstrap", `gui/${uid}`, file]);
  const connection = localConnection(state);
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await checkMcp(connection, false, 1000); return connection; }
    catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error("Gemini's local MCP service did not become ready. See ~/.amicooked/logs/gemini-local.log and rerun setup.");
}

export function uninstallGeminiLocal(): boolean {
  const file = localPlistPath();
  if (!fs.existsSync(file)) return false;
  // Only operate on the dedicated service label; never touch the ChatGPT service.
  launchctl(["bootout", `gui/${os.userInfo().uid}`, file], false);
  fs.unlinkSync(file);
  fs.rmSync(localStatePath(), { force: true });
  return true;
}

export async function serveGeminiLocal(): Promise<number> {
  const state = readLocalState();
  if (!state) throw new Error("Gemini's local connection is not set up. Run amicooked setup --clients gemini-desktop.");
  const server = createRemoteServer({ publicUrl: `http://127.0.0.1:${state.port}`, localToken: state.token });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(state.port, "127.0.0.1", resolve); });
  console.error("[gemini] Authenticated MCP service listening on loopback.");
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  return new Promise<number>(() => {});
}
