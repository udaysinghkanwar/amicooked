import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { SKILL_FILES } from "./skill.js";
import { VERSION } from "./version.js";
import { getConfig, paths, writePrivateFile } from "./config.js";
import { selfCommand } from "./clients/self.js";
import { skillPath } from "./clients/claudeCode.js";
import { codexSkillPath } from "./clients/codex.js";
import { installSkillBundle } from "./clients/skillFiles.js";
import type { Tool } from "./tools/types.js";

// Add one entry and its reference when shipping a feature. Dependencies remain optional.
export const FEATURES = [
  { id: "courses", name: "Course planning", description: "Grades, deadlines, announcements and course files.", requires: "A Brightspace login.", guide: "SKILL.md" },
  { id: "updates", name: "Updates", description: "Update the app and skills; optionally schedule weekly updates.", requires: "Local command access; weekly execution also needs a supported host scheduler.", guide: "references/updates.md" },
  { id: "setup", name: "Setup", description: "Connect your school and AI apps.", requires: "Local command access and Chrome or Edge.", guide: "references/setup.md" },
] as const;

function updateLaunch() {
  const launch = selfCommand(["update"]);
  if (process.env.AMICOOKED_HOME) launch.env = { ...launch.env, AMICOOKED_HOME: process.env.AMICOOKED_HOME };
  return launch;
}

export function featureInfo(id?: string) {
  if (!id) return { version: VERSION, features: FEATURES };
  const feature = FEATURES.find(f => f.id === id);
  if (!feature) throw new Error(`Unknown feature: ${id}. Run \`amicooked features\` to list them.`);
  return {
    version: VERSION, ...feature, instructions: SKILL_FILES[feature.guide],
    ...(id === "updates" ? { updateCommand: updateLaunch(), weeklyUpdatesRequested: getConfig().weeklyUpdates ?? null } : {}),
  };
}

export function featuresCommand(id?: string, json = false): number {
  const info = featureInfo(id);
  if (json) console.log(JSON.stringify(info, null, 2));
  else if ("instructions" in info) {
    console.log(`${info.name} · Am I Cooked ${VERSION}\n\n${info.instructions}`);
    if ("updateCommand" in info) console.log(`This install's update command:\n${JSON.stringify(info.updateCommand, null, 2)}`);
  } else {
    console.log(`Am I Cooked ${VERSION}\n`);
    for (const f of info.features) console.log(`${f.id}: ${f.description}\n  Needs: ${f.requires}`);
    console.log("\nRead a guide: amicooked features <id>");
  }
  return 0;
}

/** Refresh skills without rewriting MCP configuration, restarting apps or repeating login. */
export function refreshSkills(home = os.homedir()): string[] {
  const dirs = [...new Set([path.join(paths().home, "skill"), ...[skillPath(home), codexSkillPath(home)].filter(fs.existsSync).map(f => path.dirname(f)), ...(getConfig().skillDirs ?? [])])];
  const results = dirs.map(dir => `${dir}: ${installSkillBundle(dir)}`);
  const weeklyFiles = {
    "SKILL.md": `---\nname: amicooked-updates\ndescription: Update Am I Cooked and summarize new features, including its opted-in weekly update task.\n---\n\n${SKILL_FILES["references/updates.md"]}\n\nThis installation's command (executable, arguments and optional environment):\n\n\`\`\`json\n${JSON.stringify(updateLaunch(), null, 2)}\n\`\`\`\n`,
  };
  for (const dir of dirs) {
    const weeklyDir = dir === dirs[0] ? path.join(paths().home, "update-skill") : path.join(path.dirname(dir), "amicooked-updates");
    if (getConfig().weeklyUpdates) installSkillBundle(weeklyDir, weeklyFiles);
    else if (fs.existsSync(weeklyDir)) fs.rmSync(weeklyDir, { recursive: true });
  }
  writePrivateFile(path.join(paths().home, "installed-version.json"), JSON.stringify({ version: VERSION }) + "\n");
  return results;
}

export function installedSkillVersion(): string | null {
  const file = path.join(paths().home, "installed-version.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")).version ?? null;
}

/** Remove our generated guides, retaining custom files and backups in explicit destinations. */
export function removeExtraSkills(home = os.homedir()): void {
  const dirs = [path.join(paths().home, "skill"), ...(getConfig().skillDirs ?? [])];
  for (const dir of dirs) {
    for (const [name, text] of Object.entries(SKILL_FILES)) {
      const file = path.join(dir, name);
      if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) fs.rmSync(file);
    }
  }
  const weeklyDirs = [path.join(home, ".agents/skills/amicooked-updates"), path.join(home, ".claude/skills/amicooked-updates"), path.join(paths().home, "update-skill"), ...(getConfig().skillDirs ?? []).map(dir => path.join(path.dirname(dir), "amicooked-updates"))];
  for (const dir of weeklyDirs) fs.rmSync(dir, { recursive: true, force: true });
}

export const getFeatureGuide: Tool = {
  name: "get_feature_guide",
  description: "List shipped Am I Cooked features, or read one feature's bundled guide. No network, setup or updates are performed.",
  schema: { feature: z.enum(FEATURES.map(f => f.id) as [string, ...string[]]).optional() },
  handler: async ({ feature }: { feature?: string }) => JSON.stringify(featureInfo(feature), null, 2),
};
