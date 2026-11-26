import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadConfig } from "../../src/config.js";
import { createLesson, getLesson, LIMITS, unsafeContent, writeLessonFile } from "../../src/video/lessons.js";
import { renderLessonCommand, renderStatus, startRender } from "../../src/video/jobs.js";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-lessons-"));
  vi.stubEnv("AMICOOKED_HOME", path.join(home, ".amicooked"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  reloadConfig();
});
afterEach(() => {
  vi.unstubAllEnvs();
  reloadConfig();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("lesson folders", () => {
  it("creates a lesson under the student's files folder and finds it again", () => {
    const lesson = createLesson("3DB3 Transactions, Nov 24!");
    expect(lesson.id).toMatch(/^3db3-transactions-nov-24-[0-9a-f]{6}$/);
    expect(lesson.folder).toBe(path.join(fs.realpathSync(path.join(home, "Downloads", "amicooked", "Lessons")), lesson.id));
    expect(getLesson(lesson.id).title).toBe("3DB3 Transactions, Nov 24!");
  });

  it("rejects ids that could point anywhere else", () => {
    for (const id of ["../x", "a/b", "", "A-Upper", ".hidden"]) expect(() => getLesson(id)).toThrow("Unknown lesson");
  });
});

describe("writing lesson files", () => {
  it("writes allowed text files inside the lesson, including subfolders", () => {
    const { id, folder } = createLesson("t");
    expect(writeLessonFile(id, "narration/slide-1.txt", "Hello")).toEqual({ path: "narration/slide-1.txt", bytes: 5 });
    expect(fs.readFileSync(path.join(folder, "narration", "slide-1.txt"), "utf8")).toBe("Hello");
  });

  it("refuses paths that leave the lesson, absolute paths and odd names", () => {
    const { id } = createLesson("t");
    for (const bad of ["../escape.txt", "/etc/passwd.txt", "C:\\x.txt", "a/../../b.txt", "sp ace.txt", "a/b/c/d/e.txt"]) {
      expect(() => writeLessonFile(id, bad, "x"), bad).toThrow();
    }
  });

  it("refuses file types the renderer doesn't read, and files Am I Cooked manages", () => {
    const { id } = createLesson("t");
    for (const bad of ["index.html", "run.js", "style.css", "slide.png", "lesson.json", "job.json", "lesson.mp4"]) {
      expect(() => writeLessonFile(id, bad, "x"), bad).toThrow();
    }
  });

  it("won't write through a link that leads out of the lesson", () => {
    const { id, folder } = createLesson("t");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-outside-"));
    fs.symlinkSync(outside, path.join(folder, "linked"), "junction");
    expect(() => writeLessonFile(id, "linked/slide.txt", "x")).toThrow("leaves the lesson");
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.writeFileSync(path.join(outside, "target.txt"), "keep");
    fs.symlinkSync(path.join(outside, "target.txt"), path.join(folder, "file.txt"));
    expect(() => writeLessonFile(id, "file.txt", "overwrite")).toThrow("isn't a regular file");
    expect(fs.readFileSync(path.join(outside, "target.txt"), "utf8")).toBe("keep");
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("enforces size limits", () => {
    const { id } = createLesson("t");
    expect(() => writeLessonFile(id, "big.txt", "x".repeat(LIMITS.fileBytes + 1))).toThrow("too large");
  });
});

describe("SVG safety", () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="10" height="10"/><use href="#g"/></svg>';

  it("accepts self-contained slides", () => {
    expect(unsafeContent("s.svg", ok)).toBeNull();
    expect(unsafeContent("s.svg", '<svg><image href="data:image/png;base64,iVBORw0KGgo="/></svg>')).toBeNull();
  });

  it("refuses anything that could pull in another file or the network", () => {
    const bad = [
      '<svg><image href="/Users/me/.ssh/id_rsa"/></svg>',
      '<svg><image xlink:href="../../secret.png"/></svg>',
      "<svg><use href='other.svg#a'/></svg>",
      '<svg><image href="https://example.com/x.png"/></svg>',
      '<svg><image href="file:///etc/passwd"/></svg>',
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
      '<svg><style>@import "x.css";</style></svg>',
      '<svg><rect style="fill:url(other.svg#g)"/></svg>',
    ];
    for (const svg of bad) expect(unsafeContent("s.svg", svg), svg).not.toBeNull();
  });

  it("is enforced when writing", () => {
    const { id } = createLesson("t");
    expect(() => writeLessonFile(id, "s.svg", '<svg><image href="/etc/hosts"/></svg>')).toThrow("SVG files can only link");
  });
});

describe("render jobs", () => {
  it("starts once and returns the same render when called again", () => {
    const { id } = createLesson("t");
    const launch = vi.fn(() => process.pid);
    const first = startRender(id, launch);
    expect(first.state).toBe("running");
    const again = startRender(id, launch);
    expect(again.jobId).toBe(first.jobId);
    expect(launch).toHaveBeenCalledOnce();
    const args = launch.mock.calls[0] as unknown as [string, string[]];
    expect(args[1]).toEqual(expect.arrayContaining(["video", "render-lesson", "--lesson", id, "--job", first.jobId]));
  });

  it("reports a renderer whose process is gone, instead of leaving it running forever", () => {
    const dead = createLesson("u");
    startRender(dead.id, () => 999_999_999);
    const status = renderStatus(dead.id);
    expect(status.state).toBe("failed");
    expect(status.error).toContain("stopped unexpectedly");
  });

  it("reports a renderer that couldn't start, and stops one that runs past the deadline", () => {
    const { id } = createLesson("t");
    const job = startRender(id, () => undefined);
    expect(job.state).toBe("failed");
    expect(job.error).toContain("couldn't start");

    const slow = createLesson("slow");
    const started = Date.now();
    startRender(slow.id, () => process.pid, started);
    const stopped: number[] = [];
    // Still within the limit: left running
    expect(renderStatus(slow.id, started + 60_000, pid => stopped.push(pid)).state).toBe("running");
    // Past it: stopped and reported (our own pid stands in for the renderer, so the stop is captured, not sent)
    const late = renderStatus(slow.id, started + 31 * 60 * 1000, pid => stopped.push(pid));
    expect(late.state).toBe("failed");
    expect(late.error).toContain("longer than 30 minutes");
    expect(stopped).toEqual([process.pid]);
  });

  it("allows one render at a time", () => {
    const a = createLesson("a");
    const b = createLesson("b");
    startRender(a.id, () => process.pid);
    expect(() => startRender(b.id, () => process.pid)).toThrow("still rendering");
  });
});

describe("the render child", () => {
  it("fetches the narrated slide tools when missing, and reports a failure to do so", async () => {
    const { id, folder } = createLesson("t");
    const job = startRender(id, () => process.pid);
    const prepare = vi.fn(async () => { throw new Error("Couldn't download the voice model."); });
    expect(await renderLessonCommand(id, job.jobId, prepare as never)).toBe(1);
    expect(prepare).toHaveBeenCalledWith(expect.any(Function), true);
    const saved = JSON.parse(fs.readFileSync(path.join(folder, "job.json"), "utf8"));
    expect(saved.state).toBe("failed");
    expect(saved.error).toContain("voice model");
  });

  it("ignores a stale or unknown job", async () => {
    const { id } = createLesson("t");
    startRender(id, () => process.pid);
    expect(await renderLessonCommand(id, "not-the-job", vi.fn() as never)).toBe(1);
  });
});
