import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { LaunchCommand } from "./self.js";

export interface HttpConnection { url: string; headers: Record<string, string> }
export type McpConnection = LaunchCommand | HttpConnection;
export interface McpCheck { tools: number; live: boolean }

/** Test the configured endpoint/process. This does not establish host-session permissions. */
export async function checkMcp(connection: McpConnection, live = false, timeout = 15000): Promise<McpCheck> {
  const client = new Client({ name: "amicooked-doctor", version: "1" });
  const transport = "url" in connection
    ? new StreamableHTTPClientTransport(new URL(connection.url), { requestInit: { headers: connection.headers } })
    : new StdioClientTransport({
      command: connection.command,
      args: connection.args,
      env: { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)), ...connection.env },
      stderr: "pipe",
    });
  if (transport instanceof StdioClientTransport) transport.stderr?.on("data", () => {});
  try {
    await client.connect(transport, { timeout });
    if (client.getServerVersion()?.name !== "amicooked") throw new Error("Configured connection did not start Am I Cooked.");
    const { tools } = await client.listTools({}, { timeout });
    const expected = ["am_i_cooked", "get_my_courses", "get_my_grades", "get_upcoming_due_dates", "get_announcements", "get_assignments", "get_course_content", "download_file", "read_file"];
    if (!expected.every((name) => tools.some((t) => t.name === name && t.annotations?.readOnlyHint))) throw new Error("The MCP server did not expose all nine read-only course tools.");
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
