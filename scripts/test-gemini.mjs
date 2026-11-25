// Isolated HTTP registration/doctor acceptance; no real LaunchAgent, model or school account.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installGeminiHttp, geminiConfigPath, geminiEntry } from "../dist/clients/gemini.js";
import { checkMcp } from "../dist/clients/check.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const home = mkdtempSync(path.join(tmpdir(), "amicooked-gemini-e2e-"));
const env = { ...process.env, HOME: home, USERPROFILE: home,
  APPDATA: path.join(home, "AppData/Roaming"), LOCALAPPDATA: path.join(home, "AppData/Local"),
  CODEX_HOME: path.join(home, ".codex"), AMICOOKED_HOME: path.join(home, ".amicooked"),
  AMICOOKED_SKIP_VIDEO_DEPS: "1", AMICOOKED_NO_TELEMETRY: "1", D2L_HOST: "", D2L_LOGIN_URL: "" };
const run = (args, expected = 0) => {
  const r = spawnSync(process.execPath, [path.join(root, "dist/cli.js"), ...args], { cwd: home, env, encoding: "utf8", timeout: 45000 });
  assert.equal(r.status, expected, `${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return r.stdout + r.stderr;
};
let service;
try {
  mkdirSync(env.AMICOOKED_HOME, { recursive: true });
  writeFileSync(path.join(env.AMICOOKED_HOME, "config.json"), JSON.stringify({ version: 1, browser: "chrome", filesDir: path.join(home, "files") }));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const token = randomBytes(32).toString("base64url");
  writeFileSync(path.join(env.AMICOOKED_HOME, "gemini-local.json"), JSON.stringify({ version: 1, port, token }), { mode: 0o600 });
  service = spawn(process.execPath, [path.join(root, "dist/cli.js"), "gemini-serve"], { cwd: home, env, stdio: "ignore" });
  const connection = { url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } };
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { await checkMcp(connection, false, 500); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert(ready, "Local HTTP service did not become ready");
  assert.equal(installGeminiHttp(connection, home), "added");
  assert.equal(installGeminiHttp(connection, home), "unchanged");
  assert.equal(await checkMcp(geminiEntry(home)), 10);
  assert.match(run(["doctor"]), /10 read-only tools/);
  assert.equal(existsSync(path.join(home, ".claude")), false);
  assert.equal(existsSync(path.join(home, ".codex")), false);
  run(["uninstall"]);
  assert.equal(geminiEntry(home), null);
  run(["doctor"], 1);
  const file = geminiConfigPath(home);
  writeFileSync(file, "{broken");
  run(["doctor"], 1);
  const helper = process.platform === "darwin"
    ? path.join(home, "Applications", "Gemini.app", "Contents", "Helpers", "agy")
    : path.join(env.LOCALAPPDATA, "agy", "bin", "agy.exe");
  mkdirSync(path.dirname(helper), { recursive: true });
  writeFileSync(helper, "");
  const skill = path.join(home, "other-client", "skills", "amicooked");
  const setup = run(["setup", "--school", "mcmaster", "--clients", "gemini", "--no-login", "--yes", "--skill-dir", skill], 1);
  if (process.platform === "darwin" || process.platform === "win32") assert.match(setup, /isn't a valid Gemini config/);
  assert.equal(existsSync(path.join(skill, "SKILL.md")), true);
  assert.match(run(["uninstall"], 1), /isn't a valid Gemini config/);
  assert.equal(existsSync(path.join(skill, "SKILL.md")), false);
  assert.equal(readFileSync(file, "utf8"), "{broken");
  console.log("Gemini HTTP service, registration, doctor, and setup/uninstall isolation passed.");
} finally {
  if (service && service.exitCode === null) { service.kill("SIGTERM"); await once(service, "exit"); }
  rmSync(home, { recursive: true, force: true });
}
