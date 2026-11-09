import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { paths } from "../config.js";
import type { LaunchCommand } from "../clients/self.js";

/**
 * Keeps `amicooked serve` running in the student's login session, so ChatGPT can reach
 * it whenever the computer is on: a LaunchAgent on macOS, a logon task on Windows,
 * a systemd user unit on Linux.
 */

const LABEL = "app.amicooked.serve";
const TASK = "Am I Cooked";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function launchAgentPlist(launch: LaunchCommand, logFile: string): string {
  const args = [launch.command, ...launch.args].map((a) => `    <string>${xml(a)}</string>`).join("\n");
  const env = Object.entries(launch.env ?? {})
    .map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
${env ? `  <key>EnvironmentVariables</key>\n  <dict>\n${env}\n  </dict>\n` : ""}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logFile)}</string>
</dict>
</plist>
`;
}

export function systemdUnit(launch: LaunchCommand): string {
  const quote = (a: string) => (/[\s"\\]/.test(a) ? `"${a.replace(/(["\\])/g, "\\$1")}"` : a);
  const env = Object.entries(launch.env ?? {}).map(([k, v]) => `Environment=${quote(`${k}=${v}`)}\n`).join("");
  return `[Unit]
Description=Am I Cooked (ChatGPT connection)
After=network-online.target

[Service]
ExecStart=${[launch.command, ...launch.args].map(quote).join(" ")}
${env}Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

/** Windows runs console programs in a visible window; a VBScript wrapper starts it hidden. */
export function hiddenLauncherVbs(launch: LaunchCommand): string {
  const cmd = [launch.command, ...launch.args].map((a) => `""${a}""`).join(" ");
  return `CreateObject("Wscript.Shell").Run "${cmd}", 0, False\r\n`;
}

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${cmd} ${args[0]} failed: ${(result.stderr || result.error?.message || "").trim()}`);
  }
}

const plistPath = () => path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const unitPath = () => path.join(os.homedir(), ".config", "systemd", "user", "amicooked.service");
const vbsPath = () => path.join(paths().bin, "amicooked-serve.vbs");

/** Install (or replace) the background service running `launch`, and start it now. */
export function installService(launch: LaunchCommand): void {
  fs.mkdirSync(paths().logs, { recursive: true });
  if (process.platform === "darwin") {
    const uid = String(os.userInfo().uid);
    fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
    spawnSync("launchctl", ["bootout", `gui/${uid}`, plistPath()]);
    fs.writeFileSync(plistPath(), launchAgentPlist(launch, path.join(paths().logs, "serve.log")));
    run("launchctl", ["bootstrap", `gui/${uid}`, plistPath()]);
  } else if (process.platform === "win32") {
    fs.mkdirSync(paths().bin, { recursive: true });
    fs.writeFileSync(vbsPath(), hiddenLauncherVbs(launch));
    run("schtasks", ["/Create", "/F", "/TN", TASK, "/SC", "ONLOGON", "/RL", "LIMITED", "/TR", `wscript.exe "${vbsPath()}"`]);
    run("schtasks", ["/Run", "/TN", TASK]);
  } else {
    fs.mkdirSync(path.dirname(unitPath()), { recursive: true });
    fs.writeFileSync(unitPath(), systemdUnit(launch));
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", "--now", "amicooked.service"]);
  }
}

export function uninstallService(): boolean {
  if (process.platform === "darwin") {
    if (!fs.existsSync(plistPath())) return false;
    spawnSync("launchctl", ["bootout", `gui/${os.userInfo().uid}`, plistPath()]);
    fs.rmSync(plistPath());
    return true;
  }
  if (process.platform === "win32") {
    const result = spawnSync("schtasks", ["/Delete", "/F", "/TN", TASK]);
    fs.rmSync(vbsPath(), { force: true });
    return result.status === 0;
  }
  if (!fs.existsSync(unitPath())) return false;
  spawnSync("systemctl", ["--user", "disable", "--now", "amicooked.service"]);
  fs.rmSync(unitPath());
  return true;
}

export function serviceInstalled(): boolean {
  if (process.platform === "darwin") return fs.existsSync(plistPath());
  if (process.platform === "win32") return spawnSync("schtasks", ["/Query", "/TN", TASK]).status === 0;
  return fs.existsSync(unitPath());
}
