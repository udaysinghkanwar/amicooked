import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { realPath, videoProject } from "../../src/video/workspace.js";

const fail = (code: string) => () => { throw Object.assign(new Error(`${code}: operation not permitted, realpath`), { code, syscall: "realpath" }); };

it("falls back to the portable resolver when a sandbox denies the native one", () => {
  expect(realPath("C:\\Users\\me\\project", { native: fail("EPERM"), portable: () => "C:\\Users\\me\\project" })).toBe("C:\\Users\\me\\project");
  expect(realPath("/p", { native: fail("EACCES"), portable: () => "/real/p" })).toBe("/real/p");
});

it("still fails on missing paths and other errors", () => {
  expect(() => realPath("/missing", { native: fail("ENOENT"), portable: () => "/never" })).toThrow("ENOENT");
});

it("follows links with the portable resolver, as the native one does", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-ws-")));
  const real = path.join(dir, "real project");
  fs.mkdirSync(real);
  const link = path.join(dir, "link");
  fs.symlinkSync(real, link, "junction");
  expect(realPath(link, { native: fail("EPERM"), portable: fs.realpathSync })).toBe(real);
  // The native resolver also expands Windows short names (like RUNNER~1), so compare with its own answer
  expect(videoProject(link)).toBe(fs.realpathSync.native(real));
  fs.rmSync(dir, { recursive: true, force: true });
});

it("names the stage, call and code when a folder can't be used", () => {
  expect(() => videoProject(path.join(os.tmpdir(), "amicooked-does-not-exist"))).toThrow("[project / realpath / ENOENT]");
});
