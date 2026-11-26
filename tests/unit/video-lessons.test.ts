import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadConfig } from "../../src/config.js";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { checkLessonFiles, createLesson, getLesson, LIMITS, unsafeContent, writeLessonFile } from "../../src/video/lessons.js";
import { animationDeadline, RENDER_LIMIT_MS, renderLessonCommand, renderLessonWork, renderStatus, startRender } from "../../src/video/jobs.js";

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
    expect(fs.realpathSync.native(lesson.folder)).toBe(path.join(fs.realpathSync.native(path.join(home, "Downloads", "amicooked", "Lessons")), lesson.id));
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
    for (const bad of ["index.html", "run.js", "style.css", "slide.png", "lesson.json", "job.json", "lesson.mp4", "Lesson.JSON", "JOB.json"]) {
      expect(() => writeLessonFile(id, bad, "x"), bad).toThrow();
    }
  });

  it("won't write through a link that leads out of the lesson", () => {
    const { id, folder } = createLesson("t");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-outside-"));
    fs.symlinkSync(outside, path.join(folder, "linked"), "junction");
    expect(() => writeLessonFile(id, "linked/slide.txt", "x")).toThrow("leaves the lesson");
    // Nothing is created through the link, not even the folders on the way
    expect(() => writeLessonFile(id, "linked/deeper/slide.txt", "x")).toThrow("leaves the lesson");
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
      // Hidden behind character references or CSS escapes
      '<svg><rect style="fill:&#117;rl(/etc/x)"/></svg>',
      '<svg><image href="&#47;etc/hosts"/></svg>',
      '<svg><rect style="fill:\\75rl(/etc/x)"/></svg>',
      '<svg><style>rect { fill: u\\72l(x.svg) }</style></svg>',
      // Elements that load or run other things
      '<svg><script>alert(1)</script></svg>',
      '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"/></foreignObject></svg>',
      '<svg><filter id="f"><feImage href="/etc/x"/></filter></svg>',
      '<svg onload="x()"/>',
      '<?xml-stylesheet href="x.css"?><svg/>',
      // A reference to an id that isn't there, and something that isn't SVG at all
      '<svg><use href="#missing"/></svg>',
      '<svg><g></svg>',
      '<html/>',
    ];
    for (const svg of bad) expect(unsafeContent("s.svg", svg), svg).not.toBeNull();
  });

  it("limits how much structure a slide can hold", () => {
    const deep = "<g>".repeat(60) + "</g>".repeat(60);
    expect(unsafeContent("s.svg", `<svg>${deep}</svg>`)).toContain("nest");
    expect(unsafeContent("s.svg", `<svg>${"<rect/>".repeat(6000)}</svg>`)).toContain("elements");
  });

  it("stores only the rebuilt markup", () => {
    const { id, folder } = createLesson("t");
    writeLessonFile(id, "s.svg", '<?xml version="1.0"?><!-- note --><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><text x="1" fill="#fff">A &amp; B &lt; C</text><use xlink:href="#t"/><g id="t"/></svg>');
    expect(fs.readFileSync(path.join(folder, "s.svg"), "utf8")).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><text x="1" fill="#fff">A &amp; B &lt; C</text><use href="#t"/><g id="t"/></svg>\n');
  });

  it("refuses styles, base changes and other namespaces", () => {
    for (const svg of [
      '<svg><style>rect { fill: red }</style></svg>',
      '<svg><rect style="fill:red"/></svg>',
      '<svg><rect class="a"/></svg>',
      '<svg xml:base="file:///etc/"><image href="#x"/></svg>',
      '<svg xmlns:h="http://www.w3.org/1999/xhtml"><h:div/></svg>',
      '<svg xmlns:e="http://example.com/e"><rect e:thing="1"/></svg>',
      '<svg><metadata><rdf/></metadata></svg>',
    ]) expect(unsafeContent("s.svg", svg), svg).not.toBeNull();
  });

  it("is enforced when writing", () => {
    const { id } = createLesson("t");
    expect(() => writeLessonFile(id, "s.svg", '<svg><image href="/etc/hosts"/></svg>')).toThrow("SVG files can only link");
  });
});

