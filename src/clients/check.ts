import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { LaunchCommand } from "./self.js";

export interface McpCheck { tools: number; live: boolean }

/** Exercise the configured executable, not an in-process server. No model or API key needed. */
export async function checkMcp(launch: LaunchCommand, live = false, timeout = 15000): Promise<McpCheck> {
  const client = new Client({ name: "amicooked-doctor", version: "1" });
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)), ...launch.env },
    stderr: "pipe",
  });
  // Stderr may include school tool errors; don't echo private data in setup diagnostics.
  transport.stderr?.on("data", () => {});
  try {
    await client.connect(transport, { timeout });
    if (client.getServerVersion()?.name !== "amicooked") throw new Error("Configured command did not start Am I Cooked.");
    const { tools } = await client.listTools({}, { timeout });
    const expected = ["am_i_cooked", "get_my_courses", "get_my_grades", "get_upcoming_due_dates", "get_announcements", "get_assignments", "get_course_content", "download_file", "read_file"];
    if (!expected.every((name) => tools.some((t) => t.name === name && t.annotations?.readOnlyHint))) {
      throw new Error("The MCP server did not expose all nine read-only course tools.");
    }
    if (!client.getInstructions()?.includes("am_i_cooked")) throw new Error("MCP usage instructions are missing.");
    if (live) {
      const result = await client.callTool({ name: "get_my_courses", arguments: {} }, undefined, { timeout: 60000 });
      if (result.isError) throw new Error("School access failed. Run `amicooked login`, then retry doctor --live.");
    }
    return { tools: tools.length, live };
  } finally {
    await client.close();
    await transport.close();
  }
}
