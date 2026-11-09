import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { serverInstructions } from "../../src/instructions.js";
import { SKILL_MD } from "../../src/skill.js";

const source = readFileSync("skill/SKILL.md", "utf8");

describe("skill", () => {
  it("is in sync everywhere it ships (run `npm run sync:skill`)", () => {
    expect(SKILL_MD).toBe(source);
    if (existsSync("site/SKILL.md")) expect(readFileSync("site/SKILL.md", "utf8")).toBe(source);
  });

  it("gives the server instructions without the setup section", () => {
    const instructions = serverInstructions();
    expect(instructions).toContain("am_i_cooked");
    expect(instructions).not.toContain("amicooked setup");
  });
});
