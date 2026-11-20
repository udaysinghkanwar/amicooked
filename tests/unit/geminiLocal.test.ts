import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readLocalState, localStatePath, localConnection, GEMINI_SERVICE_LABEL } from "../../src/clients/geminiLocal.js";
import { installGeminiHttp, geminiEntry, geminiConfigPath, uninstallGemini } from "../../src/clients/gemini.js";
import { launchAgentPlist } from "../../src/remote/service.js";
import { createRemoteServer } from "../../src/remote/http.js";
import { checkMcp } from "../../src/clients/check.js";
import type { AddressInfo } from "net";

let home: string;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-local-")); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
const state = { version: 1 as const, port: 48271, token: "a".repeat(43) };

it("validates persisted local service state without exposing credentials", () => {
  expect(readLocalState(home)).toBeNull();
  fs.writeFileSync(localStatePath(home), JSON.stringify(state));
  expect(readLocalState(home)).toEqual(state);
  fs.writeFileSync(localStatePath(home), JSON.stringify({ ...state, port: 80 }));
  expect(() => readLocalState(home)).toThrow(/Invalid Gemini local service state/);
});

it("migrates native stdio registration to local HTTP, preserving user preferences and other servers", () => {
  const file = geminiConfigPath("gemini-desktop", home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = JSON.stringify({ mcpServers: { keep: { command: "other" }, amicooked: { command: "old", args: ["mcp"], env: {}, sandbox: { enabled: true } } } });
  fs.writeFileSync(file, original);
  const connection = localConnection(state);
  expect(installGeminiHttp(connection, home)).toBe("updated");
  expect(geminiEntry("gemini-desktop", home)).toEqual(connection);
  const updated = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(updated.mcpServers.keep.command).toBe("other");
  expect(updated.mcpServers.amicooked.args).toBeUndefined();
  expect(updated.mcpServers.amicooked.sandbox).toEqual({ enabled: true });
  expect(fs.readFileSync(file + ".amicooked.bak", "utf8")).toBe(original);
  expect(installGeminiHttp(connection, home)).toBe("unchanged");
  expect(uninstallGemini("gemini-desktop", home)).toBe("removed");
  if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
});

it("uses a dedicated LaunchAgent and keeps bearer tokens out of its command/plist", () => {
  const plist = launchAgentPlist({ command: "/normal/amicooked", args: ["gemini-serve"], env: { AMICOOKED_HOME: home } }, "/logs/gemini.log", GEMINI_SERVICE_LABEL);
  expect(plist).toContain("app.amicooked.gemini");
  expect(plist).not.toContain("app.amicooked.serve");
  expect(plist).not.toContain(state.token);
});

describe("authenticated loopback HTTP", () => {
  it("rejects weak/public listener configurations", () => {
    expect(() => createRemoteServer({ publicUrl: "http://0.0.0.0:48271", localToken: state.token })).toThrow();
    expect(() => createRemoteServer({ publicUrl: "http://127.0.0.1:48271", localToken: "weak" })).toThrow();
  });

  it("verifies all tools over HTTP and rejects unauthenticated and cross-origin callers", async () => {
    // Choose a free port first so Host validation matches the actual listener.
    const net = await import("net");
    const socket = net.createServer();
    await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
    const port = (socket.address() as AddressInfo).port;
    await new Promise<void>((r) => socket.close(() => r()));
    const local = { ...state, port };
    const url = `http://127.0.0.1:${port}`;
    const server = createRemoteServer({ publicUrl: url, localToken: state.token });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    try {
      expect(await checkMcp(localConnection(local))).toEqual({ tools: 9, live: false });
      expect((await fetch(url + "/mcp", { method: "POST" })).status).toBe(401);
      expect((await fetch(url + "/mcp", { method: "POST", headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
      expect((await fetch(url + "/mcp", { method: "POST", headers: { Authorization: `Bearer ${state.token}`, Origin: "https://untrusted.example" } })).status).toBe(403);
      expect((await fetch(url + "/register")).status).toBe(404);
    } finally { await new Promise<void>((r) => server.close(() => r())); }
  });
});

it("does not register a public or unauthenticated native service", () => {
  expect(() => installGeminiHttp({ url: "https://public.example/mcp", headers: {} }, home)).toThrow(/loopback/);
  expect(() => installGeminiHttp({ url: "http://127.0.0.1:48271/mcp", headers: {} }, home)).toThrow(/authenticated/);
  expect(fs.existsSync(geminiConfigPath("gemini-desktop", home))).toBe(false);
});
