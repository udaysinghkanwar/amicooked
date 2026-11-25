import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LoginPendingError } from "./auth.js";
import { amICookedTool } from "./tools/cooked.js";
import { getAnnouncements, getMyCourses, getMyGrades } from "./tools/courses.js";
import { getCourseContent } from "./tools/content.js";
import { getAssignments, getUpcomingDueDates } from "./tools/deadlines.js";
import { downloadFileTool, readFileTool } from "./tools/files.js";
import type { Tool } from "./tools/types.js";
import { VERSION } from "./version.js";

export const TOOLS: Tool[] = [
  amICookedTool,
  getMyCourses,
  getMyGrades,
  getUpcomingDueDates,
  getAnnouncements,
  getAssignments,
  getCourseContent,
  downloadFileTool,
  readFileTool,
];

export function createServer(options: { instructions?: string } = {}): McpServer {
  const server = new McpServer({ name: "amicooked", version: VERSION }, { instructions: options.instructions });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema, annotations: { readOnlyHint: true, openWorldHint: false } },
      async (args: unknown) => {
        const started = Date.now();
        try {
          const text = await tool.handler(args ?? {});
          console.error(`[tool] ${tool.name} ok (${Date.now() - started}ms)`);
          return { content: [{ type: "text" as const, text }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[tool] ${tool.name} failed (${Date.now() - started}ms): ${message}`);
          // Report errors as results so the AI can relay them, e.g. "sign in, then ask again"
          const text = error instanceof LoginPendingError ? message : `Error: ${message}`;
          return { content: [{ type: "text" as const, text }], isError: true };
        }
      }
    );
  }
  return server;
}
