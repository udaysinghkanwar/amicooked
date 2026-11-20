// Embeds the skill and its optional guide separately, and serves the same files on the site.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";

const skill = readFileSync(new URL("../skill/SKILL.md", import.meta.url), "utf8");
const guide = readFileSync(new URL("../skill/references/lecture-videos.md", import.meta.url), "utf8");

writeFileSync(
  new URL("../src/skill.ts", import.meta.url),
  `// Generated from skill/ by scripts/sync-skill.mjs. Don't edit by hand.\nexport const SKILL_MD = ${JSON.stringify(skill)};\nexport const LECTURE_VIDEO_GUIDE_MD = ${JSON.stringify(guide)};\n`
);

if (existsSync(new URL("../site/", import.meta.url))) {
  writeFileSync(new URL("../site/SKILL.md", import.meta.url), skill);
  mkdirSync(new URL("../site/references/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../site/references/lecture-videos.md", import.meta.url), guide);
  for (const name of ["install.sh", "install.ps1"]) {
    copyFileSync(new URL(`../install/${name}`, import.meta.url), new URL(`../site/${name}`, import.meta.url));
  }
}
