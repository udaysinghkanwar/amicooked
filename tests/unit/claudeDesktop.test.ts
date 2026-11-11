import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { claudeDesktopDir, installClaudeDesktop, InvalidConfigError, uninstallClaudeDesktop } from "../../src/clients/claudeDesktop.js";

let dir: string;
const file = () => path.join(dir, "claude_desktop_config.json");
const read = () => JSON.parse(fs.readFileSync(file(), "utf8"));
const launch = { command: "/bin/amicooked", args: ["mcp"] };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Claude Desktop config", () => {
  it("creates the config when there is none", () => {
    expect(installClaudeDesktop(dir, launch)).toBe("added");
    expect(read()).toEqual({ mcpServers: { amicooked: launch } });
  });

  it("keeps the student's other servers and settings, and backs up once", () => {
    const original = { preferences: { theme: "dark" }, mcpServers: { other: { command: "x" } } };
    fs.writeFileSync(file(), JSON.stringify(original));
    installClaudeDesktop(dir, launch);
    expect(read()).toEqual({ ...original, mcpServers: { other: { command: "x" }, amicooked: launch } });
    expect(JSON.parse(fs.readFileSync(`${file()}.amicooked.bak`, "utf8"))).toEqual(original);
  });

  it("does nothing on a second run", () => {
    installClaudeDesktop(dir, launch);
    const before = fs.statSync(file()).mtimeMs;
    expect(installClaudeDesktop(dir, launch)).toBe("unchanged");
    expect(fs.statSync(file()).mtimeMs).toBe(before);
  });

  it("updates a changed entry", () => {
    installClaudeDesktop(dir, launch);
    expect(installClaudeDesktop(dir, { command: "/new/amicooked", args: ["mcp"] })).toBe("updated");
  });

  it("refuses to touch a config that isn't valid JSON", () => {
    fs.writeFileSync(file(), "{ broken");
    expect(() => installClaudeDesktop(dir, launch)).toThrow(InvalidConfigError);
    expect(fs.readFileSync(file(), "utf8")).toBe("{ broken");
  });

  it("removes only its own entry", () => {
    fs.writeFileSync(file(), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    installClaudeDesktop(dir, launch);
    expect(uninstallClaudeDesktop(dir)).toBe("removed");
    expect(read()).toEqual({ mcpServers: { other: { command: "x" } } });
    expect(uninstallClaudeDesktop(dir)).toBe("absent");
  });

  it("finds the config folder per platform", () => {
    const home = dir;
    fs.mkdirSync(path.join(home, ".config", "Claude"), { recursive: true });
    expect(claudeDesktopDir({ platform: "linux", home })).toBe(path.join(home, ".config", "Claude"));
    expect(claudeDesktopDir({ platform: "darwin", home })).toBeNull();
  });
});

describe("the running app", () => {
  it("finds Claude Desktop by process on macOS and Windows, and never on Linux", async () => {
    const { isClaudeDesktopRunning } = await import("../../src/clients/claudeDesktop.js");
    const mac = "/sbin/launchd\n/Applications/Claude.app/Contents/MacOS/Claude\n/usr/bin/ssh";
    expect(isClaudeDesktopRunning("darwin", () => ({ status: 0, stdout: mac }))).toBe(true);
    // Claude Code's own helper app is lowercase and lives elsewhere; it must not count
    const codeOnly = "/Users/me/Library/Application Support/Claude/claude-code/2.1/claude.app/Contents/MacOS/claude";
    expect(isClaudeDesktopRunning("darwin", () => ({ status: 0, stdout: codeOnly }))).toBe(false);
    expect(isClaudeDesktopRunning("win32", () => ({ status: 0, stdout: "Claude.exe  4242 Console" }))).toBe(true);
    expect(isClaudeDesktopRunning("win32", () => ({ status: 0, stdout: "INFO: No tasks are running" }))).toBe(false);
    expect(isClaudeDesktopRunning("linux", () => ({ status: 0, stdout: "1" }))).toBe(false);
  });

  it("asks it to quit and waits until the process is gone", async () => {
    const { quitClaudeDesktop } = await import("../../src/clients/claudeDesktop.js");
    const calls: string[] = [];
    let checks = 0;
    const run = (command: string) => {
      calls.push(command);
      // still running for the first check after the quit request, gone on the second
      return { status: 0, stdout: command === "ps" && ++checks < 2 ? "/Applications/Claude.app/Contents/MacOS/Claude" : "" };
    };
    expect(await quitClaudeDesktop("darwin", run, 2000)).toBe(true);
    expect(calls[0]).toBe("osascript");
  });

  it("reports when the app would not quit", async () => {
    const { quitClaudeDesktop } = await import("../../src/clients/claudeDesktop.js");
    expect(await quitClaudeDesktop("darwin", () => ({ status: 0, stdout: "/Applications/Claude.app/Contents/MacOS/Claude" }), 400)).toBe(false);
  });
});
