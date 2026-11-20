import * as fs from "fs";
import * as path from "path";
import { SKILL_FILES } from "../skill.js";
import type { WriteResult } from "./claudeDesktop.js";

export function skillBundleIs(dir: string, files = SKILL_FILES): boolean {
  return Object.entries(files).every(([name, text]) => {
    const file = path.join(dir, name);
    return fs.existsSync(file) && fs.readFileSync(file, "utf8") === text;
  });
}

/** Install every bundled reference; retain changed files and leave unrelated files alone. */
export function installSkillBundle(dir: string, files = SKILL_FILES): WriteResult {
  const existed = fs.existsSync(path.join(dir, "SKILL.md"));
  const changed = Object.entries(files).filter(([name, text]) => {
    const file = path.join(dir, name);
    return !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text;
  });
  if (!changed.length) return "unchanged";
  const backup = path.join(dir, ".backups", `${Date.now()}-${process.pid}`);
  for (const [name, text] of changed) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(path.join(backup, name)), { recursive: true });
      fs.copyFileSync(file, path.join(backup, name));
    }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }
  return existed ? "updated" : "added";
}
