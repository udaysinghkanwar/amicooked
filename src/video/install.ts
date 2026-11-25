import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type Download } from "./manifest.js";

export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function download(asset: Download, destination: string, fetcher = fetch): Promise<void> {
  const response = await fetcher(asset.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) from ${new URL(asset.url).hostname}.`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const hash = createHash("sha256");
  try {
    const checksum = new Transform({
      transform(bytes, _encoding, callback) {
        hash.update(bytes);
        callback(null, bytes);
      },
    });
    await pipeline(response.body, checksum, fs.createWriteStream(destination, { flags: "wx" }));
    if (hash.digest("hex") !== asset.sha256) throw new Error(`Checksum mismatch for ${path.basename(destination)}.`);
  } catch (error) {
    fs.rmSync(destination, { force: true });
    throw error;
  }
}

export function runTool(command: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string): string {
  try {
    return execFileSync(command, args, {
      cwd, env, encoding: "utf8", timeout: 300_000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const failure = error as { stderr?: string; message?: string };
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
