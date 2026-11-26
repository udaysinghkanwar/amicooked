import { createRequire } from "node:module";
import * as fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reloadConfig, writeConfig } from "../../src/config.js";
import { cleanupVideoWork } from "../../src/video/cleanup.js";
import { fingerprint, runTool } from "../../src/video/install.js";
import { platformDownloads, voiceModel, type VideoTarget } from "../../src/video/manifest.js";
import { probeVideo, type SlideTools } from "../../src/video/runtime.js";
import * as runtime from "../../src/video/runtime.js";
import { voiceScript } from "../../src/video/voice.js";
import { renderSlides } from "../../src/video/slides.js";
import * as slides from "../../src/video/slides.js";
import { renderAnimatedLesson } from "../../src/video/lesson-animation.js";
import * as animation from "../../src/video/lesson-animation.js";
import { createLesson } from "../../src/video/lessons.js";
import { renderLessonWork } from "../../src/video/jobs.js";

// Keep real paths, validation and render control flow. Only external tools and the injected cleanup error are fake.
vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>() }));
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), spawnSync: vi.fn() }));
vi.mock("../../src/video/install.js", async original => ({ ...await original<typeof import("../../src/video/install.js")>(), runTool: vi.fn() }));

let home: string;
let project: string;
let tools: SlideTools & { browser: string; hyperframes: string };
const originalRm = fs.rmSync;
let output: ReturnType<typeof vi.spyOn>;
let errors: ReturnType<typeof vi.spyOn>;
const busy = () => Object.assign(new Error("EBUSY: simulated Windows directory lock"), { code: "EBUSY" });

beforeEach(() => {
  home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "amicooked recovery Ω ")));
  vi.stubEnv("AMICOOKED_HOME", path.join(home, ".amicooked"));
  reloadConfig();
  writeConfig({ filesDir: path.join(home, "Lessons root") });
  project = path.join(home, "project with spaces");
  fs.mkdirSync(project);
  const root = path.join(home, ".amicooked", "video");
  const model = path.join(root, "model");
  fs.mkdirSync(path.join(model, "onnx"), { recursive: true });
  for (const file of Object.keys(voiceModel)) fs.writeFileSync(path.join(model, file), "fixture");
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  tools = Object.fromEntries(["node", "ffmpeg", "ffprobe", "voice", "browser", "hyperframes"].map(key => {
    const file = path.join(bin, key); fs.writeFileSync(file, "fixture"); return [key, file];
  })) as typeof tools;
  tools.model = model;
  const target = `${process.platform}-${process.arch}` as VideoTarget;
  const require = createRequire(import.meta.url);
  const identity = fingerprint([1, target, platformDownloads(target), voiceModel, require("../../src/video/runtime-lock.json"), voiceScript]);
  fs.writeFileSync(path.join(root, "ready.json"), JSON.stringify({ schema: 1, target, identity, tools }));
  // Template asset required by the real HyperFrames lesson renderer.
  const gsap = path.resolve(path.dirname(tools.hyperframes), "..", "dist/vendor/npm/gsap@3.14.2/dist/gsap.min.js");
  fs.mkdirSync(path.dirname(gsap), { recursive: true }); fs.writeFileSync(gsap, "fixture");
  vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: JSON.stringify({ ok: true, browserSkipped: false }), stderr: "" } as never);
  vi.mocked(runTool).mockImplementation((command, args, _env, cwd) => {
    if (command === tools.ffprobe) return args.includes("format=duration") ? "1" : JSON.stringify({ streams: [{ codec_type: "audio" }, { codec_type: "video" }] });
    const rendered = args.at(-1);
    if (rendered?.endsWith(".mp4")) fs.writeFileSync(path.resolve(cwd ?? project, rendered), "synthetic-media-fixture");
    return "";
  });
  output = vi.spyOn(console, "log").mockImplementation(() => {});
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  reloadConfig();
  originalRm(home, { recursive: true, force: true, maxRetries: 5 });
});

