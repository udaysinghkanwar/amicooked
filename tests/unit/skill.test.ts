import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "fs";
import * as os from "os";
import * as path from "path";
import { FEATURES } from "../../src/features.js";
import { serverInstructions } from "../../src/instructions.js";
import { SKILL_MD, SKILL_FILES } from "../../src/skill.js";
import { skillBundleIs } from "../../src/clients/skillFiles.js";
import { installSkill, skillPath, uninstallSkill } from "../../src/clients/claudeCode.js";
import { installCodexSkill, codexSkillPath, uninstallCodexSkill } from "../../src/clients/codex.js";
import { installGeminiSkill, geminiSkillPath, uninstallGeminiSkill } from "../../src/clients/gemini.js";

const videoGuide = readFileSync("skill/references/lecture-videos.md", "utf8");

describe("skill", () => {
  it("is in sync everywhere it ships (run `npm run sync:skill`)", () => {
    for (const [name, text] of Object.entries(SKILL_FILES)) {
      expect(readFileSync(`skill/${name}`, "utf8")).toBe(text);
      expect(readFileSync(`site/${name}`, "utf8")).toBe(text);
    }
    const guide = readFileSync("skill/references/lecture-videos.md", "utf8");
    expect(SKILL_MD).not.toContain(guide);
    expect(serverInstructions()).not.toContain(guide);
  });

  it("routes every shipped feature from the catalog in both the skill and MCP instructions", () => {
    for (const feature of FEATURES) {
      expect(SKILL_MD).toContain(`[${feature.name}](${feature.guide})`);
      expect(SKILL_FILES[feature.guide]).toBeTruthy();
      expect(SKILL_MD).toContain(feature.requests);
      expect(serverInstructions()).toContain(feature.requests);
      if (feature.mcpTool) expect(SKILL_MD).toContain(feature.mcpTool);
    }
  });

  it("serves the same install scripts the repo ships", () => {
    for (const name of ["install.sh", "install.ps1"]) {
      if (existsSync(`site/${name}`)) expect(readFileSync(`site/${name}`, "utf8")).toBe(readFileSync(`install/${name}`, "utf8"));
    }
  });

  it("gives the server instructions without the setup section", () => {
    const instructions = serverInstructions();
    expect(instructions).toContain("am_i_cooked");
    expect(instructions).not.toContain("amicooked setup");
  });
});

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe.each([
  { name: "Claude Code", install: installSkill, file: skillPath, uninstall: uninstallSkill },
  { name: "Codex", install: installCodexSkill, file: codexSkillPath, uninstall: uninstallCodexSkill },
  { name: "Gemini", install: installGeminiSkill, file: geminiSkillPath, uninstall: uninstallGeminiSkill },
])("$name skill reference", ({ install, file, uninstall }) => {
  function fixture() {
    const home = mkdtempSync(path.join(os.tmpdir(), "amicooked-skill-"));
    homes.push(home);
    const entry = file(home);
    return { home, entry, guide: path.join(path.dirname(entry), "references", "lecture-videos.md") };
  }

  it("installs both files, is idempotent, and removes the reference on uninstall", () => {
    const { home, entry, guide } = fixture();
    expect(install(home)).toBe("added");
    const router = readFileSync(entry, "utf8");
    const link = router.match(/\]\((references\/lecture-videos\.md)\)/)?.[1];
    expect(link).toBeDefined();
    expect(readFileSync(path.resolve(path.dirname(entry), link!), "utf8")).toBe(videoGuide);
    expect(skillBundleIs(path.dirname(entry))).toBe(true);
    expect(install(home)).toBe("unchanged");
    expect(uninstall(home)).toBe("removed");
    expect(existsSync(guide)).toBe(false);
  });

  it("repairs a missing reference even when the main skill is current", () => {
    const { home, entry, guide } = fixture();
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, SKILL_MD);
    const note = path.join(path.dirname(entry), "student-notes.md");
    writeFileSync(note, "Keep this note.");
    expect(skillBundleIs(path.dirname(entry))).toBe(false);
    expect(install(home)).toBe("updated");
    expect(readFileSync(guide, "utf8")).toBe(videoGuide);
    expect(readFileSync(note, "utf8")).toBe("Keep this note.");
    expect(install(home)).toBe("unchanged");
  });

  it("updates an outdated reference independently of the main skill", () => {
    const { home, entry, guide } = fixture();
    install(home);
    writeFileSync(guide, "An older workflow.");
    expect(skillBundleIs(path.dirname(entry))).toBe(false);
    expect(install(home)).toBe("updated");
    expect(readFileSync(guide, "utf8")).toBe(videoGuide);
    expect(skillBundleIs(path.dirname(entry))).toBe(true);
    const backups = path.join(path.dirname(entry), ".backups");
    expect(readdirSync(backups).some(name => {
      const saved = path.join(backups, name, "references/lecture-videos.md");
      return existsSync(saved) && readFileSync(saved, "utf8") === "An older workflow.";
    })).toBe(true);
    const custom = path.join(path.dirname(entry), "my-notes.md");
    writeFileSync(custom, "Keep my notes");
    uninstall(home);
    expect(readFileSync(custom, "utf8")).toBe("Keep my notes");
    expect(existsSync(backups)).toBe(true);
  });
});
