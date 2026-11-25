import * as fs from "fs";
import * as path from "path";
import { createHash } from "node:crypto";
import { SKILL_FILES } from "../skill.js";
import type { WriteResult } from "./claudeDesktop.js";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const manifestName = ".amicooked-managed.json";

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
  const manifest = path.join(dir, manifestName);
  if (!changed.length && fs.existsSync(manifest)) return "unchanged";
  let backup: string | undefined;
  for (const [name, text] of changed) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      if (!backup) {
        const root = path.join(dir, ".backups");
        fs.mkdirSync(root, { recursive: true });
        backup = fs.mkdtempSync(path.join(root, "refresh-"));
      }
      fs.mkdirSync(path.dirname(path.join(backup, name)), { recursive: true });
      fs.copyFileSync(file, path.join(backup, name));
    }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }
  const hashes = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, digest(text)]));
  fs.writeFileSync(manifest, JSON.stringify(hashes));
  return changed.length ? (existed ? "updated" : "added") : "unchanged";
}

/** Remove only unmodified managed content; retain edits and backups. */
export function removeSkillBundle(dir: string, files = SKILL_FILES): WriteResult {
  if (!fs.existsSync(dir)) return "absent";
  let hashes: Record<string, string> = {};
  try { hashes = JSON.parse(fs.readFileSync(path.join(dir, manifestName), "utf8")); } catch { /* Older installs have no manifest. */ }
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const current = fs.readFileSync(file, "utf8");
    if (current === text || digest(current) === hashes?.[name]) fs.rmSync(file);
  }
  fs.rmSync(path.join(dir, manifestName), { force: true });
  return "removed";
}
