import { describe, expect, it } from "vitest";
import { APPS, isRunning, isRunningInside, open, openUrl, quit, type Host } from "../../src/clients/apps.js";

const CLAUDE = "/Applications/Claude.app/Contents/MacOS/Claude";
const CHATGPT = "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT";
// Claude Code ships its own lowercase claude.app; it must never count as Claude Desktop
const CLAUDE_CODE = "/Users/me/Library/Application Support/Claude/claude-code/2.1/claude.app/Contents/MacOS/claude";

const mac = (stdout: string): Host => ({ platform: "darwin", env: {}, run: () => ({ status: 0, stdout }) });

describe("isRunning", () => {
  it("finds each app by its own executable on macOS", () => {
    expect(isRunning(APPS.claude, mac(`/sbin/launchd\n${CLAUDE}\n/usr/bin/ssh`))).toBe(true);
    expect(isRunning(APPS.claude, mac(CLAUDE_CODE))).toBe(false);
    expect(isRunning(APPS.chatgpt, mac(CHATGPT))).toBe(true);
    expect(isRunning(APPS.chatgpt, mac(CLAUDE))).toBe(false);
  });

  it("uses tasklist on Windows and gives up on Linux", () => {
    const win = (stdout: string): Host => ({ platform: "win32", env: {}, run: () => ({ status: 0, stdout }) });
    expect(isRunning(APPS.claude, win("Claude.exe   4242 Console"))).toBe(true);
    expect(isRunning(APPS.claude, win("INFO: No tasks are running"))).toBe(false);
    expect(isRunning(APPS.claude, { platform: "linux", env: {}, run: () => ({ status: 0, stdout: CLAUDE }) })).toBe(false);
  });
});

describe("isRunningInside", () => {
  // pid, ppid, executable: a shell started by Claude Code started by Claude Desktop
  const table = ["1 0 /sbin/launchd", `100 1 ${CLAUDE}`, `200 100 ${CLAUDE_CODE}`, "300 200 /bin/zsh", "400 300 /usr/bin/amicooked"].join("\n");

  it("sees when setup was started from inside the app", () => {
    expect(isRunningInside(APPS.claude, mac(table), 400)).toBe(true);
    expect(isRunningInside(APPS.chatgpt, mac(table), 400)).toBe(false);
  });

  it("is false for a terminal started on its own", () => {
    const terminal = ["1 0 /sbin/launchd", "50 1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal", "60 50 /bin/zsh", "70 60 /usr/bin/amicooked"].join("\n");
    expect(isRunningInside(APPS.claude, mac(terminal), 70)).toBe(false);
  });
});

describe("quit and open", () => {
  it("asks the app to quit, then waits for it to go", async () => {
    const calls: string[] = [];
    let checks = 0;
    const host: Host = {
      platform: "darwin",
      env: {},
      run: (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        return { status: 0, stdout: command === "ps" && ++checks < 2 ? CLAUDE : "" };
      },
    };
    expect(await quit(APPS.claude, host, 2000)).toBe(true);
    expect(calls[0]).toBe('osascript -e tell application "Claude" to quit');
  });

  it("reports an app that won't quit", async () => {
    expect(await quit(APPS.claude, mac(CLAUDE), 400)).toBe(false);
  });

  it("opens by name on macOS, and only a known executable on Windows", () => {
    const launched: string[] = [];
    const launch = (command: string, args: string[]) => (launched.push(`${command} ${args.join(" ")}`.trim()), true);
    expect(open(APPS.chatgpt, mac(""), launch)).toBe(true);
    expect(launched).toEqual(["open -a ChatGPT"]);
    // The Microsoft Store ChatGPT app has no path to launch, and Linux has neither app
    expect(open(APPS.chatgpt, { platform: "win32", env: {}, run: () => ({ status: 0, stdout: "" }) }, launch)).toBe(false);
    expect(open(APPS.claude, { platform: "linux", env: {}, run: () => ({ status: 0, stdout: "" }) }, launch)).toBe(false);
  });

  it("opens download pages in the default browser", () => {
    const launched: string[] = [];
    const launch = (command: string, args: string[]) => (launched.push(`${command} ${args.join(" ")}`), true);
    openUrl("https://claude.ai/download", "darwin", launch);
    openUrl("https://claude.ai/download", "win32", launch);
    expect(launched).toEqual(["open https://claude.ai/download", "cmd /c start  https://claude.ai/download"]);
  });
});
