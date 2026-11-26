import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { paths, writePrivateFile } from "../config.js";
import { acquireLock } from "../lock.js";
import { download, fingerprint, installComponent, runTool, unpack } from "./install.js";
import { platformDownloads, targets, voiceModel, voiceModelMirror, type VideoTarget } from "./manifest.js";
import manifest from "./runtime-package.json" with { type: "json" };
import npmLock from "./runtime-lock.json" with { type: "json" };
import { voiceScript } from "./voice.js";
import { videoProject, videoScratch } from "./workspace.js";

const targetName = `${process.platform}-${process.arch}`;
const target = Object.hasOwn(targets, targetName) ? targetName as VideoTarget : undefined;
const windows = process.platform === "win32";
const exe = (name: string) => name + (windows ? ".exe" : "");
const root = () => path.resolve(paths().home, "video");
const marker = () => path.join(root(), "ready.json");
export const acquireVideoLock = () => acquireLock(path.join(root(), "prepare.lock"), "video setup");
// Raise the schema when the command interface or test changes incompatibly.
const schema = 1;
const identity = target && fingerprint([schema, target, platformDownloads(target), voiceModel, npmLock, voiceScript]);

interface Tools {
  node: string;
  browser: string;
  ffmpeg: string;
  ffprobe: string;
  hyperframes: string;
  voice: string;
  model: string;
}

interface Ready {
  schema: number;
  target: string;
  identity: string;
  tools: Tools;
}

function loadReady(): Ready | undefined {
  try {
    const record = JSON.parse(fs.readFileSync(marker(), "utf8")) as Ready;
    if (record.schema !== schema || record.target !== targetName || !/^[0-9a-f]{64}$/.test(record.identity)) return;
    for (const key of ["node", "browser", "ffmpeg", "ffprobe", "hyperframes", "voice", "model"] as const) {
      const file = record.tools?.[key];
      if (typeof file !== "string" || !path.resolve(file).startsWith(root() + path.sep) || !fs.existsSync(file)) return;
    }
    if (!Object.keys(voiceModel).every(file => fs.existsSync(path.join(record.tools.model, file)))) return;
    return record;
  } catch { return undefined; }
}

export function videoStatus() {
  const record = loadReady();
  const state: "unsupported" | "ready" | "previous" | "missing" = !target ? "unsupported"
    : record ? (record.identity === identity ? "ready" : "previous")
    : "missing";
  return { state, target: targetName };
}

export function videoEnvironment(tools: Tools, scratch?: ReturnType<typeof videoScratch>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [path.dirname(tools.node), path.dirname(tools.ffmpeg), path.dirname(tools.ffprobe), process.env.PATH].join(path.delimiter),
    HYPERFRAMES_BROWSER_PATH: tools.browser,
    HYPERFRAMES_FFMPEG_PATH: tools.ffmpeg,
    HYPERFRAMES_FFPROBE_PATH: tools.ffprobe,
    HYPERFRAMES_CACHE_DIR: scratch?.cache ?? path.join(root(), "hyperframes-cache"),
    ...(scratch && {
      HYPERFRAMES_FONT_CACHE_DIR: path.join(scratch.cache, "fonts"),
      HYPERFRAMES_EXTRACT_CACHE_DIR: path.join(scratch.cache, "extract"),
      TMPDIR: scratch.temp, TMP: scratch.temp, TEMP: scratch.temp,
    }),
    HF_HUB_OFFLINE: "1",
    DO_NOT_TRACK: "1",
  };
}

class LocalPreviewBlockedError extends Error {}

