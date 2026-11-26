import { z } from "zod";
import { createLesson, LIMITS, writeLessonFile } from "../video/lessons.js";
import { renderStatus, startRender } from "../video/jobs.js";
import { json, type Tool } from "./types.js";

// Lecture videos for AI apps with no shell on the student's computer (#21). The AI writes a declarative lesson
// (slides.json, SVG slides, narration text) through these tools; Am I Cooked renders it locally with its own
// narration and video tools. No command, HTML or script from the AI ever runs.

const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export const createVideoLesson: Tool = {
  name: "create_video_lesson",
  description:
    "Create a lecture-video lesson folder on the student's computer for an AI app that can't run local commands. Then write slides.json, SVG slides and narration .txt files with write_video_lesson_file, and start_video_render.",
  schema: { title: z.string().min(1).max(200).describe("Short lesson title, e.g. \"3DB3 Transactions, Nov 24\"") },
  annotations: writes,
  handler: async ({ title }) => {
    const lesson = createLesson(title);
    return json({
      lessonId: lesson.id,
      folder: lesson.folder,
      format: lesson.format,
      write: [
        "slides.json: an ordered array of { image, narration, overlays? } with paths relative to the lesson",
        "image: a self-contained .svg slide (1280x720, large text). Style with attributes like fill and stroke, not style rules; link only to its own #ids or embedded data:image",
        "narration: a UTF-8 .txt file with what the voice says for that slide",
        "overlays (optional): [{ image: \"point.svg\", keyframes: [{ at: seconds, x, y }, ...] }] to move a marker during the narration",
      ],
      limits: { fileMB: LIMITS.fileBytes / 1024 / 1024, lessonMB: LIMITS.lessonBytes / 1024 / 1024, files: LIMITS.files },
    });
  },
};

export const writeVideoLessonFile: Tool = {
  name: "write_video_lesson_file",
  description:
    "Write one text file (slides.json, an .svg slide or a narration .txt) into a lesson made with create_video_lesson. Paths are relative to the lesson; files outside it, scripts and external links are refused.",
  schema: {
    lessonId: z.string().describe("From create_video_lesson"),
    path: z.string().describe("Relative path, e.g. \"slide-1.svg\" or \"narration/slide-1.txt\""),
    content: z.string().describe("The full UTF-8 file content"),
  },
  annotations: { ...writes, idempotentHint: true },
  handler: async ({ lessonId, path, content }) => json(writeLessonFile(lessonId, path, content)),
};

export const startVideoRender: Tool = {
  name: "start_video_render",
  description:
    "Render a lesson made with create_video_lesson into lesson.mp4 on the student's computer, using Am I Cooked's local narration and video tools. Returns immediately; check progress with get_video_render. Calling it again returns the same render.",
  schema: { lessonId: z.string() },
  annotations: { ...writes, idempotentHint: true },
  handler: async ({ lessonId }) => json(startRender(lessonId)),
};

export const getVideoRender: Tool = {
  name: "get_video_render",
  description:
    "Check a render started with start_video_render. When done, returns the MP4's path on the student's computer, for them to open there. A failure includes the reason and the end of the render log.",
  schema: { lessonId: z.string() },
  handler: async ({ lessonId }) => json(renderStatus(lessonId)),
};

export const LESSON_TOOLS = [createVideoLesson, writeVideoLessonFile, startVideoRender, getVideoRender];
