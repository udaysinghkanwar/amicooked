import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fingerprint } from "./install.js";

/**
 * Resolves links and junctions to a real path. Uses the native resolver first (it also expands Windows short
 * names), but some sandboxes deny the handle it needs (ChatGPT Work on Windows returns EPERM), so on a permission
 * error it falls back to Node's JavaScript resolver, which walks each path part with lstat/readlink and still
 * follows every link. Missing paths and other errors still fail.
 */
export function realPath(target: string, resolvers = { native: fs.realpathSync.native, portable: fs.realpathSync }): string {
  try {
    return resolvers.native(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES") throw error;
    return resolvers.portable(target);
  }
}

/** "project / realpath / EPERM": where it failed, the call, and the code, for support. */
function diagnostic(stage: string, error: unknown): string {
  const e = error as NodeJS.ErrnoException;
  return e.code ? ` [${stage} / ${e.syscall ?? "fs"} / ${e.code}]` : "";
}

export function videoProject(directory = process.cwd()): string {
  const requested = path.resolve(directory);
  try {
    const project = realPath(requested);
    if (!fs.statSync(project).isDirectory()) throw new Error("Expected a directory");
    return project;
  } catch (error) {
    throw new Error(`Cannot resolve the video project folder "${requested}": ${(error as Error).message}. Choose a local folder this session can access.${diagnostic("project", error)}`);
  }
}

export function videoEntry(project: string) {
  const entry = path.join(project, "index.html");
  try {
    realPath(entry);
    if (!fs.statSync(entry).isFile()) throw new Error("Expected an HTML file");
    const fd = fs.openSync(entry, "r");
    fs.closeSync(fd);
  } catch (error) {
    throw new Error(`Cannot resolve or read "${entry}": ${(error as Error).message}. Confirm the project path and give this session read access.${diagnostic("entry", error)}`);
  }
}

function privateDirectory(directory: string) {
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const info = fs.lstatSync(directory);
  const uid = process.getuid?.();
  if (!info.isDirectory() || (uid !== undefined && (info.uid !== uid || (info.mode & 0o022) !== 0))) {
    throw new Error(`Expected an owned directory at "${directory}" without group or public write access`);
  }
}

export function videoScratch(project: string, directory = os.tmpdir()) {
  const requested = path.resolve(directory);
  try {
    const parent = realPath(requested);
    const scratch = path.join(parent, `amicooked-video-${fingerprint([project, process.getuid?.()]).slice(0, 24)}`);
    const relative = path.relative(project, scratch);
    if (!relative || (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..")) {
      throw new Error("Scratch must be outside the video project");
    }
    privateDirectory(scratch);
    const cache = path.join(scratch, "cache");
    const temp = path.join(scratch, "temp");
    privateDirectory(cache);
    privateDirectory(temp);
    // Windows access() does not validate directory-write ACLs. Exercise a real write.
    for (const folder of [cache, temp]) {
      const probe = fs.mkdtempSync(path.join(folder, "write-test-"));
      fs.rmdirSync(probe);
    }
    return { cache, temp };
  } catch (error) {
    throw new Error(`Cannot use video scratch folder "${requested}": ${(error as Error).message}. Pass --scratch with a writable folder outside the project.${diagnostic("scratch", error)}`);
  }
}
