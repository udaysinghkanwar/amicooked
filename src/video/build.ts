import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { parseLesson } from "./schema.js";
import { drawVisual, escape, type CueTiming } from "./visuals.js";
import { duration, synthesize } from "./process.js";
import { player, type Chapter } from "./player.js";
import { VIDEO_ASSETS } from "./assets.js";
import { videoCss as css } from "./theme.js";

const hash = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );
export function stamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}
export type BuildOptions = {
  out: string;
  cache?: string;
  python?: string;
  model?: string;
  voices?: string;
};
export type Timing = {
  hash: string;
  duration: number;
  chapters: (Chapter & { cues: CueTiming[] })[];
};

const accent = {
  concept: "#3159dc",
  example: "#087c69",
  mistake: "#ad3e36",
  practice: "#7250b6",
  recap: "#087c69",
};

export async function buildVideo(
  specFile: string,
  options: BuildOptions,
): Promise<Timing> {
  const specPath = path.resolve(specFile),
    out = path.resolve(options.out);
  const project = path.join(out, "project");
  const lesson = parseLesson(JSON.parse(await fs.readFile(specPath, "utf8")));
  const specHash = hash(JSON.stringify(lesson));
  if (await exists(out)) {
    const contents = await fs.readdir(out);
    if (contents.length) {
      const old: { hash: string } = JSON.parse(
        await fs
          .readFile(path.join(out, ".amicooked-video.json"), "utf8")
          .catch(() => {
            throw new Error("Choose an empty output directory");
          }),
      );
      if (old.hash !== specHash)
        throw new Error(
          "Lesson changed: choose a new output directory to preserve the previous delivery",
        );
    }
  }
  const cache = path.resolve(
    options.cache ?? path.join(os.homedir(), ".amicooked", "video-cache"),
  );
  await fs.mkdir(cache, { recursive: true });
  const usesTts = lesson.scenes.some((s) => s.cues.some((c) => !c.audio));
  let modelHash = "",
    voicesHash = "";
  if (usesTts) {
    if (!options.model || !options.voices)
      throw new Error(
        "Local narration needs --model and --voices Kokoro files, or an audio file for every cue. See the lecture-video setup guide.",
      );
    modelHash = hash(await fs.readFile(options.model));
    voicesHash = hash(await fs.readFile(options.voices));
  }
  const prepared = new Map<
    string,
    { file: string; key: string; extension: string }
  >();
  const jobs = new Map<string, { text: string; output: string }>();
  for (const scene of lesson.scenes)
    for (const cue of scene.cues) {
      const text = cue.spoken ?? cue.text;
      const input = cue.audio
        ? path.resolve(path.dirname(specPath), cue.audio)
        : undefined;
      const key = input
        ? hash(await fs.readFile(input))
        : hash(
            JSON.stringify({
              text,
              ...lesson.narration,
              modelHash,
              voicesHash,
            }),
          );
      const file = input ?? path.join(cache, `${key}.wav`);
      prepared.set(`${scene.id}/${cue.id}`, {
        file,
        key,
        extension: input ? path.extname(input) : ".wav",
      });
      if (!(await exists(file)))
        jobs.set(file, { text, output: `${file}.${process.pid}.tmp.wav` });
    }
  if (jobs.size) {
    try {
      await synthesize([...jobs.values()], {
        python:
          options.python ??
          process.env.AMICOOKED_VIDEO_PYTHON ??
          (process.platform === "win32" ? "python" : "python3"),
        model: path.resolve(options.model!),
        voices: path.resolve(options.voices!),
        ...lesson.narration,
      });
      for (const [file, job] of jobs) await fs.rename(job.output, file);
    } finally {
      for (const job of jobs.values()) await fs.rm(job.output, { force: true });
    }
  }
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(
    path.join(out, ".amicooked-video.json"),
    JSON.stringify({ hash: specHash }),
  );
  await fs.mkdir(path.join(project, "assets", "voice"), { recursive: true });
  for (const [name, base64] of Object.entries(VIDEO_ASSETS)) {
    const target = path.join(project, "assets", name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(base64, "base64"));
  }
  const chapters: Timing["chapters"] = [],
    captions: { start: number; end: number; text: string }[] = [];
  const animations: string[] = [];
  const hosts: string[] = [],
    audios: string[] = [],
    notes = [
      `# ${lesson.title}`,
      "",
      lesson.goal,
      "",
      `Mode: ${lesson.mode}`,
      "",
      "## Sources",
      ...lesson.sources.map((s) => `- ${s.id}: ${s.title} — ${s.location}`),
    ];
  let total = 0;
  for (const scene of lesson.scenes) {
    const cues: CueTiming[] = [];
    let local = 0.25;
    for (const cue of scene.cues) {
      const {
        file: cached,
        key,
        extension,
      } = prepared.get(`${scene.id}/${cue.id}`)!;
      const seconds = await duration(cached);
      const asset = `assets/voice/${key}${extension}`;
      await fs.copyFile(cached, path.join(project, asset));
      cues.push({
        id: cue.id,
        start: local,
        end: local + seconds,
        text: cue.text,
      });
      captions.push({
        start: total + local,
        end: total + local + seconds,
        text: cue.text,
      });
      audios.push(
        `<audio id="${scene.id}-voice-${cue.id}" class="clip" src="${escape(asset)}" data-start="${total + local}" data-duration="${seconds}" data-track-index="2" data-volume="1"></audio>`,
      );
      local += seconds + 0.25 + cue.pauseAfter;
    }
    const sceneDuration = local + 0.5;
    const drawing = drawVisual(
      scene.visual,
      scene.id,
      cues.map((c) => ({ ...c, start: c.start + total, end: c.end + total })),
    );
    const cap = cues
      .map(
        (c) =>
          `<div id="${scene.id}-caption-${c.id}" class="clip caption" data-start="${total + c.start}" data-duration="${c.end - c.start}" data-track-kind="captions">${escape(c.text)}</div>`,
      )
      .join("");
    const source = scene.sources
      .map((id) => lesson.sources.find((s) => s.id === id)!.title)
      .join(" · ");
    hosts.push(
      `<section id="${scene.id}" class="clip lesson-scene" data-start="${total}" data-duration="${sceneDuration}" data-track-index="1" data-track-kind="graphics" style="--accent:${accent[scene.kind]}"><div class="topline">${escape(lesson.title)}</div><div class="kind">${scene.kind}</div><h1>${escape(scene.title)}</h1><div class="rule"></div><div data-hold>${drawing.html}</div><div class="source">${escape(source)}</div>${cap}<div id="${scene.id}-progress" class="progress"></div></section>`,
    );
    animations.push(
      drawing.js,
      `tl.fromTo('#${scene.id}-progress',{scaleX:0},{scaleX:1,duration:${sceneDuration},ease:'none'},${total});`,
    );
    chapters.push({
      id: scene.id,
      title: scene.title,
      start: total,
      duration: sceneDuration,
      cues,
    });
    notes.push(
      "",
      `## ${scene.title} (${stamp(total).slice(0, 8)})`,
      `Sources: ${scene.sources.join(", ")}`,
      ...scene.cues.map((c) => c.text),
    );
    if (scene.check)
      notes.push(
        `Practice: ${scene.check.question}`,
        `Reference answer: ${scene.check.answer}`,
      );
    total += sceneDuration;
  }
  const timing: Timing = { hash: specHash, duration: total, chapters };
  const root = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(lesson.title)}</title><script src="assets/gsap.min.js"></script><script src="assets/katex.min.js"></script><link rel="stylesheet" href="assets/katex.min.css"><style>html,body{margin:0;background:#f5f8ff}.clip{position:absolute;inset:0}${css}</style><div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1920" data-height="1080" data-fps="30">${hosts.join("")}${audios.join("")}</div><script>document.querySelectorAll('[data-math]').forEach(el=>katex.render(el.dataset.math,el,{throwOnError:true,trust:false}));const tl=gsap.timeline({paused:true});${animations.join("\n")}window.__timelines=window.__timelines||{};window.__timelines.main=tl;</script></html>`;
  await fs.writeFile(path.join(project, "index.html"), root);
  await fs.writeFile(path.join(out, "player.html"), player(lesson, chapters));
  await fs.writeFile(
    path.join(out, "captions.vtt"),
    "WEBVTT\n\n" +
      captions
        .map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`)
        .join("\n\n") +
      "\n",
  );
  await fs.writeFile(
    path.join(out, "captions.srt"),
    captions
      .map(
        (c, i) =>
          `${i + 1}\n${stamp(c.start).replace(".", ",")} --> ${stamp(c.end).replace(".", ",")}\n${c.text}`,
      )
      .join("\n\n") + "\n",
  );
  await fs.writeFile(path.join(out, "notes.md"), notes.join("\n") + "\n");
  await fs.writeFile(
    path.join(out, "transcript.txt"),
    lesson.scenes
      .map((s) => `${s.title}\n${s.cues.map((c) => c.text).join("\n")}`)
      .join("\n\n"),
  );
  await fs.writeFile(
    path.join(out, "lesson.json"),
    JSON.stringify(lesson, null, 2),
  );
  await fs.writeFile(
    path.join(out, "timing.json"),
    JSON.stringify(timing, null, 2),
  );
  return timing;
}
