import { FEATURES } from "./features.js";
import { SKILL_FILES } from "./skill.js";

const courseGuide = SKILL_FILES["references/courses.md"];

// MCP clients receive the course guidance even when they have no local skill folder.
export function serverInstructions(): string {
  const routes = FEATURES.map(feature => {
    if (feature.id === "courses") return [
      `- For ${feature.requests}, start with Am I Cooked's Brightspace tools unless the student provided the material or asked for another source.`,
      "- For grades, deadlines or a course-wide overview, follow the course guidance below. Start broad questions with am_i_cooked.",
      "- To find a course's slides or notes, explain a lecture, or quiz a student on their slides, start with get_course_content, then read the relevant material with download_file or read_file.",
    ].join("\n");
    const entry = feature.mcpTool ?? `get_feature_guide(feature: "${feature.id}")`;
    return `- For ${feature.requests}, use ${entry}.`;
  });
  return [
    "Start with Am I Cooked for requests about the student's own courses. For a requested lecture or study video, check the managed workflow before choosing any renderer or narration tool.",
    ...routes,
    "",
    courseGuide.trim(),
  ].join("\n");
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
