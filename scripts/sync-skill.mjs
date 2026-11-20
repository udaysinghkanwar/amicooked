// Copies skill/SKILL.md into src/skill.ts (so the binary carries it), and the skill
// and install scripts into site/ so the website serves the same files.
import { copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";

function readTree(dir, prefix = "") {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = prefix + entry.name;
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    return entry.isDirectory() ? Object.entries(readTree(url, name + "/")) : [[name, readFileSync(url, "utf8")]];
  }));
}

const files = readTree(new URL("../skill/", import.meta.url));

const skill = readFileSync(new URL("../skill/SKILL.md", import.meta.url), "utf8");

writeFileSync(
  new URL("../src/skill.ts", import.meta.url),
  `// Generated from skill/ by scripts/sync-skill.mjs. Don't edit by hand.\nexport const SKILL_FILES: Record<string, string> = ${JSON.stringify(files, null, 2)};\nexport const SKILL_MD = SKILL_FILES["SKILL.md"];\n`
);

if (existsSync(new URL("../site/", import.meta.url))) {
  writeFileSync(new URL("../site/SKILL.md", import.meta.url), skill);
  for (const [name, text] of Object.entries(files)) {
    const target = new URL(`../site/${name}`, import.meta.url);
    mkdirSync(new URL(".", target), { recursive: true });
    writeFileSync(target, text);
  }
  for (const name of ["install.sh", "install.ps1"]) {
    copyFileSync(new URL(`../install/${name}`, import.meta.url), new URL(`../site/${name}`, import.meta.url));
  }
}
