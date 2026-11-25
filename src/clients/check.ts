import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface HttpConnection { url: string; headers: Record<string, string> }
/** Test the configured endpoint/process. This does not establish host-session permissions. */
export async function checkMcp(connection: HttpConnection, live = false, timeout = 15000): Promise<number> {
  const client = new Client({ name: "amicooked-doctor", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), { requestInit: { headers: connection.headers } });
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
    return tools.length;
  } finally {
    await client.close();
  }
}