function smokeTest(tools: Tools, work: string, env: NodeJS.ProcessEnv, stage?: (step: string) => void) {
  stage?.("narration");
  const text = path.join(work, "narration.txt");
  const audio = path.join(work, "voice.wav");
  const video = path.join(work, "smoke.mp4");
  fs.writeFileSync(text, "Video tools are ready.");
  runTool(tools.node, [tools.voice, tools.model, text, audio], env, work);
  const duration = Number(runTool(tools.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio], env));
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("The narration test produced no audio.");
  stage?.("output");
  fs.writeFileSync(path.join(work, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Video setup check</title></head>
<body style="margin:0;background:#16232c;color:#fff"><div id="main" data-no-timeline data-composition-id="main" data-width="640" data-height="360" data-duration="${duration + 0.3}">
<h1 style="margin:60px">Am I Cooked video setup</h1>
<audio id="voice" class="clip" data-start="0" data-duration="${duration}" data-track-index="1" src="voice.wav"></audio>
</div></body></html>`);
  if (stage) {
    stage("browser-check");
    const result = spawnSync(tools.node, [tools.hyperframes, "check", "--json"], {
      env, cwd: work, encoding: "utf8", timeout: 300_000, windowsHide: true,
    });
    if (result.error) throw result.error;
    let report;
    try { report = JSON.parse(result.stdout); }
    catch { throw new Error(result.stderr.trim().split("\n").at(-1) || "HyperFrames returned no browser check report."); }
    if (result.status !== 0 || report.ok !== true || report.browserSkipped !== false) {
      const runtimeFindings = report.runtime?.findings ?? [];
      // This synthetic origin is used by HyperFrames when it cannot open its local server.
      const blockedAudio = runtimeFindings.find((finding: { code?: string; message?: string }) =>
        finding.code === "console_error" &&
        /^Access to audio at 'http:\/\/hyperframes-\d+\.localhost\/.*' from origin 'null' has been blocked by CORS policy/.test(finding.message ?? ""));
      if (blockedAudio) throw new LocalPreviewBlockedError(blockedAudio.message);
      const errors = [...runtimeFindings, ...report.layout?.findings ?? []];
      const finding = errors.find(item => item.severity === "error") ?? errors[0];
      throw new Error(finding?.message ?? "HyperFrames did not complete the browser check.");
    }
  }
  stage?.("render");
  runTool(tools.node, [tools.hyperframes, "render", "--quality", "draft", "--workers", "1", "--no-best-effort", "--output", video], env, work);
  stage?.("verify");
  const streams = JSON.parse(runTool(tools.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", video], env)).streams as { codec_type: string }[];
  if (!["audio", "video"].every(type => streams.some(stream => stream.codec_type === type))) {
    throw new Error("The test render did not contain audio and video.");
  }
  runTool(tools.ffmpeg, ["-v", "error", "-xerror", "-i", video, "-f", "null", "-"], env);
}

export function probeVideo(directory?: string, scratchDirectory?: string) {
  let project: string | undefined;
  let work: string | undefined;
  let stage = "installation";
  const steps: string[] = [];
  try {
    const tools = getVideoTools();
    steps.push(stage);
    stage = "project";
    project = videoProject(directory);
    work = fs.mkdtempSync(path.join(project, ".amicooked-probe-"));
    steps.push(stage);
    stage = "scratch";
    const scratch = videoScratch(project, scratchDirectory);
    smokeTest(tools, work, videoEnvironment(tools, scratch), step => {
      steps.push(stage);
      stage = step;
    });
    steps.push(stage);
    return { ok: true, project, scratch: scratch.cache, steps };
  } catch (error) {
    if (error instanceof LocalPreviewBlockedError) {
      return { ok: false, project, steps, stage, reason: "local-preview-blocked", error: error.message,
        nextStep: "The video tools are installed, but the browser could not load local narration through the preview fallback. Keep your work in the project folder and rerun video probe there from your own Terminal or an approved local AI session. In ChatGPT desktop, open Codex → This computer and select the same folder." };
    }
    const nextStep = stage === "installation" ? "Run video prepare in the local installer environment, then retry the probe." :
      "Use a local project and scratch folder this session can write, and confirm it can launch the managed browser and bind a local preview port. If the client blocks those capabilities, connect an approved local workspace or use a local client with those capabilities.";
    return { ok: false, project, steps, stage, error: error instanceof Error ? error.message : String(error),
      nextStep };
  } finally {
    if (work) fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  }
}

export async function prepareVideo(log: (message: string) => void = console.error) {
  if (!target || !identity) throw new Error(`Managed video tools are unavailable for ${targetName}.`);
  if (videoStatus().state === "ready") return videoStatus();
  const release = acquireVideoLock();
  try {
    if (videoStatus().state === "ready") return videoStatus();
    const store = path.join(root(), "components");
    fs.mkdirSync(store, { recursive: true, mode: 0o700 });
    for (const parent of [root(), store]) {
      for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith("pending-")) fs.rmSync(path.join(parent, entry.name), { recursive: true, force: true });
      }
    }
    const assets = platformDownloads(target);
    const nodeRelative = path.join(assets.nodeDirectory, windows ? "node.exe" : "bin/node");
    const browserRelative = path.join(assets.chromeDirectory, exe("chrome-headless-shell"));
    const npmFolder = path.join(assets.nodeDirectory, windows ? "node_modules" : "lib/node_modules");
    const npmRelative = path.join(npmFolder, "npm/bin/npm-cli.js");
    const nodeRoot = await installComponent(store, assets.node.sha256, [nodeRelative, npmRelative], async directory => {
      log("Downloading the video Node runtime…");
      await unpack(assets.node, directory);
    });
    const browserRoot = await installComponent(store, assets.chrome.sha256, [browserRelative], async directory => {
      log("Downloading the video browser…");
      await unpack(assets.chrome, directory);
    });
    const mediaFiles = ["ffmpeg", "ffprobe"].map(tool => path.join(assets.media.binDir, exe(tool)));
    const media = await installComponent(store, fingerprint(assets.media), mediaFiles, async directory => {
      log("Downloading FFmpeg and FFprobe…");
      for (const archive of assets.media.archives) await unpack(archive, directory);
      if (!windows) for (const file of mediaFiles) fs.chmodSync(path.join(directory, file), 0o700);
    });
    const [ffmpeg, ffprobe] = mediaFiles.map(file => path.join(media, file));
    const renderer = "node_modules/hyperframes/bin/hyperframes.mjs";
    const node = path.join(nodeRoot, nodeRelative);
    const packages = await installComponent(store, fingerprint([target, assets.node.sha256, npmLock]), [renderer], async directory => {
      log("Installing the locked renderer and narration packages…");
      fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest));
      fs.writeFileSync(path.join(directory, "package-lock.json"), JSON.stringify(npmLock));
      runTool(node, [path.join(nodeRoot, npmRelative), "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--include=optional",
        "--fetch-retries", "5",
        "--cache", path.join(root(), "npm-cache"), "--userconfig", path.join(directory, ".npmrc")],
      { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm_config_|node_options$)/i.test(key))), PATH: `${path.dirname(node)}${path.delimiter}${process.env.PATH ?? ""}` }, directory, 20 * 60_000);
    });
    const model = await installComponent(store, fingerprint(voiceModel), Object.keys(voiceModel), async directory => {
      log("Downloading the local narration model…");
      for (const [file, asset] of Object.entries(voiceModel)) {
        // Mirrors change where the same pinned bytes come from, not the runtime fingerprint.
        const mirrors = [`${voiceModelMirror}/${path.posix.basename(file)}`];
        await download({ ...asset, mirrors }, path.join(directory, file));
      }
    });
    const voice = path.join(packages, `voice-${fingerprint(voiceScript)}.mjs`);
    if (!fs.existsSync(voice)) writePrivateFile(voice, voiceScript);
    const tools = {
      node, browser: path.join(browserRoot, browserRelative), model,
      ffmpeg, ffprobe,
      hyperframes: path.join(packages, renderer),
      voice,
    };
    log("Testing a narrated video render…");
    const work = fs.mkdtempSync(path.join(root(), "pending-"));
    try { smokeTest(tools, work, videoEnvironment(tools)); }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
    writePrivateFile(marker(), JSON.stringify({ schema, target, identity, tools } satisfies Ready) + "\n");
    return videoStatus();
  } finally {
    release();
  }
}

export function getVideoTools(): Tools {
  const record = loadReady();
  if (!record) throw new Error("Lecture video tools are not ready. Run amicooked video prepare in your local terminal.");
  return record.tools;
}
