import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { VERSION } from "../../src/version.js";

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ instructions: "Start with am_i_cooked." }).connect(serverTransport);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientTransport);
  return client;
}

describe("server", () => {
  it("lists read-only course tools and bundled feature guides", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "am_i_cooked", "get_my_courses", "get_my_grades", "get_upcoming_due_dates", "get_announcements",
      "get_assignments", "get_course_content", "download_file", "read_file", "get_feature_guide",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("lets an MCP-only client discover features and read their bundled references", async () => {
    const client = await connect();
    const list = await client.callTool({ name: "get_feature_guide", arguments: {} });
    expect(JSON.stringify(list.content)).toContain("updates");
    const guide = await client.callTool({ name: "get_feature_guide", arguments: { feature: "updates" } });
    expect(guide.isError).not.toBe(true);
    expect(JSON.stringify(guide.content)).toContain("Optional weekly update routine");
    await client.close();
  });

  it("returns tool errors as results the AI can relay", async () => {
    const result = await (await connect()).callTool({ name: "read_file", arguments: { file: "nothing-here.pdf" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("No downloaded file");
  });

  it("matches the package version", () => {
    expect(VERSION).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);
  });
});
