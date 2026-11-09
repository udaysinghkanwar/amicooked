import { SKILL_MD } from "./skill.js";

/** The part of SKILL.md meant for any AI using the tools, sent as the MCP server instructions. */
export function serverInstructions(): string {
  const match = SKILL_MD.match(/<!-- server-instructions -->([\s\S]*?)<!-- \/server-instructions -->/);
  return (match?.[1] ?? "").trim();
}
