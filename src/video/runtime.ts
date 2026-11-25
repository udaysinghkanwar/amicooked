import * as fs from "node:fs";
import path from "node:path";
import { paths, writePrivateFile } from "../config.js";
import { acquireLock } from "../lock.js";
import { download, fingerprint, installComponent, runTool, unpack } from "./install.js";
import { platformDownloads, targets, voiceModel, type VideoTarget } from "./manifest.js";
import manifest from "./runtime-package.json" with { type: "json" };
import npmLock from "./runtime-lock.json" with { type: "json" };
import { voiceScript } from "./voice.js";

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
  const state = !target ? "unsupported"
    : record ? (record.identity === identity ? "ready" : "previous")
    : "missing";
  return { state, target: targetName };
}

export function videoEnvironment(tools: Tools): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [path.dirname(tools.node), path.dirname(tools.ffmpeg), path.dirname(tools.ffprobe), process.env.PATH].join(path.delimiter),
    HYPERFRAMES_BROWSER_PATH: tools.browser,
    HYPERFRAMES_FFMPEG_PATH: tools.ffmpeg,
    HYPERFRAMES_FFPROBE_PATH: tools.ffprobe,
    HYPERFRAMES_CACHE_DIR: path.join(root(), "hyperframes-cache"),
    HF_HUB_OFFLINE: "1",
    DO_NOT_TRACK: "1",
  };
}

function smokeTest(tools: Tools) {
  const work = fs.mkdtempSync(path.join(root(), "pending-"));
  const env = videoEnvironment(tools);
  try {
    const text = path.join(work, "narration.txt");
    const audio = path.join(work, "voice.wav");
    const video = path.join(work, "smoke.mp4");
    fs.writeFileSync(text, "Video tools are ready.");
    runTool(tools.node, [tools.voice, tools.model, text, audio], env, work);
    const duration = Number(runTool(tools.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio], env));
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("The narration test produced no audio.");
    fs.writeFileSync(path.join(work, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Video setup check</title></head>
<body style="margin:0;background:#16232c;color:#fff"><div id="main" data-no-timeline data-composition-id="main" data-width="640" data-height="360" data-duration="${duration + 0.3}">
<h1 style="margin:60px">Am I Cooked video setup</h1>
<audio id="voice" class="clip" data-start="0" data-duration="${duration}" data-track-index="1" src="voice.wav"></audio>
</div></body></html>`);
    runTool(tools.node, [tools.hyperframes, "render", "--quality", "draft", "--workers", "1", "--no-best-effort", "--output", video], env, work);
    const streams = JSON.parse(runTool(tools.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", video], env)).streams as { codec_type: string }[];
    if (!["audio", "video"].every(type => streams.some(stream => stream.codec_type === type))) {
      throw new Error("The test render did not contain audio and video.");
    }
    runTool(tools.ffmpeg, ["-v", "error", "-xerror", "-i", video, "-f", "null", "-"], env);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
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
        "--cache", path.join(root(), "npm-cache"), "--userconfig", path.join(directory, ".npmrc")],
      { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm_config_|node_options$)/i.test(key))), PATH: `${path.dirname(node)}${path.delimiter}${process.env.PATH ?? ""}` }, directory);
    });
    const model = await installComponent(store, fingerprint(voiceModel), Object.keys(voiceModel), async directory => {
      log("Downloading the local narration model…");
      for (const [file, asset] of Object.entries(voiceModel)) await download(asset, path.join(directory, file));
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
    smokeTest(tools);
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
