// External downloads are intentional here. A fresh home exercises the real user setup path.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// The ordinary local suite stays offline. The existing GitHub matrix runs the full acceptance test.
if (process.argv.includes("--ci") && process.env.GITHUB_ACTIONS !== "true") process.exit(0);

const root = mkdtempSync(path.join(os.tmpdir(), "amicooked video acceptance "));
const windows = process.platform === "win32";
const source = path.resolve(`build/amicooked-${windows ? "windows" : process.platform}-${process.arch}${windows ? ".exe" : ""}`);
const npmScript = process.env.npm_execpath;
const checksum = createHash("sha256").update(readFileSync(source)).digest("hex");
const server = spawn(process.execPath, ["-e", String.raw`
  const fs = require("node:fs");
  const http = require("node:http");
  const [binary, checksum] = process.argv.slice(1);
  const filename = require("node:path").basename(binary);
  const server = http.createServer((request, response) => {
    if (request.url === "/SHA256SUMS") response.end(checksum + "  " + filename + "\n");
    else if (request.url === "/" + filename) fs.createReadStream(binary).pipe(response);
    else response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1", () => process.send(server.address().port));
`, source, checksum], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
const setup = ["setup", "--school", "mcmaster", "--clients", "none", "--no-login", "--yes"];
try {
  const port = await new Promise((resolve, reject) => {
    server.once("message", resolve);
    server.once("error", reject);
    server.once("exit", () => reject(new Error("Installer fixture server stopped")));
  });
  const packArgs = ["pack", "--json", "--pack-destination", root];
  const packed = npmScript
    ? execFileSync(process.execPath, [npmScript, ...packArgs], { encoding: "utf8" })
    : execFileSync("npm", packArgs, { encoding: "utf8" });
  const tarball = path.join(root, JSON.parse(packed)[0].filename);
  for (const channel of ["native", "npm"]) {
    const home = path.join(root, channel);
    const data = path.join(home, ".amicooked");
    const project = path.join(home, "lecture workspace Ω", "a lesson project with a space and a longer directory name");
    const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"),
      APPDATA: path.join(home, "AppData/Roaming"), LOCALAPPDATA: path.join(home, "AppData/Local"),
      AMICOOKED_HOME: data, AMICOOKED_NO_TELEMETRY: "1", D2L_HOST: "", D2L_LOGIN_URL: "" };
    delete env.AMICOOKED_VERSION;
    delete env.AMICOOKED_NO_SETUP;
    mkdirSync(project, { recursive: true });
    mkdirSync(data, { recursive: true });
    writeFileSync(path.join(data, "config.json"), JSON.stringify({ version: 1, browser: "chrome", filesDir: path.join(home, "downloads") }));
    let olderRecipe;
    let command;
    let prefix;
    if (channel === "native") {
      command = path.join(data, "bin", windows ? "amicooked.exe" : "amicooked");
      const installEnv = { ...env, AMICOOKED_DOWNLOAD_BASE: `http://127.0.0.1:${port}`, AMICOOKED_NO_SETUP: "1", AMICOOKED_NO_PATH: "1" };
      const [installer, ...args] = windows
        ? ["pwsh", "-NoProfile", "-NonInteractive", "-File", path.resolve("install/install.ps1")]
        : ["sh", path.resolve("install/install.sh")];
      execFileSync(installer, args, { env: installEnv, stdio: "inherit" });
      prefix = [];
    } else {
      assert(npmScript, "Run this workflow through npm so the isolated package can be installed");
      execFileSync(process.execPath, [npmScript, "install", "--prefix", home, "--no-fund", "--no-audit", tarball], { env, stdio: "inherit" });
      command = process.execPath;
      prefix = [path.join(home, "node_modules/amicooked/dist/cli.js")];
      const voice = path.join(path.dirname(prefix[0]), "video", "voice.js");
      const current = readFileSync(voice, "utf8");
      writeFileSync(voice, current.replace("voiceScript = `", "voiceScript = `\n// Earlier narration recipe"));
      assert.notEqual(readFileSync(voice, "utf8"), current);
      olderRecipe = () => writeFileSync(voice, current);
    }
    const run = (...args) => execFileSync(command, args, {
      env, cwd: project, encoding: "utf8", timeout: 900_000, stdio: ["ignore", "pipe", "inherit"],
    }).trim();
    const cli = (...args) => run(...prefix, ...args);
    assert.equal(JSON.parse(cli("video", "status")).state, "missing");
    if (channel === "npm") {
      cli(...setup, "--skip-video-deps");
      cli(...setup);
      cli("refresh-skills");
      assert.equal(existsSync(path.join(data, "video")), false);
      assert.match(cli("features", "lecture-videos"), /run `amicooked video prepare` in an authorized local shell/);
    }
    // Keep every actual download except Hugging Face. Require all four files from the public backup.
    const blockHuggingFace = `data:text/javascript,${encodeURIComponent(`
      import assert from "node:assert/strict";
      const originalFetch = globalThis.fetch;
      const mirrored = new Set();
      globalThis.fetch = (input, options) => {
        const url = new URL(input);
        if (url.hostname === "huggingface.co") return Promise.resolve(new Response(null, { status: 403 }));
        if (url.hostname === "github.com" && url.pathname.includes("/releases/download/kokoro-82m-")) {
          mirrored.add(url.pathname.split("/").at(-1));
        }
        return originalFetch(input, options);
      };
      process.on("exit", () => {
        assert.deepEqual([...mirrored].sort(), ["config.json", "model_quantized.onnx", "tokenizer.json", "tokenizer_config.json"]);
        console.log("Downloaded all four pinned Kokoro assets with Hugging Face blocked.");
      });
    `)}`;
    const output = channel === "npm" ? run("--import", blockHuggingFace, ...prefix, ...setup, "--with-video-deps") : cli(...setup);
    assert.match(output, /Testing a narrated video render/);
    assert.match(output, /Lecture video tools are ready/);
    if (channel === "npm") console.log(output.split("\n").at(-1));
    assert.equal(JSON.parse(cli("video", "status")).state, "ready");
    for (const tool of ["ffmpeg", "ffprobe"]) {
      assert.match(cli("video", "run", tool, "--", "-version"), new RegExp(`^${tool} version 9[.]1(?:\\D|$)`));
    }
    const marker = path.join(data, "video", "ready.json");
    let first = readFileSync(marker, "utf8");
    cli(...setup);
    assert.equal(readFileSync(marker, "utf8"), first);
    if (olderRecipe) {
      const previousTools = JSON.parse(first).tools;
      olderRecipe();
      assert.equal(JSON.parse(cli("video", "status")).state, "previous");
      // Run the installed background worker, with only GitHub release metadata replaced for this fixture.
      const release = JSON.stringify({ tag_name: `v${cli("--version")}` });
      const fixture = `data:text/javascript,${encodeURIComponent(`
        const fetchAsset = globalThis.fetch;
        globalThis.fetch = (url, options) => url === "https://api.github.com/repos/udaysinghkanwar/amicooked/releases/latest"
          ? Promise.resolve(new Response(${JSON.stringify(release)}))
          : fetchAsset(url, options);
      `)}`;
      execFileSync(command, ["--import", fixture, ...prefix, "auto-update", "run"], {
        cwd: project, env, stdio: "inherit", timeout: 900_000,
      });
      assert.equal(JSON.parse(cli("video", "status")).state, "ready");
      first = readFileSync(marker, "utf8");
      const tools = JSON.parse(first).tools;
      assert.notEqual(tools.voice, previousTools.voice);
      for (const key of ["node", "browser", "model", "ffmpeg", "ffprobe", "hyperframes"]) assert.equal(tools[key], previousTools[key]);
      execFileSync(process.execPath, [npmScript, "exec", "--yes", "--package", tarball, "--", "amicooked", ...setup], {
        cwd: root, env, stdio: "inherit", timeout: 900_000,
      });
      assert.equal(readFileSync(marker, "utf8"), first);
    }
    writeFileSync(path.join(data, "automatic-update.json"), JSON.stringify({ lastAttempt: Date.now() }));
    const client = new Client({ name: "video-workflow-acceptance", version: "1" });
    try {
      await client.connect(new StdioClientTransport({ command, args: [...prefix, "mcp"], cwd: project, env, stderr: "ignore" }));
      const result = await client.callTool({ name: "get_lecture_video_workflow", arguments: {} });
      assert.notEqual(result.isError, true);
      const workflow = JSON.parse(result.content[0].text);
      assert.equal(workflow.videoTools.state, "ready");
      assert.match(workflow.nextStep, /managed HyperFrames renderer, Kokoro narration and FFmpeg/);
      assert(path.isAbsolute(workflow.launcher.command));
      assert.equal(workflow.launcher.args.at(-1), "video");
      // Use the reported launcher without requiring amicooked on the caller's PATH.
      const check = execFileSync(workflow.launcher.command, [...workflow.launcher.args, "status"], {
        env: { ...env, ...workflow.launcher.env }, cwd: root, encoding: "utf8",
      });
      assert.equal(JSON.parse(check).state, "ready");
    } finally {
      await client.close();
    }
    cli("video", "run", "hyperframes", "--", "init", "scaffold", "--non-interactive", "--skip-skills");
    assert(existsSync(path.join(project, "scaffold", "index.html")));
    writeFileSync(path.join(project, "narration.txt"), "A place in a Petri net can hold a token.");
    cli("video", "run", "voice", "--", "narration.txt", "voice.wav");
    const duration = Number(cli("video", "run", "ffprobe", "--", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "voice.wav"));
    assert(duration > 0);
    writeFileSync(path.join(project, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>Petri net</title></head>
<body style="margin:0;background:#15222c;color:white"><main data-no-timeline data-composition-id="main" data-width="640" data-height="360" data-duration="${duration + 0.3}">
<h1>One place, one token</h1><audio id="voice" class="clip" data-start="0" data-duration="${duration}" data-track-index="1" src="voice.wav"></audio></main></body></html>`);
    const scratch = path.join(home, "approved scratch");
    mkdirSync(scratch);
    const legacyCache = path.join(data, "video", "hyperframes-cache");
    mkdirSync(legacyCache, { recursive: true });
    const account = windows && execFileSync("whoami.exe", [], { encoding: "utf8" }).trim();
    if (windows) execFileSync("icacls.exe", [legacyCache, "/deny", `${account}:(OI)(CI)(W)`]);
    else chmodSync(legacyCache, 0o500);
    try {
      assert.throws(() => writeFileSync(path.join(legacyCache, "write-test"), "denied"));
      const context = ["--project", project, "--scratch", scratch];
      const fromOutside = (...args) => execFileSync(command, [...prefix, ...args], {
        env, cwd: home, encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"],
      });
      const denied = spawnSync(command, [...prefix, "video", "probe", "--project", project, "--scratch", legacyCache], {
        env, cwd: home, encoding: "utf8", timeout: 15_000,
      });
      assert.equal(denied.status, 1);
      assert.equal(JSON.parse(denied.stdout).stage, "scratch");
      const probe = JSON.parse(fromOutside("video", "probe", ...context));
      assert.equal(probe.ok, true, JSON.stringify(probe));
      assert(probe.steps.includes("browser-check"));
      const check = JSON.parse(fromOutside("video", "run", "hyperframes", ...context, "--", "check", "--json"));
      assert.equal(check.ok, true, JSON.stringify(check.runtime));
      assert.equal(check.browserSkipped, false);
      const snapshots = path.join(project, "snapshots");
      fromOutside("video", "run", "hyperframes", ...context, "--", "snapshot", "--review", "--output", snapshots);
      assert(readdirSync(snapshots).some(file => /\.(png|jpg)$/.test(file)));
      fromOutside("video", "run", "hyperframes", ...context, "--", "render", "--workers", "1", "--quality", "draft", "--no-best-effort", "--output", "lesson.mp4");
      console.log(`${process.platform}-${process.arch} ${channel}: read-only managed cache, explicit project from another directory, browser check, snapshots and render passed.`);
    } finally {
      if (windows) execFileSync("icacls.exe", [legacyCache, "/remove:d", account]);
      else chmodSync(legacyCache, 0o700);
    }
    const streams = JSON.parse(cli("video", "run", "ffprobe", "--", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", "lesson.mp4")).streams;
    assert.deepEqual(streams.map(stream => stream.codec_type).sort(), ["audio", "video"]);
    cli("video", "run", "ffmpeg", "--", "-v", "error", "-xerror", "-i", "lesson.mp4", "-f", "null", "-");
    cli("uninstall");
    cli(...setup);
    assert.equal(readFileSync(marker, "utf8"), first);
    if (process.env.AMICOOKED_VIDEO_TEST_OUTPUT) {
      mkdirSync(process.env.AMICOOKED_VIDEO_TEST_OUTPUT, { recursive: true });
      copyFileSync(path.join(project, "lesson.mp4"), path.join(process.env.AMICOOKED_VIDEO_TEST_OUTPUT, `${channel}.mp4`));
    }
    if (!windows || channel === "npm") {
      cli("uninstall", "--purge");
      assert.equal(existsSync(data), false);
    }
    console.log(`${process.platform}-${process.arch} ${channel}: automatic preparation, MCP workflow readiness, narration, full MP4 decode and reinstall passed.`);
  }
} finally {
  server.kill();
  rmSync(root, { recursive: true, force: true });
}
