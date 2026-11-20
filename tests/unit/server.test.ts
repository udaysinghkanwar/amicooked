import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { VERSION } from "../../src/version.js";
import { serverInstructions } from "../../src/instructions.js";
import { LECTURE_VIDEO_GUIDE_MD } from "../../src/skill.js";

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ instructions: serverInstructions() }).connect(serverTransport);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientTransport);
  return client;
}

describe("server", () => {
  it("lists the course tools and on-demand guide as read-only", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "am_i_cooked", "get_my_courses", "get_my_grades", "get_upcoming_due_dates", "get_announcements",
      "get_assignments", "get_course_content", "download_file", "read_file", "get_lecture_video_guide",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("keeps the guide out of initialization and retrieves it on demand over MCP", async () => {
    const client = await connect();
    expect(client.getInstructions()).toContain("get_lecture_video_guide");
    expect(client.getInstructions()).not.toContain(LECTURE_VIDEO_GUIDE_MD);
    const result = await client.callTool({ name: "get_lecture_video_guide", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: LECTURE_VIDEO_GUIDE_MD }]);
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
