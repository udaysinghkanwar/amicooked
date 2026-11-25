import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { serverInstructions, toolGuide } from "../../src/instructions.js";
import { TOOLS } from "../../src/server.js";

// Tool descriptions ride along in every conversation, even ones that never use Am I Cooked, so they stay short.
// Longer guidance goes in a tool's result (only paid for when the tool is called), written once in SKILL.md.
const DESCRIPTION_MAX = 450;
const GUIDE_MAX = 1600;

describe("guidance for the AI", () => {
  it("keeps every tool description short", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length, `${tool.name} description is ${tool.description.length} chars`).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it("only marks SKILL.md sections for tools that exist, and closes each one", () => {
    const skill = readFileSync("skill/SKILL.md", "utf8");
    const names = TOOLS.map((t) => t.name);
    for (const [, name] of skill.matchAll(/<!-- tool:([a-z_]+) -->/g)) {
      expect(names, `<!-- tool:${name} --> has no matching tool`).toContain(name);
      expect(skill, `<!-- tool:${name} --> is never closed`).toContain(`<!-- /tool:${name} -->`);
      expect(toolGuide(name).length, `${name} guide is too long`).toBeLessThanOrEqual(GUIDE_MAX);
    }
  });

  it("gives am_i_cooked its presentation guide, also sent as server instructions", () => {
    const guide = toolGuide("am_i_cooked");
    expect(guide).toContain("showFirst");
    expect(guide).toContain("Course | Grade so far | Still to come | Next due | Status");
    expect(guide).not.toMatch(/<!--/);
    expect(serverInstructions()).toContain(guide);
  });
});
