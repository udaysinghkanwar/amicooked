import spawn from "cross-spawn";

export class CommandError extends Error {
  constructor(
    command: string,
    public stdout: string,
    stderr: string,
    code: number | null,
  ) {
    super(
      `${command} failed (${code}): ${stderr.slice(-3000) || stdout.slice(-3000)}`,
    );
  }
}

export async function run(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; timeout?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out`));
    }, options.timeout ?? 300_000);
    child.stdout!.on("data", (data) => {
      stdout = (stdout + data).slice(-10_000_000);
    });
    child.stderr!.on("data", (data) => {
      stderr = (stderr + data).slice(-100_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not run ${command}: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(stdout)
        : reject(new CommandError(command, stdout, stderr, code));
    });
    child.stdin!.on("error", () => {}); // Early executable failure is reported through error/close.
    child.stdin!.end(options.input);
  });
}

export const HF_VERSION = "0.9.72";
export const hyperframes = (args: string[], cwd: string) =>
  run("npx", ["--yes", `hyperframes@${HF_VERSION}`, ...args], {
    cwd,
    timeout: 1_800_000,
  });

export async function duration(file: string): Promise<number> {
  const seconds = Number(
    (
      await run("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nw=1:nk=1",
        file,
      ])
    ).trim(),
  );
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600)
    throw new Error(`Invalid audio duration for ${file}`);
  return seconds;
}

const kokoroScript = `import sys, json
import soundfile as sf
from kokoro_onnx import Kokoro
model, voices, voice, speed, language = sys.argv[1:]
k = Kokoro(model, voices)
for job in json.load(sys.stdin):
    audio, rate = k.create(job['text'], voice=voice, speed=float(speed), lang=language)
    sf.write(job['output'], audio, rate, subtype="PCM_16")
`;

export async function synthesize(
  jobs: { text: string; output: string }[],
  settings: {
    python: string;
    model: string;
    voices: string;
    voice: string;
    speed: number;
    language: string;
  },
) {
  await run(
    settings.python,
    [
      "-c",
      kokoroScript,
      settings.model,
      settings.voices,
      settings.voice,
      String(settings.speed),
      settings.language,
    ],
    { input: JSON.stringify(jobs), timeout: 1_800_000 },
  );
}
