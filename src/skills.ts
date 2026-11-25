import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { VERSION } from "./version.js";
import { getConfig, paths, writePrivateFile } from "./config.js";
import { skillPath } from "./clients/claudeCode.js";
import { codexSkillPath } from "./clients/codex.js";
import { installSkillBundle, removeSkillBundle } from "./clients/skillFiles.js";

/** Refresh skills without rewriting MCP configuration, restarting apps or repeating login. */
export function refreshSkills(home = os.homedir()): string[] {
  const existingClients = [skillPath(home), codexSkillPath(home)]
    .filter(fs.existsSync)
    .map(file => path.dirname(file));
  const dirs = [...new Set([
    path.join(paths().home, "skill"),
    ...existingClients,
    ...(getConfig().skillDirs ?? []),
  ])];
  const results = dirs.map(dir => `${dir}: ${installSkillBundle(dir)}`);
  writePrivateFile(path.join(paths().home, "installed-version.json"), JSON.stringify({ version: VERSION }) + "\n");
  return results;
}

export function installedSkillVersion(): string | null {
  const file = path.join(paths().home, "installed-version.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")).version ?? null;
}

/** Remove our generated guides, retaining custom files and backups in explicit destinations. */
export function removeExtraSkills(): void {
  const dirs = [path.join(paths().home, "skill"), ...(getConfig().skillDirs ?? [])];
  for (const dir of dirs) removeSkillBundle(dir);
}
