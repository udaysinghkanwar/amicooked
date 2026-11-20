import { it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
vi.mock("../../src/video/process.js", () => ({
  duration: vi.fn(async () => 2.5),
  synthesize: vi.fn(),
}));
import { buildVideo } from "../../src/video/build.js";
import { synthesize } from "../../src/video/process.js";
import { VIDEO_EXAMPLES } from "../../src/video/examples.js";
const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })),
  );
  vi.clearAllMocks();
});

it("builds from supplied audio without Python, measures timings and preserves previous deliveries", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "amicooked-video-build-"),
  );
  homes.push(root);
  const spec = structuredClone(VIDEO_EXAMPLES["break-even"]) as any;
  const audio = path.join(root, "voice with spaces.wav");
  await fs.writeFile(audio, "fixture audio");
  for (const scene of spec.scenes)
    for (const cue of scene.cues) cue.audio = "voice with spaces.wav";
  const input = path.join(root, "lesson.json"),
    out = path.join(root, "delivery"),
    cache = path.join(root, "cache");
  await fs.writeFile(input, JSON.stringify(spec));
  const timing = await buildVideo(input, { out, cache });
  expect(synthesize).not.toHaveBeenCalled();
  expect(timing.chapters[0].cues[0]).toMatchObject({ start: 0.25, end: 2.75 });
  expect(timing.chapters[1].start).toBe(timing.chapters[0].duration);
  expect(await fs.readFile(path.join(out, "captions.vtt"), "utf8")).toContain(
    "00:00:00.250 --> 00:00:02.750",
  );
  expect(await fs.readFile(path.join(out, "notes.md"), "utf8")).toContain(
    spec.sources[0].location,
  );
  expect(
    (await fs.stat(path.join(out, "project", "assets", "gsap.min.js"))).size,
  ).toBeGreaterThan(1000);
  expect(
    (await fs.stat(path.join(out, "project", "assets", "katex.min.js"))).size,
  ).toBeGreaterThan(1000);
  await fs.writeFile(path.join(out, "lesson.mp4"), "previous export");
  await buildVideo(input, { out, cache });
  expect(await fs.readFile(path.join(out, "lesson.mp4"), "utf8")).toBe(
    "previous export",
  );
  spec.title = "A changed lesson";
  await fs.writeFile(input, JSON.stringify(spec));
  await expect(buildVideo(input, { out, cache })).rejects.toThrow(
    "new output directory",
  );
  expect(await fs.readFile(path.join(out, "lesson.mp4"), "utf8")).toBe(
    "previous export",
  );
  const unrelated = path.join(root, "unrelated");
  await fs.mkdir(unrelated);
  await fs.writeFile(path.join(unrelated, "notes.txt"), "keep");
  await expect(buildVideo(input, { out: unrelated, cache })).rejects.toThrow(
    "empty output",
  );
});

it("caches speech by content and settings and cleans partial synthesis on failure", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "amicooked-video-cache-"),
  );
  homes.push(root);
  const spec = structuredClone(VIDEO_EXAMPLES["break-even"]) as any;
  spec.scenes = [spec.scenes[0]];
  const input = path.join(root, "lesson.json"),
    model = path.join(root, "model.onnx"),
    voices = path.join(root, "voices.bin");
  await fs.writeFile(input, JSON.stringify(spec));
  await fs.writeFile(model, "fixture model");
  await fs.writeFile(voices, "fixture voices");
  const cache = path.join(root, "cache"),
    options = {
      out: path.join(root, "delivery"),
      cache,
      model,
      voices,
      python: "custom python",
    };
  vi.mocked(synthesize).mockImplementation(async (jobs) => {
    for (const j of jobs) await fs.writeFile(j.output, j.text);
  });
  await buildVideo(input, options);
  expect(synthesize).toHaveBeenCalledTimes(1);
  await buildVideo(input, options);
  expect(synthesize).toHaveBeenCalledTimes(1);
  spec.narration = { voice: "another-voice" };
  await fs.writeFile(input, JSON.stringify(spec));
  await buildVideo(input, {
    ...options,
    out: path.join(root, "changed-voice"),
  });
  expect(synthesize).toHaveBeenCalledTimes(2);
  await fs.writeFile(model, "different model");
  vi.mocked(synthesize).mockImplementationOnce(async (jobs) => {
    await fs.writeFile(jobs[0].output, "partial");
    throw new Error("speech failed");
  });
  await expect(
    buildVideo(input, { ...options, out: path.join(root, "failed") }),
  ).rejects.toThrow("speech failed");
  expect((await fs.readdir(cache)).some((n) => n.endsWith("tmp.wav"))).toBe(
    false,
  );
});
