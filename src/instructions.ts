import { SKILL_FILES } from "./skill.js";

const courseGuide = SKILL_FILES["references/courses.md"];

// MCP clients receive the course guidance even when they have no local skill folder.
export function serverInstructions(): string {
  return courseGuide.trim();
}

/**
 * A section of the course guide marked `<!-- tool:NAME -->`, returned inside that tool's result. Some apps (Claude Desktop)
 * never show a local server's instructions to the model, but every app shows tool results, so guidance that must
 * always hold travels this way. The course guide is the source for both.
 */
export function toolGuide(tool: string): string {
  const match = courseGuide.match(new RegExp(`<!-- tool:${tool} -->([\\s\\S]*?)<!-- /tool:${tool} -->`));
  return (match?.[1] ?? "").trim();
}
