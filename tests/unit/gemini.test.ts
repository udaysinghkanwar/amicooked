import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { geminiConfigPath, geminiDesktopHomeError, geminiEntry, geminiSkillPath, installGemini, installGeminiSkill, uninstallGemini, uninstallGeminiSkill, type GeminiClient } from "../../src/clients/gemini.js";
import { checkMcp } from "../../src/clients/check.js";
import { chooseClients } from "../../src/cli/setup.js";
import { SKILL_MD, USAGE_SKILL_MD } from "../../src/skill.js";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-gemini-"));
  vi.stubEnv("GEMINI_CLI_HOME", "");
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const launch = { command: "/a path/amicooked", args: ["mcp"], env: { AMICOOKED_HOME: "/school session", EXAMPLE: "a=b" } };
function put(target: GeminiClient, text: string) {
  const file = geminiConfigPath(target, home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

for (const target of ["gemini-desktop", "gemini-cli"] as const) describe(target, () => {
  it("merges our entry, preserves others, backs up once, and is idempotent", () => {
    const original = JSON.stringify({ theme: "dark", mcpServers: { other: { command: "keep" } } });
    const file = put(target, original);
    expect(installGemini(target, launch, home)).toBe("added");
    expect(geminiEntry(target, home)).toEqual(launch);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ theme: "dark", mcpServers: { other: { command: "keep" } } });
    expect(fs.readFileSync(file + ".amicooked.bak", "utf8")).toBe(original);
    const after = fs.readFileSync(file, "utf8");
    expect(installGemini(target, launch, home)).toBe("unchanged");
    expect(fs.readFileSync(file, "utf8")).toBe(after);
    expect(installGemini(target, { ...launch, args: ["mcp", "--new"] }, home)).toBe("updated");
    expect(fs.readFileSync(file + ".amicooked.bak", "utf8")).toBe(original);
    expect(uninstallGemini(target, home)).toBe("removed");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ theme: "dark", mcpServers: { other: { command: "keep" } } });
    expect(uninstallGemini(target, home)).toBe("absent");
  });

  it.each(['{broken', 'null', '[]', '{"mcpServers":[]}', '{"mcpServers":null}'])("leaves invalid settings untouched: %s", (bad) => {
    const file = put(target, bad);
    expect(() => installGemini(target, launch, home)).toThrow(/left alone/);
    expect(() => uninstallGemini(target, home)).toThrow(/left alone/);
    expect(fs.readFileSync(file, "utf8")).toBe(bad);
    expect(fs.existsSync(file + ".amicooked.bak")).toBe(false);
  });

  it("preserves host approval and disabled preferences instead of overriding them", () => {
    const file = put(target, JSON.stringify({ mcpServers: { amicooked: { command: "old", disabled: true, trust: false, sandbox: { enabled: true }, url: "https://old.example" } } }));
    installGemini(target, launch, home);
    const entry = JSON.parse(fs.readFileSync(file, "utf8")).mcpServers.amicooked;
    expect(entry).toMatchObject({ disabled: true, trust: false, sandbox: { enabled: true } });
    expect(entry.url).toBeUndefined();
    expect(geminiEntry(target, home)).toBeNull();
  });

  it("refuses to spread a malformed existing server entry", () => {
    const file = put(target, '{"mcpServers":{"amicooked":"broken"}}');
    expect(() => installGemini(target, launch, home)).toThrow(/left alone/);
    expect(fs.readFileSync(file, "utf8")).toBe('{"mcpServers":{"amicooked":"broken"}}');
  });

  it("does not create files during status or uninstall when absent", () => {
    expect(geminiEntry(target, home)).toBeNull();
    expect(uninstallGemini(target, home)).toBe("absent");
    expect(fs.existsSync(geminiConfigPath(target, home))).toBe(false);
  });
});

it("keeps CLI comments and trailing commas, and honors GEMINI_CLI_HOME", () => {
  vi.stubEnv("GEMINI_CLI_HOME", path.join(home, "custom cli"));
  const file = put("gemini-cli", '{\n// Keep this comment\n"ui": {"theme":"dark"},\n}\n');
  installGemini("gemini-cli", launch, home);
  expect(fs.readFileSync(file, "utf8")).toContain("// Keep this comment");
  expect(geminiEntry("gemini-cli", home)).toEqual(launch);
  expect(file).toBe(path.join(home, "custom cli", "settings.json"));
  expect(geminiConfigPath("gemini-desktop", home)).toBe(path.join(home, ".gemini/config/mcp_config.json"));
});

it("installs a usage-only CLI skill and leaves locally edited skills on uninstall", () => {
  installGeminiSkill(home);
  expect(fs.readFileSync(geminiSkillPath(home), "utf8")).toBe(USAGE_SKILL_MD);
  expect(USAGE_SKILL_MD).toContain("am_i_cooked");
  expect(USAGE_SKILL_MD).not.toMatch(/curl|irm |amicooked setup|Setting it up/);
  expect(SKILL_MD).toContain("gemini-desktop");
  fs.appendFileSync(geminiSkillPath(home), "\nMy custom instruction");
  uninstallGeminiSkill(home);
  expect(fs.existsSync(geminiSkillPath(home))).toBe(true);
  installGeminiSkill(home);
  uninstallGeminiSkill(home);
  expect(fs.existsSync(geminiSkillPath(home))).toBe(false);
});

it("selects only the requested Gemini host and detects native/CLI independently", async () => {
  const detected = { desktop: true, code: true, "chatgpt-desktop": true, chatgpt: false, "gemini-desktop": true, "gemini-cli": false };
  expect(await chooseClients("desktop,code,chatgpt-desktop", detected, true)).toEqual(["desktop", "code", "chatgpt-desktop"]);
  expect(await chooseClients("gemini", detected, true)).toEqual(["gemini-desktop"]);
  expect(await chooseClients("gemini-cli,gemini-cli", detected, true)).toEqual(["gemini-cli"]);
  expect(await chooseClients(undefined, detected, true)).toContain("gemini-desktop");
  expect(await chooseClients(undefined, detected, true)).not.toContain("gemini-cli");
  await expect(chooseClients("gemini-web", detected, true)).rejects.toThrow(/Unknown app/);
});

it("fails promptly when a configured server never speaks MCP", async () => {
  await expect(checkMcp({ command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] }, false, 100)).rejects.toThrow(/timed out/i);
});

it("reports a missing configured executable", async () => {
  await expect(checkMcp({ command: path.join(home, "does-not-exist"), args: [] })).rejects.toThrow();
});

it("does not mistake a native agent sandbox home for the desktop user's home", () => {
  expect(geminiDesktopHomeError("/Users/student/.gemini/users/user1")).toContain("Mac Terminal");
  expect(geminiDesktopHomeError("/Users/student")).toBeNull();
});
