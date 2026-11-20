import { parseArgs } from "node:util";
import path from "node:path";
import * as fs from "node:fs/promises";
import { buildVideo, type Timing } from "./build.js";
import { hyperframes, run, HF_VERSION, CommandError } from "./process.js";
import { serveVideo } from "./serve.js";
import { VIDEO_EXAMPLES } from "./examples.js";

const help = `Local lecture videos (Node 22+, FFmpeg/FFprobe, Chrome/Chromium).

  amicooked video example break-even|breadth-first|petri-net
  amicooked video build lesson.json --out lesson-folder
      --python <executable> --model <kokoro.onnx> --voices <voices.bin>
      Or provide local audio paths per cue; no Python or model needed.
  amicooked video check lesson-folder
  amicooked video render lesson-folder
  amicooked video serve lesson-folder --port 8058

Build creates editable HTML, captions, notes and a study player from validated JSON.
Check/render use HyperFrames ${HF_VERSION} via npx (first use needs internet).
Narration stays local; no AI provider, API key or school login is required.
`;

export function assertCheckPassed(report: { ok?: boolean }) {
  if (report.ok !== true)
    throw new Error(
      "Video checks failed. Read check.json and fix the project before rendering.",
    );
}

export async function checkVideo(directory: string) {
  const project = path.join(directory, "project");
  let raw: string;
  try {
    raw = await hyperframes(["check", "--json"], project);
  } catch (error) {
    if (
      !(error instanceof CommandError) ||
      !error.stdout.trim().startsWith("{")
    )
      throw error;
    await fs.writeFile(path.join(directory, "check.json"), error.stdout);
    throw error;
  }
  const report = JSON.parse(raw);
  await fs.writeFile(
    path.join(directory, "check.json"),
    JSON.stringify(report, null, 2),
  );
  assertCheckPassed(report);
  const timing: Timing = JSON.parse(
    await fs.readFile(path.join(directory, "timing.json"), "utf8"),
  );
  const times = timing.chapters.flatMap((c) => [
    c.start + Math.min(1, c.duration / 3),
    ...c.cues.map(
      (q) => c.start + q.start + Math.min(0.8, (q.end - q.start) / 2),
    ),
  ]);
  await hyperframes(
    ["snapshot", "--at", times.map((t) => t.toFixed(2)).join(",")],
    project,
  );
  return report;
}

export async function renderVideo(directory: string) {
  // Inspect saved snapshots separately; automated validation is a gate, not a teaching-quality score.
  await checkVideo(directory);
  const temporary = "lesson.rendering.mp4";
  try {
    await hyperframes(
      [
        "render",
        "--quality",
        "delivery",
        "--output",
        path.join(directory, temporary),
      ],
      path.join(directory, "project"),
    );
    const info = JSON.parse(
      await run("ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        path.join(directory, temporary),
      ]),
    );
    const timing: Timing = JSON.parse(
      await fs.readFile(path.join(directory, "timing.json"), "utf8"),
    );
    if (
      !info.streams.some(
        (s: { codec_type: string }) => s.codec_type === "video",
      ) ||
      !info.streams.some(
        (s: { codec_type: string }) => s.codec_type === "audio",
      ) ||
      Math.abs(Number(info.format.duration) - timing.duration) > 0.15
    )
      throw new Error("Export is missing tracks or has an incorrect duration");
    await run(
      "ffmpeg",
      ["-v", "error", "-i", path.join(directory, temporary), "-f", "null", "-"],
      { timeout: 300_000 },
    );
    const dest = path.join(directory, "lesson.mp4");
    if (
      await fs.access(dest).then(
        () => true,
        () => false,
      )
    )
      await fs.rename(
        dest,
        path.join(directory, `lesson.previous-${Date.now()}.mp4`),
      );
    await fs.rename(path.join(directory, temporary), dest);
    await run("ffmpeg", [
      "-v",
      "error",
      "-ss",
      "1",
      "-i",
      dest,
      "-frames:v",
      "1",
      "-y",
      path.join(directory, "poster.png"),
    ]);
    await fs.writeFile(
      path.join(directory, "media-check.json"),
      JSON.stringify(
        {
          duration: info.format.duration,
          streams: info.streams.map(
            (s: { codec_type: string; codec_name: string }) => ({
              type: s.codec_type,
              codec: s.codec_name,
            }),
          ),
          fullDecode: true,
        },
        null,
        2,
      ),
    );
    return dest;
  } finally {
    await fs.rm(path.join(directory, temporary), { force: true });
  }
}

export async function videoCommand(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      cache: { type: "string" },
      python: { type: "string" },
      model: { type: "string" },
      voices: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, input] = positionals;
  if (values.help || !command) {
    console.log(help);
    return 0;
  }
  if (command === "example") {
    if (!input || !Object.hasOwn(VIDEO_EXAMPLES, input))
      throw new Error(
        `Choose an example: ${Object.keys(VIDEO_EXAMPLES).join(", ")}`,
      );
    console.log(JSON.stringify(VIDEO_EXAMPLES[input], null, 2));
    return 0;
  }
  if (!input)
    throw new Error(
      "Provide a lesson JSON file or built lesson folder. Run amicooked video --help.",
    );
  const directory = path.resolve(input);
  if (command === "build") {
    if (!values.out) throw new Error("Choose an output directory with --out");
    const timing = await buildVideo(directory, { ...values, out: values.out });
    console.log(
      `Built ${timing.chapters.length} chapters, ${timing.duration.toFixed(1)} seconds. Inspect the project before rendering.`,
    );
  } else if (command === "check") {
    await checkVideo(directory);
    console.log(
      "Checks passed; inspect the snapshots and narration before rendering.",
    );
  } else if (command === "render") console.log(await renderVideo(directory));
  else if (command === "serve") {
    const port = Number(values.port ?? 8058);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error("Choose a port between 1024 and 65535");
    await serveVideo(directory, port);
    console.log(`Study player: http://127.0.0.1:${port}/`);
    return new Promise<number>(() => {});
  } else throw new Error(`Unknown video command ${command}`);
  return 0;
}
