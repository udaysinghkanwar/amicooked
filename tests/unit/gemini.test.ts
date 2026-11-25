import { afterEach, beforeEach, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { geminiConfigPath, geminiDesktopHomeError, geminiEntry, installGeminiHttp, installGeminiStdio, uninstallGemini } from "../../src/clients/gemini.js";
import { chooseClients } from "../../src/cli/setup.js";

let home: string;
const connection = { url: "http://127.0.0.1:48271/mcp", headers: { Authorization: `Bearer ${"a".repeat(43)}` } };
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-gemini-")); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });
function put(text: string) {
  const file = geminiConfigPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

it("backs up once, preserves preferences/other servers and makes repeat setup a no-op", () => {
  const original = JSON.stringify({ theme: "dark", mcpServers: { other: { command: "keep" }, amicooked: { sandbox: { enabled: true }, trust: false } } });
  const file = put(original);
  expect(installGeminiHttp(connection, home)).toBe("updated");
  expect(geminiEntry(home)).toEqual(connection);
  const saved = fs.readFileSync(file, "utf8");
  expect(JSON.parse(saved)).toMatchObject({ theme: "dark", mcpServers: { other: { command: "keep" }, amicooked: { sandbox: { enabled: true }, trust: false } } });
  expect(installGeminiHttp(connection, home)).toBe("unchanged");
  expect(fs.readFileSync(file, "utf8")).toBe(saved);
  expect(fs.readFileSync(file + ".amicooked.bak", "utf8")).toBe(original);
  expect(uninstallGemini(home)).toBe("removed");
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ theme: "dark", mcpServers: { other: { command: "keep" } } });
  expect(uninstallGemini(home)).toBe("absent");
});

it.each(['{broken', 'null', '[]', '{"mcpServers":[]}', '{"mcpServers":null}', '{"mcpServers":{"amicooked":"broken"}}'])("leaves malformed user configuration untouched: %s", bad => {
  const file = put(bad);
  expect(() => installGeminiHttp(connection, home)).toThrow(/left alone/);
  expect(() => uninstallGemini(home)).toThrow(/left alone/);
  expect(fs.readFileSync(file, "utf8")).toBe(bad);
  expect(fs.existsSync(file + ".amicooked.bak")).toBe(false);
});

it("preserves disabled state and does not create configuration during status/uninstall", () => {
  expect(geminiEntry(home)).toBeNull();
  expect(uninstallGemini(home)).toBe("absent");
  expect(fs.existsSync(geminiConfigPath(home))).toBe(false);
  put(JSON.stringify({ mcpServers: { amicooked: { disabled: true } } }));
  installGeminiHttp(connection, home);
  expect(geminiEntry(home)).toBeNull();
});

it("replaces the Mac HTTP registration with a local executable and preserves preferences", () => {
  const file = put(JSON.stringify({ mcpServers: { amicooked: { serverUrl: connection.url, headers: connection.headers, disabledTools: ["read_file"] } } }));
  const launch = { command: "C:\\Program Files\\Am I Cooked\\amicooked.exe", args: ["mcp"], env: { AMICOOKED_HOME: "C:\\Custom Home" } };
  expect(installGeminiStdio(launch, home)).toBe("updated");
  expect(installGeminiStdio(launch, home)).toBe("unchanged");
  expect(geminiEntry(home)).toEqual(launch);
  expect(JSON.parse(fs.readFileSync(file, "utf8")).mcpServers.amicooked).toEqual({ ...launch, disabledTools: ["read_file"] });
});

it("selects Gemini explicitly and rejects the removed legacy target", async () => {
  const detected = { desktop: true, code: true, "chatgpt-desktop": true, chatgpt: false, "gemini-desktop": true };
  expect(await chooseClients("gemini", detected, true)).toEqual(["gemini-desktop"]);
  expect(await chooseClients("gemini-desktop,gemini", detected, true)).toEqual(["gemini-desktop"]);
  expect(await chooseClients("desktop,code", detected, true)).toEqual(["desktop", "code"]);
  await expect(chooseClients("gemini-cli", detected, true)).rejects.toThrow(/Unknown app/);
});

it("identifies a native agent sandbox home instead of writing into the wrong user's setup", () => {
  expect(geminiDesktopHomeError("/Users/student/.gemini/users/user1")).toContain("Mac Terminal");
  expect(geminiDesktopHomeError("/Users/student")).toBeNull();
});
