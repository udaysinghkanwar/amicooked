import * as fs from "node:fs";
import path from "node:path";
import { runTool } from "./install.js";
import { getVideoTools, videoEnvironment } from "./runtime.js";
import { narrateSlide, readSlideStoryboard } from "./slides.js";
import { videoScratch } from "./workspace.js";

const VENDORED_GSAP = "dist/vendor/npm/gsap@3.14.2/dist/gsap.min.js";

/** Renders with HyperFrames, giving up once `until` (ms since epoch) passes so the slide fallback still has time. */
export function renderAnimatedLesson(project: string, until = Number.POSITIVE_INFINITY) {
  const left = (step: string) => {
    const ms = until - Date.now();
    if (ms <= 0) throw new Error(`HyperFrames ran out of time before ${step}.`);
    return ms;
  };
  const scenes = readSlideStoryboard(project);
  const tools = getVideoTools();
  const scratch = videoScratch(project);
  const env = videoEnvironment(tools, scratch);
  const work = fs.mkdtempSync(path.join(scratch.temp, "lecture-animation-"));
  try {
    fs.copyFileSync(path.resolve(path.dirname(tools.hyperframes), "..", VENDORED_GSAP), path.join(work, "gsap.js"));
    // Serve only the storyboard's validated images, generated narration and our own fixed template.
    const copyImage = (file: string, stem: string) => {
      const name = stem + path.extname(file).toLowerCase();
      fs.copyFileSync(file, path.join(work, name));
      return name;
    };
    let start = 0;
    const timeline: string[] = [];
    const sections = scenes.map(({ image, narration, overlays }, index) => {
      const scene = `scene-${index}`;
      const audio = `${scene}.wav`;
      left(`narrating scene ${index + 1}`);
      const duration = narrateSlide(tools, narration, path.join(work, audio), env, work);
      const transition = Math.min(0.32, duration / 4);
      timeline.push(`tl.from("#${scene} .art",{opacity:0,scale:.985,duration:${transition},ease:"power2.out"},${start});`);
      const layers = overlays.map(({ image, keyframes }, layerIndex) => {
        const id = `${scene}-layer-${layerIndex}`;
        const first = keyframes[0];
        timeline.push(`tl.set("#${id}",{x:${first.x},y:${first.y},opacity:1},${start + first.at});`);
        for (let i = 1; i < keyframes.length; i++) {
          const frame = keyframes[i];
          const previous = keyframes[i - 1];
          timeline.push(`tl.to("#${id}",{x:${frame.x},y:${frame.y},duration:${frame.at - previous.at},ease:"sine.inOut"},${start + previous.at});`);
        }
        return `<img id="${id}" class="layer" src="${copyImage(image, id)}" alt="">`;
      }).join("");
      const section = `<section id="${scene}" class="clip scene" data-start="${start}" data-duration="${duration}" data-track-index="0" data-layout-allow-overlap>
<div class="art"><img class="slide" src="${copyImage(image, scene)}" alt="">${layers}</div></section>
<audio id="${scene}-audio" class="clip" data-start="${start}" data-duration="${duration}" data-track-index="1" src="${audio}"></audio>`;
      start += duration;
      return section;
    });
    fs.writeFileSync(path.join(work, "index.html"), `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Am I Cooked lecture video</title>
<style>body{margin:0;background:#111827}main,.art,.scene{width:1280px;height:720px;overflow:hidden}
main{position:relative}.art,.scene,.slide,.layer{position:absolute;inset:0}
.slide{width:100%;height:100%;object-fit:contain}.layer{opacity:0}</style>
<main data-composition-id="lesson" data-width="1280" data-height="720" data-duration="${start}">
${sections.join("\n")}</main><script src="gsap.js"></script><script>
const tl=gsap.timeline({paused:true});${timeline.join("\n")}
window.__timelines={lesson:tl};</script></html>`);

    const assembled = path.join(work, "lesson.mp4");
    runTool(tools.node, [tools.hyperframes, "render", "--quality", "delivery", "--workers", "1", "--no-best-effort", "--output", assembled], env, work,
      Math.min(20 * 60_000, left("rendering")));
    const { streams } = JSON.parse(runTool(tools.ffprobe,
      ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", assembled], env));
    if (!["audio", "video"].every(type => streams.some((stream: { codec_type: string }) => stream.codec_type === type))) {
      throw new Error("The lesson render did not contain both video and narration.");
    }
    runTool(tools.ffmpeg, ["-v", "error", "-xerror", "-i", assembled, "-f", "null", "-"], env);
    const output = path.join(project, "lesson.mp4");
    fs.copyFileSync(assembled, output, fs.constants.COPYFILE_EXCL);
    return { output, slides: scenes.length };
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  }
}
