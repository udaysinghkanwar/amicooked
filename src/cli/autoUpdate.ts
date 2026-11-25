import * as fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getConfig, reloadConfig, paths, writeConfig, writePrivateFile } from "../config.js";
import { currentRuntime, installationChannel, type Runtime } from "../clients/self.js";
import { acquireUpdateLock, updateCommand } from "./update.js";

const DAY = 24 * 60 * 60 * 1000;
const stateFile = () => path.join(paths().home, "automatic-update.json");
function lastAttempt(): number | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(stateFile(), "utf8")).lastAttempt;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  } catch { return undefined; }
}
function automaticUpdatesEnabled(config = getConfig(), runtime?: Runtime): boolean {
  return Boolean(config.school && !config.uninstalled && config.automaticUpdates !== false && installationChannel(runtime));
}

export function automaticUpdateStatus() {
  return { enabled: automaticUpdatesEnabled(), policy: "patch releases within the current major/minor", trigger: "on startup or use, at most once per 24 hours", lastAttempt: lastAttempt(), log: path.join(paths().logs, "automatic-update.log") };
}

/** Best effort only: never delay an MCP handshake or put updater output on protocol stdout. */
export function maybeStartAutomaticUpdate(deps: { now?: number; runtime?: Runtime; launch?: (command: string, args: string[], log: string) => void } = {}): boolean {
  try {
    if (installationChannel(deps.runtime) === null) return false;
    const due = (now: number) => {
      const last = lastAttempt();
      return last === undefined || now < last || now - last >= DAY;
    };
    if (!due(deps.now ?? Date.now()) || !automaticUpdatesEnabled(reloadConfig(), deps.runtime)) return false;
    const releaseLock = acquireUpdateLock();
    try {
      // The skill and multiple MCP processes can request a check at the same time.
      const now = deps.now ?? Date.now();
      if (!due(now)) return false;
      writePrivateFile(stateFile(), JSON.stringify({ lastAttempt: now }) + "\n");
    } finally {
      releaseLock();
    }
    const rt = deps.runtime ?? currentRuntime();
    // Use this loaded package, even under npx; resolving @0 could launch a newer minor before the patch policy runs.
    const launch = { command: rt.execPath, args: [...(rt.isCompiled ? [] : [rt.argv[1]]), "auto-update", "run"] };
    const log = path.join(paths().logs, "automatic-update.log");
    if (deps.launch) deps.launch(launch.command, launch.args, log);
    else {
      fs.mkdirSync(paths().logs, { recursive: true, mode: 0o700 });
      const fd = fs.openSync(log, "w", 0o600);
      try {
        const child = spawn(launch.command, launch.args, { detached: true, windowsHide: true, stdio: ["ignore", fd, fd], env: process.env });
        child.on("error", () => {});
        child.unref();
      } finally { fs.closeSync(fd); }
    }
    return true;
  } catch { return false; }
}

export async function automaticUpdateCommand(action = "status", json = false): Promise<number> {
  if (action === "enable") {
    if (installationChannel() === null) throw new Error("Automatic updates require an installed npm package or standalone binary. Source checkouts stay under Git control.");
    writeConfig({ automaticUpdates: true });
    if (!json) console.log("Automatic patch updates enabled. Am I Cooked checks when it starts or is used, at most once daily. See auto-update status for the last check and local log.");
  } else if (action === "disable") {
    writeConfig({ automaticUpdates: false });
    if (!json) console.log("Automatic updates disabled. An update already installing may finish.");
  } else if (action === "check-if-due") {
    const started = maybeStartAutomaticUpdate();
    if (json) console.log(JSON.stringify({ started }));
    return 0;
  } else if (action === "run") {
    if (!automaticUpdatesEnabled(reloadConfig())) return 0;
    return updateCommand({ json: true, compatibleOnly: true }, { allowed: () => automaticUpdatesEnabled(reloadConfig()) });
  } else if (action !== "status") throw new Error("Use auto-update enable, disable, status or check-if-due.");
  const status = automaticUpdateStatus();
  if (json || action === "status") console.log(JSON.stringify(status, null, 2));
  return 0;
}
