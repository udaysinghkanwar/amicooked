// Isolated CLI + MCP smoke test. Optionally pass a native binary to exercise self replacement.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-cli-e2e-"));
const env = { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: path.join(root, ".codex"), APPDATA: path.join(root, "AppData/Roaming"), LOCALAPPDATA: path.join(root, "AppData/Local"), AMICOOKED_HOME: path.join(root, ".amicooked"), AMICOOKED_NO_TELEMETRY: "1" };
delete env.D2L_HOST;
delete env.D2L_LOGIN_URL;
const nativeFile = `build/amicooked-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
if (process.argv[2] === "--build-native") execFileSync(process.execPath, ["scripts/build-binaries.mjs", `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`], { stdio: "inherit" });
const binary = process.argv[2] && path.resolve(["--native", "--build-native"].includes(process.argv[2]) ? nativeFile : process.argv[2]);
const command = binary || process.execPath;
const args = binary ? [] : [path.resolve("dist/cli.js")];
const run = (...extra) => execFileSync(command, [...args, ...extra], { env, encoding: "utf8", timeout: 30_000 });
let client;
try {
  fs.mkdirSync(env.AMICOOKED_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.AMICOOKED_HOME, "config.json"), JSON.stringify({ version: 1, browser: "chrome", filesDir: path.join(root, "downloads") }));
  fs.writeFileSync(path.join(env.AMICOOKED_HOME, "token.json"), "keep this session");
  const skill = path.join(root, "other-ai/skills/amicooked");
  const setupArgs = ["setup", "--school", "mcmaster", "--clients", "none", "--skill-dir", skill, "--no-login", "--yes"];
  assert.match(run(...setupArgs), /Would you like a weekly update skill/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(env.AMICOOKED_HOME, "config.json"))).weeklyUpdates, undefined);
  assert.match(run(...setupArgs, "--weekly-updates"), /not scheduled yet/);
  assert.match(run(...setupArgs, "--weekly-updates"), /not scheduled yet/);
  const weekly = path.join(path.dirname(skill), "amicooked-updates/SKILL.md");
  assert.match(fs.readFileSync(weekly, "utf8"), /local command access/);
  for (const name of ["setup", "updates"]) assert.ok(fs.existsSync(path.join(skill, `references/${name}.md`)));
  const configBefore = fs.readFileSync(path.join(env.AMICOOKED_HOME, "config.json"), "utf8");
  const original = fs.readFileSync(path.join(skill, "SKILL.md"), "utf8") + "\nMy local customization.\n";
  fs.writeFileSync(path.join(skill, "SKILL.md"), original);
  run("refresh-skills");
  assert.equal(fs.readFileSync(path.join(env.AMICOOKED_HOME, "config.json"), "utf8"), configBefore);
  assert.equal(fs.readFileSync(path.join(env.AMICOOKED_HOME, "token.json"), "utf8"), "keep this session");
  assert.ok(fs.readdirSync(path.join(skill, ".backups")).some(name => fs.readFileSync(path.join(skill, ".backups", name, "SKILL.md"), "utf8") === original));
  assert.ok(JSON.parse(run("features", "--json")).features.some(f => f.id === "updates"));
  assert.ok(JSON.parse(run("features", "updates", "--json")).updateCommand.command);
  assert.equal(JSON.parse(run("features", "updates", "--json")).updateCommand.env.AMICOOKED_HOME, env.AMICOOKED_HOME);

  client = new Client({ name: "update-smoke-test", version: "1" });
  await client.connect(new StdioClientTransport({ command, args: [...args, "mcp"], env }));
  const list = await client.listTools();
  assert.ok(list.tools.every(t => t.annotations?.readOnlyHint));
  const guide = await client.callTool({ name: "get_feature_guide", arguments: { feature: "updates" } });
  assert.notEqual(guide.isError, true);
  assert.match(guide.content[0].text, /weekly/);
  await client.close(); client = null;

  if (binary) {
    // Use a local release fixture; never update the user's install or contact the release API.
    Object.assign(process.env, env);
    const { reloadConfig } = await import("../dist/config.js");
    reloadConfig();
    const { VERSION } = await import("../dist/version.js");
    const { updateCommand, binaryAsset } = await import("../dist/cli/update.js");
    const install = path.join(root, process.platform === "win32" ? "amicooked.exe" : "amicooked");
    fs.copyFileSync(binary, install);
    fs.chmodSync(install, 0o755);
    fs.writeFileSync(path.join(env.AMICOOKED_HOME, "installed-version.json"), JSON.stringify({ version: "0.0.0" }));
    // Keep the old executable loaded while replacing it, as an AI client's MCP server would.
    client = new Client({ name: "old-runtime", version: "1" });
    await client.connect(new StdioClientTransport({ command: install, args: ["mcp"], env }));
    const asset = binaryAsset(process.platform, process.arch);
    const bytes = fs.readFileSync(binary);
    const base = `https://github.com/udaysinghkanwar/amicooked/releases/download/v${VERSION}/`;
    const fixtureFetch = async url => {
      if (String(url).endsWith("releases/latest")) return Response.json({ tag_name: `v${VERSION}`, body: "Fixture release: full skill updates", assets: [asset, "SHA256SUMS"].map(name => ({ name, browser_download_url: base + name })) });
      if (String(url).endsWith("SHA256SUMS")) return new Response(`${createHash("sha256").update(bytes).digest("hex")}  ${asset}\n`);
      return new Response(bytes);
    };
    assert.equal(await updateCommand({ json: true }, { fetch: fixtureFetch, version: "0.0.0", runtime: { execPath: install, argv: [install], platform: process.platform, isCompiled: true } }), 0);
    assert.equal(execFileSync(install, ["--version"], { encoding: "utf8" }).trim(), VERSION);
    assert.ok(fs.existsSync(install + ".previous"));
    assert.equal(fs.readFileSync(path.join(skill, "references/updates.md"), "utf8"), fs.readFileSync("skill/references/updates.md", "utf8"));
    await client.close(); client = null;
  }
  assert.match(run(...setupArgs, "--no-weekly-updates"), /disabled/);
  assert.equal(fs.existsSync(weekly), false);
  fs.writeFileSync(path.join(skill, "personal.md"), "keep my notes");
  assert.match(run("uninstall"), /remove that task/);
  assert.equal(fs.existsSync(path.join(skill, "SKILL.md")), false);
  assert.equal(fs.readFileSync(path.join(skill, "personal.md"), "utf8"), "keep my notes");
  assert.equal(fs.readFileSync(path.join(env.AMICOOKED_HOME, "token.json"), "utf8"), "keep this session");
  console.log(`Update CLI/MCP smoke test passed${binary ? " (including native executable replacement while in use)" : ""}.`);
} finally {
  await client?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
