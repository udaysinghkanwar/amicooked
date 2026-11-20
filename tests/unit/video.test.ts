import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseLesson,
  petriMarkings,
  type Petri,
} from "../../src/video/schema.js";
import { VIDEO_EXAMPLES } from "../../src/video/examples.js";
import { drawVisual } from "../../src/video/visuals.js";
import { run } from "../../src/video/process.js";
import { serveVideo } from "../../src/video/serve.js";
import { assertCheckPassed } from "../../src/video/command.js";

const fixture = (name = "break-even") =>
  structuredClone(VIDEO_EXAMPLES[name]) as any;
const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })),
  );
});

describe("portable lesson specifications", () => {
  it.each(Object.keys(VIDEO_EXAMPLES))(
    "validates %s without executing lesson code",
    (name) => {
      const lesson = parseLesson(fixture(name));
      expect(lesson.scenes.map((s) => s.kind)).toEqual(
        expect.arrayContaining([
          "concept",
          "example",
          "mistake",
          "practice",
          "recap",
        ]),
      );
      for (const scene of lesson.scenes) {
        const drawing = drawVisual(
          scene.visual,
          scene.id,
          scene.cues.map((c, i) => ({ ...c, start: i * 8, end: i * 8 + 7 })),
        );
        expect(drawing.html).toBeTruthy();
        expect(drawing.js).not.toContain("undefined");
      }
    },
  );
  it("rejects missing sources, unknown cues, duplicate IDs and executable extras", () => {
    let s = fixture();
    s.scenes[0].sources = ["missing"];
    expect(() => parseLesson(s)).toThrow("Unknown source");
    s = fixture();
    s.scenes[0].visual.steps[0].cue = "missing";
    expect(() => parseLesson(s)).toThrow("Unknown cue");
    s = fixture();
    s.scenes[1].id = s.scenes[0].id;
    expect(() => parseLesson(s)).toThrow("Duplicate");
    s = fixture();
    s.script = "process.exit()";
    expect(() => parseLesson(s)).toThrow();
  });
  it("rejects invalid code highlights, trace endpoints and chronology", () => {
    const s = fixture("breadth-first");
    const code = s.scenes.find((c: any) => c.visual.type === "code");
    code.visual.steps[0].line = 999;
    expect(() => parseLesson(s)).toThrow("last line");
    code.visual.steps[0].line = 1;
    const graph = s.scenes.find((c: any) => c.visual.type === "graph");
    graph.visual.edges[0].to = "missing";
    expect(() => parseLesson(s)).toThrow("endpoint");
    const b = fixture();
    b.scenes[0].visual.steps.reverse();
    expect(() => parseLesson(b)).toThrow("chronological");
  });
  it("keeps user text inert in HTML, attributes and generated scripts", () => {
    const s = fixture();
    s.scenes[0].visual.steps[0].title = '</script><img onerror="bad()">';
    const lesson = parseLesson(s),
      scene = lesson.scenes[0];
    const drawing = drawVisual(
      scene.visual,
      scene.id,
      scene.cues.map((c, i) => ({ ...c, start: i, end: i + 1 })),
    );
    expect(drawing.html).not.toContain("<img");
    expect(drawing.html).toContain("&lt;/script&gt;");
    expect(drawing.js).not.toContain("bad()");
  });
  it("computes token conservation and rejects disabled transitions", () => {
    const net = parseLesson(fixture("petri-net")).scenes.find(
      (s) => s.kind === "example",
    )!.visual as Petri;
    const markings = petriMarkings(net);
    expect(markings).toEqual([
      { idle: 1, busy: 0, done: 0 },
      { idle: 0, busy: 1, done: 0 },
      { idle: 1, busy: 0, done: 1 },
      { idle: 0, busy: 1, done: 1 },
    ]);
    expect(markings.every((m) => m.idle + m.busy === 1)).toBe(true);
    net.steps[0].fire = "finish";
    expect(() => petriMarkings(net)).toThrow("not enabled");
  });
  it("fails closed when a checker exits successfully but reports ok:false", () => {
    expect(() => assertCheckPassed({ ok: false })).toThrow("checks failed");
    expect(() => assertCheckPassed({})).toThrow();
    expect(() => assertCheckPassed({ ok: true })).not.toThrow();
  });
});

describe("cross-platform process and player transport", () => {
  it("passes spaces and shell metacharacters as literal arguments", async () => {
    const value = 'a folder/$(echo unsafe); `echo no` & "quote"';
    expect(
      (
        await run(process.execPath, [
          "-e",
          "process.stdout.write(process.argv[1])",
          value,
        ])
      ).trim(),
    ).toBe(value);
    await expect(
      run(process.execPath, [
        "-e",
        "process.stderr.write('failed');process.exit(3)",
      ]),
    ).rejects.toThrow("failed");
  });
  it("serves real byte ranges for seeking and blocks paths outside the output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "amicooked-video-"));
    homes.push(root);
    const dir = path.join(root, "lesson");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "player.html"), "Study player");
    await fs.writeFile(path.join(dir, "lesson.mp4"), "0123456789");
    await fs.writeFile(path.join(root, "outside.txt"), "private");
    const server = await serveVideo(dir, 0),
      address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;
    try {
      expect(await (await fetch(url)).text()).toBe("Study player");
      const chunk = await fetch(url + "/lesson.mp4", {
        headers: { Range: "bytes=6-8" },
      });
      expect(chunk.status).toBe(206);
      expect(chunk.headers.get("content-range")).toBe("bytes 6-8/10");
      expect(await chunk.text()).toBe("678");
      expect(
        await (
          await fetch(url + "/lesson.mp4", { headers: { Range: "bytes=-3" } })
        ).text(),
      ).toBe("789");
      expect(
        (await fetch(url + "/lesson.mp4", { headers: { Range: "bytes=20-" } }))
          .status,
      ).toBe(416);
      expect((await fetch(url + "/%2e%2e%2foutside.txt")).status).not.toBe(200);
      const head = await fetch(url + "/lesson.mp4", { method: "HEAD" });
      expect(head.headers.get("content-length")).toBe("10");
      expect(await head.text()).toBe("");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
