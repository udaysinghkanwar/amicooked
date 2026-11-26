import * as fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { runTool } from "./install.js";
import { getVideoTools, videoEnvironment } from "./runtime.js";
import { realPath, videoProject, videoScratch } from "./workspace.js";

const keyframe = z.object({ at: z.number().nonnegative(), x: z.number(), y: z.number() });
const overlay = z.object({
  image: z.string(),
  keyframes: z.array(keyframe).min(1).refine(
    frames => frames.every((frame, i) => i === 0 || frame.at > frames[i - 1].at),
    "Overlay keyframe times must increase.",
  ),
});
const slides = z.array(z.object({
  image: z.string(), narration: z.string(), overlays: z.array(overlay).default([]),
})).min(1);
const imageTypes = [".svg", ".png", ".jpg", ".jpeg"];

function position(frames: z.infer<typeof keyframe>[], axis: "x" | "y"): string {
  // Each segment contributes its clamped share of the displacement at time t.
  return frames.slice(1).reduce((expression, frame, i) => {
    const previous = frames[i];
    return `${expression}+(${frame[axis] - previous[axis]})*clip((t-${previous.at})/(${frame.at - previous.at}),0,1)`;
  }, String(frames[0][axis]));
}

function asset(project: string, name: string, extensions: string[]): string {
  if (path.isAbsolute(name)) throw new Error("Use relative paths for slide assets.");
  const file = realPath(path.resolve(project, name));
  const relative = path.relative(project, file);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep)[0] === ".." || !extensions.includes(path.extname(file).toLowerCase()) ||
      !fs.statSync(file).isFile()) {
    throw new Error(`Use a local ${extensions.join(" or ")} file inside the project for ${name}.`);
  }
  return file;
}

// Resolve Sharp from the managed renderer dependencies. Reading the image as a buffer
// also keeps SVG rendering independent of the input file's location.
const rasterize = `
const { readFileSync } = require("node:fs");
const sharp = require("node:module").createRequire(process.argv[1])("sharp");
const background = "#111827";
const image = sharp(readFileSync(process.argv[2]));
const frame = process.argv[4] === "overlay"
  ? image.ensureAlpha()
  : image.resize(1280, 720, { fit: "contain", background }).flatten({ background });
frame.png().toFile(process.argv[3])
  .catch(error => { console.error(error.message); process.exitCode = 1; });
`;

export function renderSlides(directory?: string, scratchDirectory?: string) {
  const project = videoProject(directory);
  const output = path.join(project, "lesson.mp4");
  if (fs.existsSync(output)) throw new Error("Move the existing lesson.mp4 before rendering again.");
  const storyboard = slides.parse(JSON.parse(fs.readFileSync(asset(project, "slides.json", [".json"]), "utf8")));
  const scenes = storyboard.map(({ image, narration, overlays }) => ({
    image: asset(project, image, imageTypes),
    narration: asset(project, narration, [".txt"]),
    overlays: overlays.map(layer => ({ ...layer, image: asset(project, layer.image, imageTypes) })),
  }));
  const tools = getVideoTools();
  const scratch = videoScratch(project, scratchDirectory);
  const env = videoEnvironment(tools, scratch);
  const work = fs.mkdtempSync(path.join(scratch.temp, "slides-"));
  try {
    const stillInput = (file: string) => ["-protocol_whitelist", "file,pipe", "-loop", "1", "-framerate", "30", "-i", file];
    const segments = scenes.map(({ image, narration, overlays }, index) => {
      const frame = path.join(work, "frame.png");
      const speech = path.join(work, "voice.wav");
      const segment = `slide-${index + 1}.mp4`;
      runTool(tools.node, ["-e", rasterize, tools.hyperframes, image, frame], env, work);
      runTool(tools.node, [tools.voice, tools.model, narration, speech], env, work);
      const layers = overlays.map(({ image, keyframes }, i) => {
        const file = path.join(work, `overlay-${i}.png`);
        runTool(tools.node, ["-e", rasterize, tools.hyperframes, image, file, "overlay"], env, work);
        const base = i === 0 ? "[0:v]" : `[layer${i - 1}]`;
        const filter = `${base}[${i + 1}:v]overlay=x='${position(keyframes, "x")}':y='${position(keyframes, "y")}'` +
          `:enable='gte(t,${keyframes[0].at})'[layer${i}]`;
        return { file, filter };
      });
      const video = layers.length
        ? ["-filter_complex", layers.map(layer => layer.filter).join(";"), "-map", `[layer${layers.length - 1}]`]
        : ["-map", "0:v"];
      runTool(tools.ffmpeg, [
        "-v", "error", "-y", ...stillInput(frame), ...layers.flatMap(layer => stillInput(layer.file)),
        "-protocol_whitelist", "file,pipe", "-f", "wav", "-i", speech,
        ...video, "-map", `${layers.length + 1}:a`,
        "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "48000", "-ac", "1", "-shortest", segment,
      ], env, work);
      return segment;
    });
    fs.writeFileSync(path.join(work, "segments.txt"), segments.map(file => `file '${file}'\n`).join(""));
    const assembled = path.join(work, "lesson.mp4");
    runTool(tools.ffmpeg, [
      "-v", "error", "-protocol_whitelist", "file,pipe", "-f", "concat", "-safe", "1", "-i", "segments.txt",
      "-c", "copy", "-movflags", "+faststart", assembled,
    ], env, work);
    runTool(tools.ffmpeg, ["-v", "error", "-xerror", "-i", assembled, "-f", "null", "-"], env, work);
    fs.copyFileSync(assembled, output, fs.constants.COPYFILE_EXCL);
    return { ok: true, output, slides: scenes.length };
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  }
}
