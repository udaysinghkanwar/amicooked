import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { selfCommand } from "../clients/self.js";
import { checkLessonFiles, getLesson, lessonsRoot } from "./lessons.js";
import { prepareVideo, videoStatus } from "./runtime.js";
import { renderSlides } from "./slides.js";

// A render runs as two processes of the same Am I Cooked launcher, so minutes of work never block a tool call and
// a crash can't take the server down:
//
// - `video render-lesson` is a detached supervisor. It owns job.json while it runs, writes a heartbeat and
//   stops its own renderer child at the deadline. Because it holds that child's handle,
//   the PID it stops can't belong to anything else.
// - `video render-lesson-work` fetches missing slide tools, renders and prints its result. Preparation runs
//   blocking installs, so it lives here, where the supervisor's heartbeat and deadline still cover it.
//
// Status only reads job.json, so any Am I Cooked process (each AI app starts its own) can report it. A heartbeat
// that stops means the supervisor died; nothing is ever killed on the strength of a saved PID.

export const RENDER_LIMIT_MS = 30 * 60 * 1000;
export const HEARTBEAT_MS = 10_000;
/** No heartbeat for this long means the supervisor is gone (it also covers a slow first start). */
export const STALE_MS = 60_000;

export interface Job {
  jobId: string;
  state: "running" | "done" | "failed";
  startedAt: string;
  deadline: string;
  heartbeat?: string;
  finishedAt?: string;
  output?: string;
  slides?: number;
  error?: string;
}

const jobFile = (folder: string) => path.join(folder, "job.json");
const logFile = (folder: string) => path.join(folder, "job.log");

function readJob(folder: string): Job | undefined {
  try { return JSON.parse(fs.readFileSync(jobFile(folder), "utf8")) as Job; } catch { return undefined; }
}
function writeJob(folder: string, job: Job) {
  const tmp = `${jobFile(folder)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2) + "\n");
  fs.renameSync(tmp, jobFile(folder));
}

/** Whether a job recorded as running still has a live supervisor. */
function live(job: Job | undefined, now: number): boolean {
  return !!job && job.state === "running" && now - Date.parse(job.heartbeat ?? job.startedAt) < STALE_MS;
}

/** Stops a renderer and anything it started (FFmpeg, the voice model). */
export function stopTree(pid: number, platform = process.platform) {
  if (platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else {
    // Started detached, so the renderer leads its own process group
    try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  }
}

function logTail(folder: string, lines = 15): string {
  try { return fs.readFileSync(logFile(folder), "utf8").trim().split(/\r?\n/).slice(-lines).join("\n").slice(-2000); } catch { return ""; }
}

/** The current state. Read-only: a running job whose supervisor stopped reporting is shown as failed. */
export function renderStatus(id: string, now = Date.now()): Job & { lessonId: string; log?: string } {
  const lesson = getLesson(id);
  const job = readJob(lesson.folder);
  if (!job) throw new Error(`Lesson "${id}" hasn't been rendered yet. Call start_video_render.`);
  const shown: Job = job.state === "running" && !live(job, now)
    ? { ...job, state: "failed", error: "The render stopped unexpectedly. Call start_video_render to try again." }
    : job;
  return { ...shown, lessonId: id, ...(shown.state === "failed" && { log: logTail(lesson.folder) }) };
}

