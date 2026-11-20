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
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(path.dirname(file), name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return existed ? "updated" : "added";
}
