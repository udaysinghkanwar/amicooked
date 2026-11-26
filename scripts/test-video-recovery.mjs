// Run against already prepared tools. The acceptance matrix supplies an isolated npm installation on each OS.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function testVideoRecovery({ command, prefix, env, project }) {
  const fixture = path.join(project, "cleanup-lock-hook.mjs");
  writeFileSync(fixture, `
    import fs from "node:fs";
    import cp from "node:child_process";
    import path from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    const rm = fs.rmSync;
    fs.rmSync = (file, options) => {
      if (/^(\\.amicooked-probe-|slides-|lecture-animation-)/.test(path.basename(String(file)))) {
        throw Object.assign(new Error("EBUSY: injected exhausted Windows cleanup lock"), { code: "EBUSY" });
      }
      return rm(file, options);
    };
    const spawn = cp.spawnSync;
    cp.spawnSync = (command, args, options) => {
      if (process.env.AMICOOKED_TEST_BROWSER_FAILURE === "1" && args?.includes("check") && args?.includes("--json")) {
        return { error: Object.assign(new Error("Injected browser-check timeout"), { code: "ETIMEDOUT" }), stdout: "", stderr: "", status: null };
      }
      return spawn(command, args, options);
    };
    syncBuiltinESMExports();
  `);
  const locked = { ...env, NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(fixture).href}`.trim() };
  const blocked = { ...locked, AMICOOKED_TEST_BROWSER_FAILURE: "1" };
  const cli = (environment, ...args) => execFileSync(command, [...prefix, ...args], {
    env: environment, cwd: project, encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(JSON.parse(cli(env, "video", "status")).state, "ready");
  const success = JSON.parse(cli(locked, "video", "probe", "--project", project));
  assert.equal(success.ok, true);
  assert.equal(success.warnings[0].errno, "EBUSY");
  console.log("Recovery acceptance: successful real probe preserved under a cleanup lock.");
  const failed = spawnSync(command, [...prefix, "video", "probe", "--project", project], {
    env: blocked, cwd: project, encoding: "utf8", timeout: 90_000,
  });
  assert.equal(failed.status, 1, failed.stderr);
  const probe = JSON.parse(failed.stdout);
  assert.equal(probe.reason, "browser-check-timeout");
  assert.equal(probe.warnings[0].errno, "EBUSY");
  console.log("Recovery acceptance: browser failure and cleanup warning both preserved.");

  const client = new Client({ name: "video-cleanup-recovery-acceptance", version: "1" });
  try {
    await client.connect(new StdioClientTransport({ command, args: [...prefix, "mcp"], cwd: project, env: blocked, stderr: "ignore" }));
    const call = async (name, args) => {
      const reply = await client.callTool({ name, arguments: args });
      assert.notEqual(reply.isError, true, `${name}: ${reply.content[0].text}`);
      return JSON.parse(reply.content[0].text);
    };
    const lesson = await call("create_video_lesson", { title: "Windows cleanup recovery Ω" });
    const image = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#223366"/><text x="80" y="200" fill="#fff" font-size="64">Recovery</text></svg>';
    for (const [file, content] of Object.entries({
      "s.svg": image, "s.txt": "This lesson survives a locked temporary folder.",
      "slides.json": JSON.stringify([{ image: "s.svg", narration: "s.txt" }]),
    })) await call("write_video_lesson_file", { lessonId: lesson.lessonId, path: file, content });
    let status = await call("start_video_render", { lessonId: lesson.lessonId });
    const jobId = status.jobId;
    assert.equal((await call("start_video_render", { lessonId: lesson.lessonId })).jobId, jobId);
    for (let waited = 0; status.state === "running" && waited < 180_000; waited += 1000) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      status = await call("get_video_render", { lessonId: lesson.lessonId });
    }
    assert.equal(status.state, "done", JSON.stringify(status));
    assert.equal(status.renderer, "slides");
    assert.equal(status.progress.stage, "saving");
    assert.deepEqual(status.warnings.map(w => w.errno), ["EBUSY", "EBUSY"]);
    console.log("Recovery acceptance: managed fallback exported an MP4 despite both cleanup locks.");
    assert(existsSync(path.join(lesson.folder, "slides.json")));
    const streams = JSON.parse(cli(env, "video", "run", "ffprobe", "--", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", status.output)).streams;
    assert.deepEqual(streams.map(s => s.codec_type).sort(), ["audio", "video"]);
    cli(env, "video", "run", "ffmpeg", "--", "-v", "error", "-xerror", "-i", status.output, "-f", "null", "-");

    // Direct CLI also keeps its final JSON parseable and streams progress on stderr before completion.
    const direct = path.join(project, "direct cleanup recovery Ω"); mkdirSync(direct);
    writeFileSync(path.join(direct, "s.svg"), image);
    writeFileSync(path.join(direct, "s.txt"), "The direct renderer also recovers.");
    writeFileSync(path.join(direct, "slides.json"), JSON.stringify([{ image: "s.svg", narration: "s.txt" }]));
    const rendered = spawnSync(command, [...prefix, "video", "render-slides", "--project", direct], {
      env: blocked, cwd: project, encoding: "utf8", timeout: 180_000,
    });
    assert.equal(rendered.status, 0, rendered.stderr);
    const result = JSON.parse(rendered.stdout);
    assert.equal(result.warnings[0].errno, "EBUSY");
    assert.match(rendered.stderr, /narrating 1\/1/);
    assert.match(rendered.stderr, /verifying/);
    assert(existsSync(result.output));
    cli(env, "video", "run", "ffmpeg", "--", "-v", "error", "-xerror", "-i", result.output, "-f", "null", "-");
  } finally { await client.close(); }
  console.log(`${process.platform}-${process.arch}: locked probe success, preserved browser failure, real MCP fallback MP4, direct MP4, progress and full decoding passed.`);
}
