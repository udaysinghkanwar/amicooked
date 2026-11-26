// Embed the skill bundle in the binary and mirror it and the installers to the site.
import { copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import catalog from "../src/feature-catalog.json" with { type: "json" };

function readTree(dir, prefix = "") {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = prefix + entry.name;
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    return entry.isDirectory() ? Object.entries(readTree(url, name + "/")) : [[name, readFileSync(url, "utf8")]];
  }));
}

const skill = new URL("../skill/SKILL.md", import.meta.url);
const router = readFileSync(skill, "utf8");
const features = Object.values(catalog);
const routes = features.map(feature => {
  const guide = `[${feature.name}](${feature.guide})`;
  const mcp = feature.mcpTool ? ` Start with \`${feature.mcpTool}\` if the MCP tool is available.` : "";
  return `- **${guide}** for ${feature.requests}.${mcp}`;
});
const builtRouter = router
  .replace(/^description: .*$/m, () => `description: ${JSON.stringify(`Use Am I Cooked for ${features.map(feature => feature.requests).join(" | ")}. Scope school help to the student’s own courses or materials.`)}`)
  .replace(/(<!-- feature-routes:start -->)[\s\S]*?(<!-- feature-routes:end -->)/, (_match, start, end) =>
    [start, ...routes, end].join("\n"));
if (router !== builtRouter) writeFileSync(skill, builtRouter);

const files = readTree(new URL("../skill/", import.meta.url));

writeFileSync(
  new URL("../src/skill.ts", import.meta.url),
  `// Generated from skill/ by scripts/sync-skill.mjs. Don't edit by hand.\nexport const SKILL_FILES: Record<string, string> = ${JSON.stringify(files, null, 2)};\nexport const SKILL_MD = SKILL_FILES["SKILL.md"];\n`
);

if (existsSync(new URL("../site/", import.meta.url))) {
  for (const [name, text] of Object.entries(files)) {
    const target = new URL(`../site/${name}`, import.meta.url);
    mkdirSync(new URL(".", target), { recursive: true });
    writeFileSync(target, text);
  }
  for (const name of ["install.sh", "install.ps1"]) {
    copyFileSync(new URL(`../install/${name}`, import.meta.url), new URL(`../site/${name}`, import.meta.url));
  }
}
