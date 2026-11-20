// Build first. No model, credentials, school requests or real user config needed.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installGemini, geminiEntry } from "../dist/clients/gemini.js";
import { checkMcp } from "../dist/clients/check.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const home = mkdtempSync(path.join(tmpdir(), "amicooked-gemini-e2e-"));
const env = {
  ...process.env, HOME: home, USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"),
  XDG_CONFIG_HOME: path.join(home, ".config"), CLAUDE_CONFIG_DIR: path.join(home, ".claude"), CODEX_HOME: path.join(home, ".codex"),
  GEMINI_CLI_HOME: path.join(home, ".gemini"), AMICOOKED_HOME: path.join(home, ".amicooked"),
  AMICOOKED_NO_TELEMETRY: "1", D2L_HOST: "", D2L_LOGIN_URL: "",
};
// No tests should consult a developer's CLI override.
const previousCliHome = process.env.GEMINI_CLI_HOME;
process.env.GEMINI_CLI_HOME = env.GEMINI_CLI_HOME;
const run = (args, expected = 0) => {
  const r = spawnSync(process.execPath, [path.join(root, "dist/cli.js"), ...args], { cwd: home, env, encoding: "utf8", timeout: 45000 });
  assert.equal(r.status, expected, `${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return r.stdout + r.stderr;
};
try {
  mkdirSync(env.AMICOOKED_HOME, { recursive: true });
  writeFileSync(path.join(env.AMICOOKED_HOME, "config.json"), JSON.stringify({ version: 1, browser: "chrome", filesDir: path.join(home, "files") }));
  mkdirSync(env.GEMINI_CLI_HOME, { recursive: true });
  const settings = path.join(env.GEMINI_CLI_HOME, "settings.json");
  writeFileSync(settings, '{\n// Preserve me\n"ui":{"theme":"Default"},\n"mcpServers":{"keep":{"command":"do-not-launch"}}\n}');
  assert.match(run(["setup", "--school", "mcmaster", "--clients", "gemini-cli", "--no-login"]), /9 read-only tools verified/);
  assert.match(run(["doctor", "--clients", "gemini-cli"]), /MCP handshake/);
  const before = readFileSync(settings, "utf8");
  run(["setup", "--school", "mcmaster", "--clients", "gemini-cli", "--no-login"]);
  assert.equal(readFileSync(settings, "utf8"), before);
  assert.match(before, /Preserve me/);
  assert.equal(existsSync(path.join(home, ".claude")), false);
  assert.equal(existsSync(path.join(home, ".codex")), false);
  const launch = { command: process.execPath, args: [path.join(root, "dist/cli.js"), "mcp"], env: { AMICOOKED_HOME: env.AMICOOKED_HOME } };
  installGemini("gemini-desktop", launch, home);
  assert.deepEqual(await checkMcp(geminiEntry("gemini-desktop", home)), { tools: 9, live: false });
  assert.match(run(["doctor", "--clients", "gemini-desktop"]), /9 read-only tools/);
  // Optional real host parser test. Isolated config; this never signs into Google or calls a model.
  if (process.env.GEMINI_TEST_COMMAND) {
    const trustFile = path.join(home, "trustedFolders.json");
    const hostEnv = { ...env, GEMINI_CLI_TRUSTED_FOLDERS_PATH: trustFile, GEMINI_CLI_TRUST_WORKSPACE: "", GEMINI_RESTRICTED_MODE: "" };
    const untrusted = spawnSync(process.env.GEMINI_TEST_COMMAND, ["mcp", "list"], { cwd: home, env: hostEnv, encoding: "utf8", timeout: 45000 });
    assert.match(untrusted.stdout + untrusted.stderr, /amicooked[^\n]*Disabled/);
    // Trust only our disposable fixture folder, never a real user's workspace.
    writeFileSync(trustFile, JSON.stringify({ [home]: "TRUST_FOLDER" }));
    const r = spawnSync(process.env.GEMINI_TEST_COMMAND, ["mcp", "list"], { cwd: home, env: hostEnv, encoding: "utf8", timeout: 45000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout + r.stderr, /amicooked/);
    assert.match(r.stdout + r.stderr, /amicooked[^\n]*Connected/);
    console.log("Real Gemini CLI loaded the generated config and connected to Am I Cooked.");
  }
  if (process.env.GEMINI_DESKTOP_TEST_HELPER) {
    if (process.platform === "darwin") run(["setup", "--school", "mcmaster", "--clients", "gemini-desktop", "--no-login"]);
    const r = spawnSync(process.env.GEMINI_DESKTOP_TEST_HELPER, ["mcp", "list"], { cwd: home, env, encoding: "utf8", timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout + r.stderr, /amicooked/);
    console.log("Native Gemini bundled helper loaded the generated desktop registration.");
  }
  run(["uninstall"]);
  assert.match(readFileSync(settings, "utf8"), /Preserve me/);
  assert.match(readFileSync(settings, "utf8"), /do-not-launch/);
  assert.equal(geminiEntry("gemini-cli", home), null);
  run(["doctor", "--clients", "gemini-cli"], 1);
  writeFileSync(settings, "{broken");
  run(["setup", "--school", "mcmaster", "--clients", "gemini-cli", "--no-login"], 1);
  assert.equal(readFileSync(settings, "utf8"), "{broken");
  console.log("Gemini setup, configured stdio process, doctor, repeat setup, uninstall and failure paths passed in an isolated home.");
} finally {
  if (previousCliHome === undefined) delete process.env.GEMINI_CLI_HOME;
  else process.env.GEMINI_CLI_HOME = previousCliHome;
  rmSync(home, { recursive: true, force: true });
}
