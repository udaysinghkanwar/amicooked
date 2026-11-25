import * as fs from "fs";
import * as path from "path";
import { LECTURE_VIDEO_GUIDE_MD, SKILL_MD } from "../skill.js";
import type { WriteResult } from "./claudeDesktop.js";

const files = { "SKILL.md": SKILL_MD, "references/lecture-videos.md": LECTURE_VIDEO_GUIDE_MD };

/** Check the whole installed skill, including references that an older setup may lack. */
export function skillIsCurrent(file: string): boolean {
  return Object.entries(files).every(([name, text]) => {
    const target = path.join(path.dirname(file), name);
    return fs.existsSync(target) && fs.readFileSync(target, "utf8") === text;
  });
}

export function installSkillFiles(file: string): WriteResult {
  const existed = fs.existsSync(file);
  if (skillIsCurrent(file)) return "unchanged";
  const backupRoot = path.join(path.dirname(file), ".backups");
  let backup: string | undefined;
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(path.dirname(file), name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) {
      if (fs.readFileSync(target, "utf8") === text) continue;
      if (!backup) {
        fs.mkdirSync(backupRoot, { recursive: true });
        backup = fs.mkdtempSync(path.join(backupRoot, "refresh-"));
      }
      const saved = path.join(backup, name);
      fs.mkdirSync(path.dirname(saved), { recursive: true });
      fs.copyFileSync(target, saved);
    }
    fs.writeFileSync(target, text);
  }
  return existed ? "updated" : "added";
}

/** Disconnect managed files while retaining personal instructions and backups. */
export function removeSkillFiles(file: string): WriteResult {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) return "absent";
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(dir, name);
    if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === text) fs.rmSync(target);
  }
  return "removed";
}
