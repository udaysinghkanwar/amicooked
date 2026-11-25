import { spawnSync, type SpawnSyncReturns } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SKILL_MD } from "../skill.js";
import { SERVER_NAME, type WriteResult } from "./claudeDesktop.js";
import type { LaunchCommand } from "./self.js";

type Run = (args: string[]) => Pick<SpawnSyncReturns<string>, "status" | "stdout" | "stderr" | "error">;

const runClaude: Run = (args) =>
  spawnSync("claude", args, { encoding: "utf8", shell: process.platform === "win32", timeout: 30000 });

export function hasClaudeCode(run: Run = runClaude): boolean {
  const result = run(["--version"]);
  return !result.error && result.status === 0;
}

/** `claude mcp add` at user scope, so Am I Cooked works in every project. Re-adding replaces the old entry. */
export function installClaudeCode(launch: LaunchCommand, run: Run = runClaude): void {
  run(["mcp", "remove", SERVER_NAME, "-s", "user"]);
  const env = Object.entries(launch.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const result = run(["mcp", "add", SERVER_NAME, "-s", "user", ...env, "--", launch.command, ...launch.args]);
  if (result.error || result.status !== 0) {
    throw new Error(`\`claude mcp add\` failed: ${(result.stderr || result.error?.message || "").trim()}`);
  }
}

export function uninstallClaudeCode(run: Run = runClaude): void {
  run(["mcp", "remove", SERVER_NAME, "-s", "user"]);
}

export function skillPath(home = os.homedir()): string {
  return path.join(home, ".claude", "skills", SERVER_NAME, "SKILL.md");
}

/** Install the skill that teaches Claude Code how to use the tools. */
export function installSkill(home = os.homedir()): WriteResult {
  const file = skillPath(home);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === SKILL_MD) return "unchanged";
  const existed = fs.existsSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, SKILL_MD);
  return existed ? "updated" : "added";
}

export function uninstallSkill(home = os.homedir()): WriteResult {
  const dir = path.dirname(skillPath(home));
  if (!fs.existsSync(dir)) return "absent";
  fs.rmSync(dir, { recursive: true, force: true });
  return "removed";
}
