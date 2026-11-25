// Copies skill/SKILL.md into src/skill.ts (so the binary carries it), and the skill
// and install scripts into site/ so the website serves the same files.
import { copyFileSync, readFileSync, writeFileSync, existsSync } from "fs";

const skill = readFileSync(new URL("../skill/SKILL.md", import.meta.url), "utf8");

writeFileSync(
  new URL("../src/skill.ts", import.meta.url),
  `// Generated from skill/SKILL.md by scripts/sync-skill.mjs. Don't edit by hand.\nexport const SKILL_MD = ${JSON.stringify(skill)};\n`
);

if (existsSync(new URL("../site/", import.meta.url))) {
  writeFileSync(new URL("../site/SKILL.md", import.meta.url), skill);
  for (const name of ["install.sh", "install.ps1"]) {
    copyFileSync(new URL(`../install/${name}`, import.meta.url), new URL(`../site/${name}`, import.meta.url));
  }
}
