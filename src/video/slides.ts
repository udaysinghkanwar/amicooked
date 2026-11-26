import * as fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { runTool } from "./install.js";
import { getVideoTools, videoEnvironment } from "./runtime.js";
import { videoProject, videoScratch } from "./workspace.js";

const slides = z.array(z.object({ image: z.string(), narration: z.string() })).min(1);

function asset(project: string, name: string, extensions: string[]): string {
  if (path.isAbsolute(name)) throw new Error("Use relative paths for slide assets.");
  const file = fs.realpathSync.native(path.resolve(project, name));
  if (!file.startsWith(project + path.sep) || !extensions.includes(path.extname(file).toLowerCase()) ||
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
sharp(readFileSync(process.argv[2]))
  .resize(1280, 720, { fit: "contain", background })
  .flatten({ background }).png().toFile(process.argv[3])
  .catch(error => { console.error(error.message); process.exitCode = 1; });
`;

export function renderSlides(directory?: string, scratchDirectory?: string) {
  const project = videoProject(directory);
  const output = path.join(project, "lesson.mp4");
  if (fs.existsSync(output)) throw new Error("Move the existing lesson.mp4 before rendering again.");
  const storyboard = slides.parse(JSON.parse(fs.readFileSync(asset(project, "slides.json", [".json"]), "utf8")));
  const scenes = storyboard.map(({ image, narration }) => ({
    image: asset(project, image, [".svg", ".png", ".jpg", ".jpeg"]),
    narration: asset(project, narration, [".txt"]),
  }));
  const tools = getVideoTools();
  const scratch = videoScratch(project, scratchDirectory);
  const env = videoEnvironment(tools, scratch);
  const work = fs.mkdtempSync(path.join(scratch.temp, "slides-"));
  try {
    const segments = scenes.map(({ image, narration }, index) => {
      const frame = path.join(work, "frame.png");
      const speech = path.join(work, "voice.wav");
      const segment = `slide-${index + 1}.mp4`;
      runTool(tools.node, ["-e", rasterize, tools.hyperframes, image, frame], env, work);
      runTool(tools.node, [tools.voice, tools.model, narration, speech], env, work);
      runTool(tools.ffmpeg, [
        "-v", "error", "-y", "-protocol_whitelist", "file,pipe", "-loop", "1", "-framerate", "30", "-i", frame,
        "-protocol_whitelist", "file,pipe", "-f", "wav", "-i", speech,
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
