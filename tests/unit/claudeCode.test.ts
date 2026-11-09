import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installClaudeCode, installSkill, skillPath, uninstallSkill } from "../../src/clients/claudeCode.js";
import { SKILL_MD } from "../../src/skill.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("Claude Code", () => {
  it("replaces any old entry and adds one at user scope", () => {
    const calls: string[][] = [];
    const run = (args: string[]) => (calls.push(args), { status: 0, stdout: "", stderr: "", error: undefined });
    installClaudeCode({ command: "/usr/bin/npx", args: ["-y", "amicooked@0", "mcp"], env: { PATH: "/usr/bin" } }, run);
    expect(calls).toEqual([
      ["mcp", "remove", "amicooked", "-s", "user"],
      ["mcp", "add", "amicooked", "-s", "user", "-e", "PATH=/usr/bin", "--", "/usr/bin/npx", "-y", "amicooked@0", "mcp"],
    ]);
  });

  it("reports a failed add", () => {
    const run = (args: string[]) => ({ status: args[1] === "add" ? 1 : 0, stdout: "", stderr: "nope", error: undefined });
    expect(() => installClaudeCode({ command: "x", args: [] }, run)).toThrow(/nope/);
  });

  it("installs the skill once and removes it cleanly", () => {
    expect(installSkill(home)).toBe("added");
    expect(fs.readFileSync(skillPath(home), "utf8")).toBe(SKILL_MD);
    expect(installSkill(home)).toBe("unchanged");
    expect(uninstallSkill(home)).toBe("removed");
    expect(fs.existsSync(skillPath(home))).toBe(false);
  });
});