function storyboard(folder = project) {
  fs.writeFileSync(path.join(folder, "s.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#123456"/></svg>');
  fs.writeFileSync(path.join(folder, "s.txt"), "A short narration.");
  fs.writeFileSync(path.join(folder, "slides.json"), JSON.stringify([{ image: "s.svg", narration: "s.txt" }]));
}
function lockCleanup(prefix: string) {
  return vi.spyOn(fs, "rmSync").mockImplementation((file, options) => {
    if (path.basename(String(file)).startsWith(prefix)) throw busy();
    return originalRm(file, options);
  });
}

it("removes its exact disposable directory, with a finite retry budget", () => {
  const work = fs.mkdtempSync(path.join(home, "owned-"));
  const unrelated = path.join(home, "keep.txt"); fs.writeFileSync(unrelated, "keep");
  const rm = vi.spyOn(fs, "rmSync");
  const warnings = [];
  cleanupVideoWork(work, warnings);
  expect(warnings).toEqual([]);
  expect(rm).toHaveBeenCalledWith(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  expect(fs.existsSync(work)).toBe(false);
  expect(fs.readFileSync(unrelated, "utf8")).toBe("keep");
});

it.each(["EBUSY", "EPERM", "EACCES"])("preserves a successful probe when cleanup returns %s", code => {
  vi.spyOn(fs, "rmSync").mockImplementation(() => { throw Object.assign(new Error(code), { code }); });
  const result = probeVideo(project);
  expect(result.ok).toBe(true);
  expect(result.steps).toContain("verify");
  expect(result.warnings).toEqual([{ code: "video_cleanup_deferred", errno: code, path: expect.stringContaining(".amicooked-probe-") }]);
  expect(errors).toHaveBeenCalledWith(expect.stringContaining(code));
});

it("preserves browser failure and fallback guidance when cleanup is also locked", () => {
  lockCleanup(".amicooked-probe-");
  vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: JSON.stringify({ ok: false, browserSkipped: true, runtime: { findings: [{ code: "console_error", message: "Access to audio at 'http://hyperframes-123.localhost/voice.wav' from origin 'null' has been blocked by CORS policy" }] } }), stderr: "" } as never);
  const result = probeVideo(project);
  expect(result).toMatchObject({ ok: false, stage: "browser-check", reason: "local-preview-blocked" });
  expect(result.nextStep).toContain("render-slides");
  expect(result.warnings[0].errno).toBe("EBUSY");
});

it("preserves the failing shared voice stage when cleanup also fails", () => {
  lockCleanup(".amicooked-probe-");
  vi.mocked(runTool).mockImplementation(() => { throw new Error("Voice model failed"); });
  expect(probeVideo(project)).toMatchObject({ ok: false, stage: "narration", error: "Voice model failed", warnings: [{ errno: "EBUSY" }] });
});

it("returns a saved slide render despite locked cleanup, and reports each stage before completion", () => {
  storyboard(); lockCleanup("slides-");
  const events: string[] = [];
  const result = renderSlides(project, home, tools, p => events.push(`${p.stage}:${p.scene ?? ""}`));
  expect(result).toMatchObject({ ok: true, slides: 1, warnings: [{ errno: "EBUSY" }] });
  expect(fs.existsSync(result.output)).toBe(true);
  expect(events).toEqual(["validating:", "rasterizing:1", "narrating:1", "encoding:1", "assembling:", "verifying:", "saving:"]);
  expect(() => renderSlides(project, home, tools)).toThrow("existing lesson.mp4");
  expect(fs.readFileSync(path.join(project, "s.txt"), "utf8")).toBe("A short narration.");
});

it("preserves a slide render's primary tool error, does not publish output, and can retry", () => {
  storyboard(); lockCleanup("slides-");
  const implementation = vi.mocked(runTool).getMockImplementation()!;
  vi.mocked(runTool).mockImplementation((command, args, ...rest) => {
    if (command === tools.node && args[0] === tools.voice) throw new Error("Voice synthesis failed");
    return implementation(command, args, ...rest);
  });
  expect(() => renderSlides(project, home, tools)).toThrow("Voice synthesis failed");
  expect(fs.existsSync(path.join(project, "lesson.mp4"))).toBe(false);
  vi.mocked(runTool).mockImplementation(implementation);
  expect(renderSlides(project, home, tools).ok).toBe(true);
});

it("rejects missing audio/video before publishing the slide MP4", () => {
  storyboard();
  const implementation = vi.mocked(runTool).getMockImplementation()!;
  vi.mocked(runTool).mockImplementation((command, args, ...rest) => command === tools.ffprobe && args.includes("stream=codec_type")
    ? JSON.stringify({ streams: [{ codec_type: "video" }] }) : implementation(command, args, ...rest));
  expect(() => renderSlides(project, home, tools)).toThrow("both video and narration");
  expect(fs.existsSync(path.join(project, "lesson.mp4"))).toBe(false);
});

it("does not reinterpret successful HyperFrames export as failure when cleanup is locked", () => {
  storyboard(); lockCleanup("lecture-animation-");
  const result = renderAnimatedLesson(project);
  expect(result.warnings).toMatchObject([{ errno: "EBUSY" }]);
  expect(fs.existsSync(result.output)).toBe(true);
});

it.each(["browser failure", "unexpected probe exception", "HyperFrames exception"])("managed jobs reach slides after %s", async failure => {
  const lesson = createLesson("Recovery"); storyboard(lesson.folder);
  if (failure === "unexpected probe exception") vi.spyOn(runtime, "probeVideo").mockImplementation(() => { throw busy(); });
  if (failure === "browser failure") vi.mocked(spawnSync).mockReturnValue({ error: Object.assign(new Error("browser check timed out"), { code: "ETIMEDOUT" }) } as never);
  if (failure === "HyperFrames exception") vi.spyOn(animation, "renderAnimatedLesson").mockImplementation(() => { throw new Error("Browser render failed"); });
  lockCleanup(".amicooked-probe-");
  const fallback = vi.spyOn(slides, "renderSlides");
  await expect(renderLessonWork(lesson.id)).resolves.toBe(0);
  expect(fallback).toHaveBeenCalledOnce();
  const result = JSON.parse(String(output.mock.calls.at(-1)![0]));
  expect(result.renderer).toBe("slides");
  expect(fs.existsSync(result.output)).toBe(true);
  if (failure !== "unexpected probe exception") expect(result.warnings[0].errno).toBe("EBUSY");
});

it("keeps HyperFrames selected when only successful probe/export cleanup is locked", async () => {
  const lesson = createLesson("Success"); storyboard(lesson.folder);
  lockCleanup(".amicooked-probe-");
  const fallback = vi.spyOn(slides, "renderSlides");
  await expect(renderLessonWork(lesson.id)).resolves.toBe(0);
  expect(fallback).not.toHaveBeenCalled();
  expect(JSON.parse(String(output.mock.calls.at(-1)![0]))).toMatchObject({ renderer: "hyperframes", warnings: [{ errno: "EBUSY" }] });
});

it("reports the real slide failure after an unexpected probe error and preserves the lesson", async () => {
  const lesson = createLesson("Shared failure"); storyboard(lesson.folder);
  vi.spyOn(runtime, "probeVideo").mockImplementation(() => { throw busy(); });
  vi.mocked(runTool).mockImplementation(() => { throw new Error("FFmpeg unavailable"); });
  await expect(renderLessonWork(lesson.id)).rejects.toThrow("FFmpeg unavailable");
  expect(fs.existsSync(path.join(lesson.folder, "lesson.mp4"))).toBe(false);
  expect(fs.existsSync(path.join(lesson.folder, "slides.json"))).toBe(true);
});

it.runIf(process.platform === "win32")("survives a real Windows child holding its scratch working directory", async () => {
  const work = fs.mkdtempSync(path.join(home, "windows-locked-"));
  const child = spawn(process.execPath, ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000)"], { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await once(child.stdout!, "data");
    const warnings = [];
    cleanupVideoWork(work, warnings);
    expect(warnings).toMatchObject([{ code: "video_cleanup_deferred" }]);
    expect(fs.existsSync(work)).toBe(true);
  } finally {
    const closed = once(child, "close"); child.kill(); await closed;
  }
  cleanupVideoWork(work);
  expect(fs.existsSync(work)).toBe(false);
});
