import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { VERSION } from "../../src/version.js";
import { serverInstructions } from "../../src/instructions.js";
import * as updater from "../../src/cli/autoUpdate.js";

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ instructions: serverInstructions() }).connect(serverTransport);
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
    expect(JSON.stringify(guide.content)).toContain("Automatic patch updates");
    await client.close();
  });

  it("limits local update probes across connections without blocking tools", async () => {
    const check = vi.spyOn(updater, "maybeStartAutomaticUpdate").mockReturnValue(false);
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const client = await connect();
    const secondClient = await connect();
    try {
      expect(check).not.toHaveBeenCalled();
      const request = { name: "get_feature_guide", arguments: {} };
      expect((await client.callTool(request)).isError).not.toBe(true);
      expect(check).toHaveBeenCalledOnce();
      clock.mockReturnValue(60_999);
      expect((await secondClient.callTool(request)).isError).not.toBe(true);
      expect(check).toHaveBeenCalledOnce();
      clock.mockReturnValue(61_000);
      expect((await client.callTool(request)).isError).not.toBe(true);
      expect(check).toHaveBeenCalledTimes(2);
    } finally {
      check.mockRestore();
      clock.mockRestore();
      await client.close();
      await secondClient.close();
    }
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
