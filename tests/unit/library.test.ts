import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { reloadConfig } from "../../src/config.js";
import { getFile, listEntries } from "../../src/library.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-"));
  process.env.AMICOOKED_HOME = home;
  reloadConfig();
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const response = (body: string, status = 200) => new Response(status === 304 ? null : body, { status, headers: { etag: '"v1"' } });

describe("library", () => {
  it("downloads once, then serves from disk", async () => {
    let fetches = 0;
    const req = {
      url: "https://d2l.example.edu/content/enforced/1-X/notes.txt",
      targetPath: async () => path.join(home, "files", "notes.txt"),
      fetch: async () => (fetches++, response("week 1")),
      canRevalidate: () => true,
    };
    expect((await getFile(req)).status).toBe("downloaded");
    expect((await getFile(req)).status).toBe("cached");
    expect(fetches).toBe(1);
    expect(listEntries()).toEqual([expect.objectContaining({ url: req.url, path: path.join(home, "files", "notes.txt") })]);
  });

  it("keeps a locally edited copy and saves the new version beside it", async () => {
    const target = path.join(home, "files", "slides.txt");
    const base = { url: "https://d2l.example.edu/slides.txt", targetPath: async () => target, canRevalidate: () => true };
    await getFile({ ...base, fetch: async () => response("v1") });
    fs.writeFileSync(target, "v1 with my notes");

    const result = await getFile({ ...base, refresh: true, fetch: async () => response("v2") });
    expect(result.status).toBe("updated-alongside");
    expect(fs.readFileSync(target, "utf8")).toBe("v1 with my notes");
    expect(fs.readFileSync(result.path, "utf8")).toBe("v2");
  });
});
