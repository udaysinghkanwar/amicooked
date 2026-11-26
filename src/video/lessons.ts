import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config.js";
import { svgProblem } from "./svg.js";
import { realPath } from "./workspace.js";

// Lessons an AI app builds through Am I Cooked's tools (#21), for chats with no shell on the student's computer.
// Each lesson is a folder Am I Cooked creates under the student's files folder. The AI may only write a few
// text formats into it, and only Am I Cooked's fixed renderer reads them; nothing here runs a command.

export type LessonFormat = "slides";

export interface Lesson {
  id: string;
  title: string;
  format: LessonFormat;
  folder: string;
  created: string;
}

const MANIFEST = "lesson.json";
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const LIMITS = { fileBytes: 2 * 1024 * 1024, lessonBytes: 40 * 1024 * 1024, files: 400 };

/** What the AI may write for each format. Everything is UTF-8 text. */
const ALLOWED: Record<LessonFormat, string[]> = { slides: [".svg", ".txt", ".json"] };
/** Files Am I Cooked owns inside a lesson. */
const RESERVED = new Set([MANIFEST, "job.json", "job.log", "lesson.mp4"]);
/** Compared case-insensitively: Windows and default macOS volumes treat Lesson.JSON as lesson.json. */
const reserved = (name: string) => RESERVED.has(name.toLowerCase());

export const lessonsRoot = () => path.join(getConfig().filesDir, "Lessons");

const slug = (title: string) =>
  title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "lesson";

export function createLesson(title: string, format: LessonFormat = "slides"): Lesson {
  const cleanTitle = title.trim().slice(0, 200) || "Lesson";
  const root = lessonsRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const id = `${slug(cleanTitle)}-${randomBytes(3).toString("hex")}`;
  const folder = path.join(realPath(root), id);
  fs.mkdirSync(folder, { mode: 0o700 });
  const lesson: Lesson = { id, title: cleanTitle, format, folder, created: new Date().toISOString() };
  fs.writeFileSync(path.join(folder, MANIFEST), JSON.stringify(lesson, null, 2) + "\n");
  return lesson;
}

/** A lesson by id. The id is checked before it touches a path, and the folder must be a real directory in the root. */
export function getLesson(id: string): Lesson {
  if (!ID.test(id)) throw new Error(`Unknown lesson "${id}". Create one with create_video_lesson.`);
  const root = realPath(lessonsRoot());
  const folder = path.join(root, id);
  let info: fs.Stats;
  try { info = fs.lstatSync(folder); } catch { throw new Error(`Unknown lesson "${id}". Create one with create_video_lesson.`); }
  if (!info.isDirectory()) throw new Error(`Lesson "${id}" is not a folder Am I Cooked created.`);
  const lesson = JSON.parse(fs.readFileSync(path.join(folder, MANIFEST), "utf8")) as Lesson;
  return { ...lesson, folder };
}

/** Rejects anything that could make the renderer read outside the lesson (or the network). */
export function unsafeContent(file: string, content: string): string | null {
  return path.extname(file).toLowerCase() === ".svg" ? svgProblem(content) : null;
}

/** Every SVG in a lesson, checked again just before rendering in case it changed on disk since it was written. */
export function checkLessonFiles(folder: string) {
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${path.relative(folder, full)} is a link; lessons can only hold regular files.`);
      if (entry.isDirectory()) walk(full);
      else if (path.extname(entry.name).toLowerCase() === ".svg") {
        const problem = svgProblem(fs.readFileSync(full, "utf8"));
        if (problem) throw new Error(`${path.relative(folder, full)}: ${problem}`);
      }
    }
  };
  walk(folder);
}

/** Creates the folders for a lesson file one level at a time, refusing any existing level that is a link or a file. */
function lessonFolder(lesson: Lesson, folders: string[]): string {
  let current = lesson.folder;
  for (const name of folders) {
    current = path.join(current, name);
    let info: fs.Stats | undefined;
    try { info = fs.lstatSync(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!info) fs.mkdirSync(current, { mode: 0o700 });
    else if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("That path leaves the lesson folder.");
  }
  // Belt and braces: the folder must still resolve inside the lesson
  const inside = path.relative(lesson.folder, realPath(current));
  if (inside.split(path.sep)[0] === ".." || path.isAbsolute(inside)) throw new Error("That path leaves the lesson folder.");
  return current;
}

function lessonSize(folder: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        bytes += fs.statSync(full).size;
        files++;
      }
    }
  };
  walk(folder);
  return { bytes, files };
}

/** Writes one text file into a lesson, after checking its path, type, size and content. */
export function writeLessonFile(id: string, relative: string, content: string): { path: string; bytes: number } {
  const lesson = getLesson(id);
  const parts = relative.replaceAll("\\", "/").split("/");
  if (path.isAbsolute(relative) || /^[a-z]:/i.test(relative) || parts.some(part => !/^[A-Za-z0-9._-]{1,100}$/.test(part) || part === "." || part === "..") ||
      parts.length > 4) {
    throw new Error("Use a short relative path inside the lesson, made of letters, numbers, dots, dashes and underscores (up to 4 folders deep).");
  }
  const name = parts.join("/");
  if (reserved(name)) throw new Error(`${name} is managed by Am I Cooked and can't be written.`);
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED[lesson.format].includes(ext)) {
    throw new Error(`A ${lesson.format} lesson accepts ${ALLOWED[lesson.format].join(", ")} files only.`);
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > LIMITS.fileBytes) throw new Error(`${name} is too large (limit ${LIMITS.fileBytes / 1024 / 1024} MB per file).`);
  const problem = unsafeContent(name, content);
  if (problem) throw new Error(problem);

  const target = path.join(lessonFolder(lesson, parts.slice(0, -1)), parts[parts.length - 1]);
  let existing = 0;
  try {
    const info = fs.lstatSync(target);
    if (!info.isFile()) throw new Error(`${name} exists and isn't a regular file.`);
    existing = info.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const size = lessonSize(lesson.folder);
  if (size.bytes - existing + bytes > LIMITS.lessonBytes) throw new Error(`The lesson is full (limit ${LIMITS.lessonBytes / 1024 / 1024} MB).`);
  if (!existing && size.files + 1 > LIMITS.files) throw new Error(`The lesson has too many files (limit ${LIMITS.files}).`);
  fs.writeFileSync(target, content, "utf8");
  return { path: name, bytes };
}
