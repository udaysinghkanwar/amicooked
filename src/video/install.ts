import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { setTimeout as delay } from "node:timers/promises";
import { type Download } from "./manifest.js";

export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

interface DownloadOptions {
  fetcher?: typeof fetch;
  stallMs?: number;
  retryDelayMs?: number;
}

export async function download(asset: Download, destination: string, {
  fetcher = fetch, stallMs = 60_000, retryDelayMs = 1_000,
}: DownloadOptions = {}): Promise<void> {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(destination), "download-"));
  const partial = path.join(staging, "partial");
  const failures: string[] = [];
  try {
    for (const url of [asset.url, ...(asset.mirrors ?? [])]) {
      fs.rmSync(partial, { force: true });
      let failure: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt && retryDelayMs) await delay(retryDelayMs * attempt);
        const offset = fs.statSync(partial, { throwIfNoEntry: false })?.size ?? 0;
        const abort = new AbortController();
        let timer = setTimeout(stall, stallMs);
        function stall() { abort.abort(new Error(`No download progress for ${stallMs / 1_000} seconds.`)); }
        function progress() {
          clearTimeout(timer);
          timer = setTimeout(stall, stallMs);
        }
        try {
          const headers: Record<string, string> = { "Accept-Encoding": "identity" };
          if (offset) headers.Range = `bytes=${offset}-`;
          const response = await fetcher(url, { headers, signal: abort.signal });
          if (!response.ok || !response.body) {
            await response.body?.cancel();
            failure = new Error(`HTTP ${response.status}`);
            if (response.status === 416 && offset) fs.rmSync(partial, { force: true });
            else if (response.status < 500 && ![408, 429].includes(response.status)) break;
            continue;
          }
          const append = response.status === 206;
          if (append && (!offset || !response.headers.get("content-range")?.startsWith(`bytes ${offset}-`))) {
            await response.body.cancel();
            fs.rmSync(partial, { force: true });
            failure = new Error("Server returned the wrong byte range.");
            continue;
          }
          progress();
          const watch = new Transform({
            transform(bytes, _encoding, callback) {
              progress();
              callback(null, bytes);
            },
          });
          // Adapt the fetch stream so a stall also cancels the pending read.
          const body = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
          await pipeline(body, watch, fs.createWriteStream(partial, { flags: append ? "a" : "w" }), { signal: abort.signal });
          clearTimeout(timer);
          const hash = createHash("sha256");
          for await (const bytes of fs.createReadStream(partial)) hash.update(bytes);
          if (hash.digest("hex") !== asset.sha256) {
            failure = new Error("Checksum mismatch.");
            if (!offset) break;
            fs.rmSync(partial, { force: true });
            continue;
          }
          fs.renameSync(partial, destination);
          return;
        } catch (error) {
          failure = abort.signal.reason ?? error;
        } finally {
          clearTimeout(timer);
        }
      }
      const reason = failure instanceof Error ? failure.cause ?? failure.message : failure;
      failures.push(`${new URL(url).hostname}: ${String(reason)}`);
    }
    throw new Error(`Could not download ${path.basename(destination)} (${failures.join("; ")}).`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export function runTool(command: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string, timeout = 300_000): string {
  try {
    return execFileSync(command, args, {
      cwd, env, encoding: "utf8", timeout, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const failure = error as { code?: string; stderr?: string; message?: string };
    if (failure.code === "ETIMEDOUT") throw new Error(`${path.basename(command)} timed out after ${timeout / 60_000} minutes.`);
    const message = failure.stderr?.trim() || failure.message || String(error);
    throw new Error(`${path.basename(command)} failed: ${message.split("\n").slice(-6).join("\n")}`);
  }
}

export async function unpack(asset: Download, directory: string) {
  const name = new URL(asset.url).pathname.split("/").at(-1)!;
  const file = path.join(directory, name);
  await download(asset, file);
  // macOS and modern Windows have BSD tar with ZIP support. Linux uses unzip for ZIP.
  if (name.endsWith(".zip") && process.platform === "linux") runTool("unzip", ["-q", file, "-d", directory]);
  else runTool("tar", ["-xf", file, "-C", directory]);
  fs.unlinkSync(file);
}

/** Prepare an immutable component, with the caller holding the video setup lock. */
export async function installComponent(root: string, id: string, required: string[], prepare: (directory: string) => Promise<void>) {
  const target = path.join(root, id);
  const complete = (directory: string) => required.every(file => fs.existsSync(path.join(directory, file)));
  if (complete(target)) return target;
  fs.rmSync(target, { recursive: true, force: true });
  const temporary = fs.mkdtempSync(path.join(root, "pending-"));
  try {
    await prepare(temporary);
    if (!complete(temporary)) throw new Error("The video component is missing required files.");
    fs.renameSync(temporary, target);
    return target;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
