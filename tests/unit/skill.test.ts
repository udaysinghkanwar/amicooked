import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import * as os from "os";
import * as path from "path";
import { serverInstructions } from "../../src/instructions.js";
import { LECTURE_VIDEO_GUIDE_MD, SKILL_MD } from "../../src/skill.js";
import { skillIsCurrent } from "../../src/clients/skill.js";
import { installSkill, skillPath, uninstallSkill } from "../../src/clients/claudeCode.js";
import { installCodexSkill, codexSkillPath, uninstallCodexSkill } from "../../src/clients/codex.js";

const source = readFileSync("skill/SKILL.md", "utf8");

describe("skill", () => {
  it("is in sync everywhere it ships (run `npm run sync:skill`)", () => {
    expect(SKILL_MD).toBe(source);
    if (existsSync("site/SKILL.md")) expect(readFileSync("site/SKILL.md", "utf8")).toBe(source);
    const guide = readFileSync("skill/references/lecture-videos.md", "utf8");
    expect(LECTURE_VIDEO_GUIDE_MD).toBe(guide);
    expect(readFileSync("site/references/lecture-videos.md", "utf8")).toBe(guide);
    expect(SKILL_MD).not.toContain(guide);
    expect(serverInstructions()).not.toContain(guide);
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
    expect(readFileSync(entry, "utf8")).toBe(SKILL_MD);
    expect(readFileSync(guide, "utf8")).toBe(LECTURE_VIDEO_GUIDE_MD);
    expect(skillIsCurrent(entry)).toBe(true);
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
    expect(skillIsCurrent(entry)).toBe(false);
    expect(install(home)).toBe("updated");
    expect(readFileSync(guide, "utf8")).toBe(LECTURE_VIDEO_GUIDE_MD);
    expect(readFileSync(note, "utf8")).toBe("Keep this note.");
    expect(install(home)).toBe("unchanged");
  });

  it("updates an outdated reference independently of the main skill", () => {
    const { home, entry, guide } = fixture();
    install(home);
    writeFileSync(guide, "An older workflow.");
    expect(skillIsCurrent(entry)).toBe(false);
    expect(install(home)).toBe("updated");
    expect(readFileSync(guide, "utf8")).toBe(LECTURE_VIDEO_GUIDE_MD);
    expect(skillIsCurrent(entry)).toBe(true);
  });
});