/** Serializes starts across every Am I Cooked process, so two apps can't start renders at once. */
function withStartLock<T>(run: () => T): T {
  const root = lessonsRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, ".render.lock");
  for (let attempt = 0; ; attempt++) {
    try {
      fs.closeSync(fs.openSync(lock, "wx", 0o600));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A start takes milliseconds; a lock this old was left by a process that died mid-start
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }
      if (age > 30_000) { fs.rmSync(lock, { force: true }); continue; }
      if (attempt >= 50) throw new Error("Another render is starting. Try again in a moment.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return run(); } finally { fs.rmSync(lock, { force: true }); }
}

/** Another lesson with a live render, if any: one render at a time keeps a student's laptop usable. */
function otherRunning(except: string, now: number): string | undefined {
  for (const entry of fs.readdirSync(lessonsRoot(), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== except && live(readJob(path.join(lessonsRoot(), entry.name)), now)) return entry.name;
  }
  return undefined;
}

type Launch = (command: string, args: string[], env: NodeJS.ProcessEnv, log: number) => number | undefined;
const launchDetached: Launch = (command, args, env, log) => {
  const child = spawn(command, args, { detached: true, windowsHide: true, stdio: ["ignore", log, log], env });
  child.on("error", () => {});
  child.unref();
  return child.pid;
};

/** Starts a render, or returns the one already running or finished. Safe to call twice, from any app. */
export function startRender(id: string, launch: Launch = launchDetached, now = Date.now()) {
  const lesson = getLesson(id);
  return withStartLock(() => {
    const output = path.join(lesson.folder, "lesson.mp4");
    const current = readJob(lesson.folder);
    if (live(current, now)) return renderStatus(id, now);
    if (fs.existsSync(output)) {
      if (current?.state === "done") return renderStatus(id, now);
      throw new Error("This lesson already has a lesson.mp4. Create a new lesson to render again.");
    }
    const busy = otherRunning(id, now);
    if (busy) throw new Error(`Another lesson ("${busy}") is still rendering. Try again when it finishes.`);

    const job: Job = {
      jobId: randomBytes(6).toString("hex"), state: "running",
      startedAt: new Date(now).toISOString(), deadline: new Date(now + RENDER_LIMIT_MS).toISOString(),
    };
    writeJob(lesson.folder, job);
    const self = selfCommand(["video", "render-lesson", "--lesson", id, "--job", job.jobId]);
    const log = fs.openSync(logFile(lesson.folder), "w", 0o600);
    let pid: number | undefined;
    try { pid = launch(self.command, self.args, { ...process.env, ...self.env }, log); } finally { fs.closeSync(log); }
    if (!pid) writeJob(lesson.folder, { ...job, state: "failed", finishedAt: new Date(now).toISOString(), error: "Am I Cooked couldn't start the renderer." });
    return renderStatus(id, now);
  });
}

export interface SupervisorDeps {
  /** Starts the renderer child. Its stdout carries the result as JSON. */
  work?: (id: string) => ChildProcess;
  stop?: (pid: number) => void;
}

const startWork = (id: string): ChildProcess => {
  const self = selfCommand(["video", "render-lesson-work", "--lesson", id]);
  // Detached on macOS and Linux so the renderer leads a process group the supervisor can stop as a whole
  return spawn(self.command, self.args, {
    detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, ...self.env },
  });
};

/** The hidden `video render-lesson` command: the supervisor for one job. */
export async function renderLessonCommand(id: string, jobId: string, deps: SupervisorDeps = {}): Promise<number> {
  const { work = startWork, stop = stopTree } = deps;
  const lesson = getLesson(id);
  const job = readJob(lesson.folder);
  if (!job || job.jobId !== jobId || job.state !== "running") return 1;

  let finished = false;
  let child: ChildProcess | undefined;
  const finish = (update: Partial<Job>) => {
    if (finished) return;
    finished = true;
    writeJob(lesson.folder, { ...job, ...update, heartbeat: new Date().toISOString(), finishedAt: new Date().toISOString() });
  };
  const beat = () => { if (!finished) writeJob(lesson.folder, { ...job, heartbeat: new Date().toISOString() }); };
  beat();
  const heartbeat = setInterval(beat, HEARTBEAT_MS);
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<number>(resolve => {
    timeout = setTimeout(() => {
      // Only our own live child is stopped, never a PID read back from disk
      if (child?.pid && child.exitCode === null && child.signalCode === null) stop(child.pid);
      finish({ state: "failed", error: `The render took longer than ${RENDER_LIMIT_MS / 60000} minutes and was stopped.` });
      resolve(1);
    }, Math.max(0, Date.parse(job.deadline) - Date.now()));
  });
  const render = (async () => {
    try {
      child = work(id);
      let stdout = "";
      child.stdout?.on("data", chunk => { stdout += chunk; });
      const code = await new Promise<number | null>((resolve, reject) => { child!.once("error", reject); child!.once("close", resolve); });
      if (finished) return 1;
      if (code !== 0) throw new Error(`The renderer stopped with exit code ${code}. See the log for details.`);
      const result = JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? "{}") as { output?: string; slides?: number };
      finish({ state: "done", output: result.output, slides: result.slides });
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      finish({ state: "failed", error: message.slice(0, 1000) });
      return 1;
    }
  })();
  try {
    return await Promise.race([render, deadline]);
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timeout);
  }
}

/** The hidden `video render-lesson-work` command: prepares the slide tools if needed, checks the lesson again and renders it. */
export async function renderLessonWork(id: string, prepare = prepareVideo): Promise<number> {
  const lesson = getLesson(id);
  // A chat with no shell can't run video prepare, so fetch the narrated slide tools here when they're missing
  const status = videoStatus();
  if (status.state !== "ready" && status.slidesState !== "ready") await prepare(console.error, true);
  checkLessonFiles(lesson.folder);
  const result = renderSlides(lesson.folder);
  console.log(JSON.stringify({ output: result.output, slides: result.slides }));
  return 0;
}