describe("render jobs", () => {
  it("starts once and returns the same render when called again", () => {
    const { id } = createLesson("t");
    const launch = vi.fn(() => 4242);
    const first = startRender(id, launch);
    expect(first.state).toBe("running");
    const again = startRender(id, launch);
    expect(again.jobId).toBe(first.jobId);
    expect(launch).toHaveBeenCalledOnce();
    const args = launch.mock.calls[0] as unknown as [string, string[]];
    expect(args[1]).toEqual(expect.arrayContaining(["video", "render-lesson", "--lesson", id, "--job", first.jobId]));
  });

  it("reports a supervisor that stopped reporting, without touching any process", () => {
    const { id, folder } = createLesson("u");
    const started = Date.now();
    startRender(id, () => 4242, started);
    expect(renderStatus(id, started + 30_000).state).toBe("running");
    const status = renderStatus(id, started + 2 * 60_000);
    expect(status.state).toBe("failed");
    expect(status.error).toContain("stopped unexpectedly");
    // Status only reads
    expect(JSON.parse(fs.readFileSync(path.join(folder, "job.json"), "utf8")).state).toBe("running");
    // And a new start replaces the dead job
    const restarted = startRender(id, () => 4243, started + 2 * 60_000);
    expect(restarted.state).toBe("running");
    expect(restarted.jobId).not.toBe(status.jobId);
  });

  it("reports a renderer that couldn't start", () => {
    const { id } = createLesson("t");
    const job = startRender(id, () => undefined);
    expect(job.state).toBe("failed");
    expect(job.error).toContain("couldn't start");
  });

  it("allows one render at a time, across apps", () => {
    const a = createLesson("a");
    const b = createLesson("b");
    startRender(a.id, () => 4242);
    expect(() => startRender(b.id, () => 4242)).toThrow("still rendering");
  });

  it("waits for another app's start, and clears a lock left by one that died", () => {
    const { id } = createLesson("t");
    const lock = path.join(home, "Downloads", "amicooked", "Lessons", ".render.lock");
    fs.writeFileSync(lock, "");
    expect(() => startRender(id, () => 4242)).toThrow("Another render is starting");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    expect(startRender(id, () => 4242).state).toBe("running");
    expect(fs.existsSync(lock)).toBe(false);
  });
});

/** A stand-in renderer child that prints a result or exits on cue. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { pid: number; exitCode: number | null; signalCode: null; stdout: PassThrough };
  Object.assign(child, { pid: 4242, exitCode: null, signalCode: null, stdout: new PassThrough() });
  const exit = (code: number, output?: object) => {
    if (output) child.stdout.write(JSON.stringify(output) + "\n");
    child.stdout.end();
    child.exitCode = code;
    setImmediate(() => child.emit("close", code));
  };
  return { child, exit };
}

describe("the render supervisor", () => {
  it("records the renderer's result", async () => {
    const { id, folder } = createLesson("t");
    const job = startRender(id, () => 4242);
    const { child, exit } = fakeChild();
    const done = renderLessonCommand(id, job.jobId, { work: () => (setImmediate(() => exit(0, { output: "lesson.mp4", slides: 2 })), child as never) });
    expect(await done).toBe(0);
    const saved = JSON.parse(fs.readFileSync(path.join(folder, "job.json"), "utf8"));
    expect(saved).toMatchObject({ state: "done", output: "lesson.mp4", slides: 2 });
    expect(renderStatus(id).state).toBe("done");
  });

  it("stops its own renderer at the deadline", async () => {
    const { id } = createLesson("slow");
    const job = startRender(id, () => 4242, Date.now() - RENDER_LIMIT_MS + 100);
    const { child } = fakeChild();
    const stopped: number[] = [];
    expect(await renderLessonCommand(id, job.jobId, { work: () => child as never, stop: pid => stopped.push(pid) })).toBe(1);
    expect(stopped).toEqual([4242]);
    expect(renderStatus(id).error).toContain("longer than 30 minutes");
  });

  it("reports a renderer that fails", async () => {
    const { id } = createLesson("t");
    const job = startRender(id, () => 4242);
    const { child, exit } = fakeChild();
    expect(await renderLessonCommand(id, job.jobId, { work: () => (setImmediate(() => exit(3)), child as never) })).toBe(1);
    expect(renderStatus(id).error).toContain("exit code 3");
  });

  it("ignores a stale or unknown job", async () => {
    const { id } = createLesson("t");
    startRender(id, () => 4242);
    expect(await renderLessonCommand(id, "not-the-job", { work: vi.fn() })).toBe(1);
  });
});

describe("the renderer", () => {
  const ready = async () => ({ state: "ready" }) as never;

  it("checks every SVG again before rendering", async () => {
    const { id, folder } = createLesson("t");
    fs.writeFileSync(path.join(folder, "slide.svg"), '<svg><image href="/etc/hosts"/></svg>');
    await expect(renderLessonWork(id, ready)).rejects.toThrow("slide.svg");
    expect(() => checkLessonFiles(folder)).toThrow("SVG files can only link");
  });

  it("fetches the narrated slide tools when missing, before touching the lesson", async () => {
    const { id } = createLesson("t");
    const prepare = vi.fn(async () => { throw new Error("Couldn't download the voice model."); });
    await expect(renderLessonWork(id, prepare as never)).rejects.toThrow("voice model");
    expect(prepare).toHaveBeenCalledWith(expect.any(Function), true);
  });
});

describe("the HyperFrames time budget", () => {
  it("leaves the slide fallback time to narrate every scene before the job deadline", () => {
    const deadline = Date.parse("2026-01-01T00:30:00Z");
    expect(deadline - animationDeadline(deadline, 3)).toBe(2 * 60_000 + 3 * 45_000);
    // A long lesson still gets a HyperFrames attempt within the 30-minute limit
    expect(deadline - animationDeadline(deadline, 100)).toBe(15 * 60_000);
  });
});
