import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { reloadConfig } from "../../src/config.js";
import { getFile } from "../../src/library.js";
import { readFileTool, sanitizeName } from "../../src/tools/files.js";

let home: string;

async function addToLibrary(name: string, body: string) {
  const target = path.join(home, "files", name);
  await getFile({ url: `https://d2l.example.edu/${name}`, targetPath: async () => target, fetch: async () => new Response(body), canRevalidate: () => false });
  return target;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-"));
  process.env.AMICOOKED_HOME = home;
  reloadConfig();
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("read_file", () => {
  it("finds a downloaded file by part of its name", async () => {
    await addToLibrary("Week 7 notes.txt", "pipelining");
    const result = JSON.parse(await readFileTool.handler({ file: "week 7" }));
    expect(result.content).toBe("pipelining");
  });

  it("accepts the path alias used by native clients without expanding library access", async () => {
    const file = await addToLibrary("lecture.txt", "read through either argument");
    const args = z.object(readFileTool.schema).parse({ path: file });
    expect(JSON.parse(await readFileTool.handler(args)).content).toBe("read through either argument");
    await expect(readFileTool.handler({ path: path.join(home, "outside.txt") })).rejects.toThrow(/No downloaded file/);
    await expect(readFileTool.handler({})).rejects.toThrow(/Provide file/);
    await expect(readFileTool.handler({ file, path: "different" })).rejects.toThrow(/disagree/);
  });

  it("refuses files that aren't in the library", async () => {
    const outside = path.join(home, "secret.txt");
    fs.writeFileSync(outside, "nope");
    await expect(readFileTool.handler({ file: outside })).rejects.toThrow(/No downloaded file/);
  });

  it("lists candidates when a name is ambiguous", async () => {
    await addToLibrary("lab1.txt", "a");
    await addToLibrary("lab2.txt", "b");
    await expect(readFileTool.handler({ file: "lab" })).rejects.toThrow(/matches several files/);
  });
});

describe("sanitizeName", () => {
  it("makes names safe for any file system", () => {
    expect(sanitizeName('A/B: "C"?')).toBe("A-B- -C--");
    expect(sanitizeName("  ..  ")).toBe("untitled");
  });
});
