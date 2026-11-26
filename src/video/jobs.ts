import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { selfCommand } from "../clients/self.js";
import { getLesson, lessonsRoot } from "./lessons.js";
import { prepareVideo, videoStatus } from "./runtime.js";
import { renderSlides } from "./slides.js";

// Renders run as a child process of the same Am I Cooked launcher (`video render-lesson`), so a render that takes
// minutes never blocks other tool calls, a crash can't take the server down, and it can be stopped on a deadline.
// State lives in job.json inside the lesson, so any Am I Cooked process (each AI app starts its own) can report it.

export const RENDER_LIMIT_MS = 30 * 60 * 1000;

export interface Job {
  jobId: string;
  state: "running" | "done" | "failed";
  pid?: number;
  startedAt: string;
  deadline: string;
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

export function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Stops a render and anything it started (FFmpeg, the voice model). */
export function stopTree(pid: number, platform = process.platform) {
  if (platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else {
    // Started detached, so the render leads its own process group
    try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  }
}

function logTail(folder: string, lines = 15): string {
  try { return fs.readFileSync(logFile(folder), "utf8").trim().split(/\r?\n/).slice(-lines).join("\n").slice(-2000); } catch { return ""; }
}

/** The current state, settling jobs whose process died or ran past the deadline. */
export function renderStatus(id: string, now = Date.now(), stop: (pid: number) => void = stopTree): Job & { lessonId: string; log?: string } {
  const lesson = getLesson(id);
  const job = readJob(lesson.folder);
  if (!job) throw new Error(`Lesson "${id}" hasn't been rendered yet. Call start_video_render.`);
  if (job.state === "running") {
    if (now > Date.parse(job.deadline)) {
      if (job.pid) stop(job.pid);
      Object.assign(job, { state: "failed", finishedAt: new Date(now).toISOString(), error: `The render took longer than ${RENDER_LIMIT_MS / 60000} minutes and was stopped.` });
      writeJob(lesson.folder, job);
    } else if (job.pid && !isAlive(job.pid)) {
      Object.assign(job, { state: "failed", finishedAt: new Date(now).toISOString(), error: "The render stopped unexpectedly." });
      writeJob(lesson.folder, job);
    }
  }
  return { ...job, lessonId: id, ...(job.state === "failed" && { log: logTail(lesson.folder) }) };
}

/** Another lesson with a live render, if any: one render at a time keeps a student's laptop usable. */
function otherRunning(except: string): string | undefined {
  const root = lessonsRoot();
  if (!fs.existsSync(root)) return undefined;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === except) continue;
    const job = readJob(path.join(root, entry.name));
    if (job?.state === "running" && isAlive(job.pid) && Date.now() <= Date.parse(job.deadline)) return entry.name;
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

/** Starts a render, or returns the one already running or finished. Safe to call twice. */
export function startRender(id: string, launch: Launch = launchDetached, now = Date.now()) {
  const lesson = getLesson(id);
  const output = path.join(lesson.folder, "lesson.mp4");
  const current = readJob(lesson.folder);
  if (current?.state === "running" && isAlive(current.pid) && now <= Date.parse(current.deadline)) return renderStatus(id, now);
  if (fs.existsSync(output)) {
    if (current?.state === "done") return renderStatus(id, now);
    throw new Error("This lesson already has a lesson.mp4. Create a new lesson to render again.");
  }
  const busy = otherRunning(id);
  if (busy) throw new Error(`Another lesson ("${busy}") is still rendering. Try again when it finishes.`);

  const job: Job = {
    jobId: randomBytes(6).toString("hex"), state: "running",
    startedAt: new Date(now).toISOString(), deadline: new Date(now + RENDER_LIMIT_MS).toISOString(),
  };
  writeJob(lesson.folder, job);
  const self = selfCommand(["video", "render-lesson", "--lesson", id, "--job", job.jobId]);
  const log = fs.openSync(logFile(lesson.folder), "w", 0o600);
  try {
    job.pid = launch(self.command, self.args, { ...process.env, ...self.env }, log);
  } finally {
    fs.closeSync(log);
  }
  if (!job.pid) {
    Object.assign(job, { state: "failed", error: "Am I Cooked couldn't start the renderer." });
  } else {
    // Backstop for a render nobody checks on: stop it at the deadline if this server is still running
    setTimeout(() => { if (readJob(lesson.folder)?.state === "running") renderStatus(id); }, RENDER_LIMIT_MS + 5000).unref();
  }
  writeJob(lesson.folder, job);
  return renderStatus(id, now);
}

/** The hidden `video render-lesson` command: the child process that does the work. */
export async function renderLessonCommand(id: string, jobId: string, prepare = prepareVideo): Promise<number> {
  const lesson = getLesson(id);
  const job = readJob(lesson.folder);
  if (!job || job.jobId !== jobId || job.state !== "running") return 1;
  try {
    // A chat with no shell can't run video prepare, so fetch the narrated slide tools here when they're missing
    const status = videoStatus();
    if (status.state !== "ready" && status.slidesState !== "ready") await prepare(console.error, true);
    const result = renderSlides(lesson.folder);
    writeJob(lesson.folder, { ...job, pid: process.pid, state: "done", finishedAt: new Date().toISOString(), output: result.output, slides: result.slides });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    writeJob(lesson.folder, { ...job, pid: process.pid, state: "failed", finishedAt: new Date().toISOString(), error: message.slice(0, 1000) });
    return 1;
  }
}
