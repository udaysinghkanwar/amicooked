import { SKILL_MD } from "./skill.js";

/** The part of SKILL.md meant for any AI using the tools, sent as the MCP server instructions. */
export function serverInstructions(): string {
  const match = SKILL_MD.match(/<!-- server-instructions -->([\s\S]*?)<!-- \/server-instructions -->/);
  return (match?.[1] ?? "").trim();
}

/**
 * A section of SKILL.md marked `<!-- tool:NAME -->`, returned inside that tool's result. Some apps (Claude Desktop)
 * never show a local server's instructions to the model, but every app shows tool results, so guidance that must
 * always hold travels this way. SKILL.md stays the one place it's written.
 */
export function toolGuide(tool: string): string {
  const match = SKILL_MD.match(new RegExp(`<!-- tool:${tool} -->([\\s\\S]*?)<!-- /tool:${tool} -->`));
  return (match?.[1] ?? "").trim();
}
