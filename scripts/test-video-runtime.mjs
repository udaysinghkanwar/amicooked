// Native runtime acceptance for the lecture feature; never touches school/user config.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const target = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
if (!process.argv.includes("--existing-native")) execFileSync(process.execPath, ["scripts/build-binaries.mjs", target], { stdio: "inherit" });
const binary = path.resolve(`build/amicooked-${target}${process.platform === "win32" ? ".exe" : ""}`);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-native-video-"));
const env = { ...process.env, HOME: root, USERPROFILE: root, AMICOOKED_HOME: path.join(root, ".amicooked"), AMICOOKED_NO_TELEMETRY: "1" };
const run = args => execFileSync(binary, args, { cwd: root, env, encoding: "utf8", timeout: 30000 });
let client;
try {
 assert.match(run(["--version"]).trim(), /^\d+\.\d+\.\d+$/);
 for (const name of ["break-even", "breadth-first", "petri-net"]) {
  const spec = JSON.parse(run(["video", "example", name]));
  assert(spec.scenes.length > 0);assert(spec.sources.length > 0);
 }
 client = new Client({ name: "native-video-acceptance", version: "1" });
 await client.connect(new StdioClientTransport({ command: binary, args: ["mcp"], env }));
 assert((await client.listTools()).tools.some(t => t.name === "get_lecture_video_guide"));
 const guide = await client.callTool({ name: "get_lecture_video_guide", arguments: {} });
 assert.notEqual(guide.isError, true);assert.match(guide.content[0].text, /fully cooked/);
 const absent = await client.callTool({ name: "read_file", arguments: { file: "not-downloaded.txt" } });
 assert.equal(absent.isError, true);
 console.log("Native lecture runtime passed: executable startup, all examples, MCP guide and file-access error handling.");
} finally { await client?.close();fs.rmSync(root, { recursive: true, force: true }); }
