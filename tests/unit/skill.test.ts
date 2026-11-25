import os from "node:os";
import path from "node:path";
import { installSkill, skillPath } from "../../src/clients/claudeCode.js";
import { installCodexSkill, codexSkillPath } from "../../src/clients/codex.js";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { serverInstructions } from "../../src/instructions.js";
import { SKILL_MD } from "../../src/skill.js";

const source = readFileSync("skill/SKILL.md", "utf8");

describe("skill", () => {
  it("is in sync everywhere it ships (run `npm run sync:skill`)", () => {
    expect(SKILL_MD).toBe(source);
    if (existsSync("site/SKILL.md")) expect(readFileSync("site/SKILL.md", "utf8")).toBe(source);
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

// A fresh install receives the complete workflow using the existing single-file installers.
it("ships first-use video guidance to both local skill clients without adding MCP startup context", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "amicooked-skill-only-"));
  try {
    installSkill(home);
    installCodexSkill(home);
    for (const file of [skillPath(home), codexSkillPath(home)]) {
      const installed = readFileSync(file, "utf8");
      expect(installed).toBe(source);
      expect(installed).toContain("voice_test.py");
      expect(installed).toContain("browser ensure");
      expect(installed).toContain("model-files-v1.1");
    }
    expect(serverInstructions()).not.toContain("voice_test.py");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
