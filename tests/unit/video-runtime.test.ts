import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { updateCommand } from "../../src/cli/update.js";
import { reloadConfig, writeConfig } from "../../src/config.js";
import { acquireLock } from "../../src/lock.js";
import { download, installComponent } from "../../src/video/install.js";
import { getVideoTools, prepareVideo, videoStatus } from "../../src/video/runtime.js";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-video-"));
  vi.stubEnv("AMICOOKED_HOME", home);
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  reloadConfig();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  reloadConfig();
  fs.rmSync(home, { recursive: true, force: true });
});

it("verifies completed downloads and removes corrupt or interrupted files", async () => {
  const url = "https://example.invalid/video-tool";
  const sha256 = createHash("sha256").update("trusted").digest("hex");
  const file = path.join(home, "download");
  await expect(download({ url, sha256 }, file, { fetcher: async () => new Response("corrupt") })).rejects.toThrow("Checksum");
  const fetcher = async () => new Response(new ReadableStream({
    pull(controller) { controller.error(new Error("interrupted")); },
  }));
  await expect(download({ url, sha256 }, file, { fetcher, retryDelayMs: 0 })).rejects.toThrow("interrupted");
  expect(fs.readdirSync(home)).toEqual([]);
  await download({ url, sha256 }, file, { fetcher: async () => new Response("trusted") });
  expect(fs.readFileSync(file, "utf8")).toBe("trusted");
});

it.each(["resume", "restart"])("can %s a download after a real connection reset", async (mode) => {
  const bytes = Buffer.alloc(128 * 1024, 42);
  const cutoff = bytes.length / 2;
  const ranges: (string | undefined)[] = [];
  const server = createServer((request, response) => {
    ranges.push(request.headers.range);
    if (ranges.length === 1) {
      response.writeHead(200, { "content-length": bytes.length });
      response.write(bytes.subarray(0, cutoff), () => setTimeout(() => response.destroy(), 80));
    } else if (mode === "resume") {
      response.writeHead(206, { "content-range": `bytes ${cutoff}-${bytes.length - 1}/${bytes.length}` });
      response.end(bytes.subarray(cutoff));
    } else {
      response.end(bytes);
    }
  });
  const address = await new Promise<{ port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address() as { port: number }));
  });
  try {
    const url = `http://127.0.0.1:${address.port}/asset`;
    const file = path.join(home, "download");
    await download({ url, sha256: createHash("sha256").update(bytes).digest("hex") }, file, { retryDelayMs: 0 });
    expect(ranges).toEqual([undefined, `bytes=${cutoff}-`]);
    expect(fs.readFileSync(file)).toEqual(bytes);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

it("times out a stalled transfer but allows a longer download that keeps making progress", async () => {
  const url = "https://example.invalid/asset";
  const file = path.join(home, "download");
  const sha256 = createHash("sha256").update("trusted").digest("hex");
  const fetcher = vi.fn(async () => new Response(new ReadableStream({})));
  await expect(download({ url, sha256 }, file, { fetcher, stallMs: 30, retryDelayMs: 0 })).rejects.toThrow("No download progress");
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fs.readdirSync(home)).toEqual([]);

  await download({ url, sha256 }, file, { stallMs: 160, fetcher: async () => new Response(new ReadableStream({
    async start(controller) {
      for (const chunk of ["tr", "us", "te", "d"]) {
        await new Promise(resolve => setTimeout(resolve, 75));
        controller.enqueue(Buffer.from(chunk));
      }
      controller.close();
    },
  })) });
  expect(fs.readFileSync(file, "utf8")).toBe("trusted");
});

it("tries the mirror after transient failures and validates it against the original checksum", async () => {
  const url = "https://upstream.invalid/asset";
  const mirror = "https://mirror.invalid/asset";
  const file = path.join(home, "download");
  const asset = { url, mirrors: [mirror], sha256: createHash("sha256").update("trusted").digest("hex") };
  const fetcher = vi.fn(async input => input === url ? new Response(null, { status: 503 }) : new Response("corrupt"));
  await expect(download(asset, file, { fetcher, retryDelayMs: 0 })).rejects.toThrow("upstream.invalid: HTTP 503; mirror.invalid: Checksum mismatch");
  expect(fs.readdirSync(home)).toEqual([]);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([url, url, url, mirror]);
  await download(asset, file, {
    fetcher: async input => input === url ? new Response(null, { status: 403 }) : new Response("trusted"),
  });
  expect(fs.readFileSync(file, "utf8")).toBe("trusted");
});

it("reuses complete components and retries an incomplete component without publishing staging files", async () => {
  const prepare = vi.fn(async directory => { fs.writeFileSync(path.join(directory, "tool"), "okay"); });
  const first = await installComponent(home, "tool-v1", ["tool"], prepare);
  await installComponent(home, "tool-v1", ["tool"], prepare);
  expect(prepare).toHaveBeenCalledOnce();
  await expect(installComponent(home, "tool-v2", ["tool"], async () => {})).rejects.toThrow("missing");
  expect(fs.readdirSync(home)).toEqual(["tool-v1"]);
  fs.unlinkSync(path.join(first, "tool"));
  await installComponent(home, "tool-v1", ["tool"], prepare);
  expect(prepare).toHaveBeenCalledTimes(2);
});

it("keeps the previously verified tools usable after a failed replacement", async () => {
  if (videoStatus().state === "unsupported") return;
  const root = path.join(home, "video");
  fs.mkdirSync(root);
  const model = path.join(root, "model");
  fs.mkdirSync(path.join(model, "onnx"), { recursive: true });
  for (const file of ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]) {
    fs.writeFileSync(path.join(model, file), "test fixture");
  }
  const bin = path.join(root, "tool");
  fs.writeFileSync(bin, "test fixture");
  const tools = { node: bin, browser: bin, ffmpeg: bin, ffprobe: bin, hyperframes: bin, voice: bin, model };
  const marker = JSON.stringify({ schema: 1, target: videoStatus().target, identity: "0".repeat(64), tools });
  const markerPath = path.join(root, "ready.json");
  fs.writeFileSync(markerPath, marker);
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(prepareVideo(() => {})).rejects.toThrow("HTTP 403");
  expect(videoStatus().state).toBe("previous");
  expect(fs.readFileSync(markerPath, "utf8")).toBe(marker);
  expect(getVideoTools()).toEqual(tools);
});

it("rejects concurrent preparation", async () => {
  if (videoStatus().state === "unsupported") return;
  const release = acquireLock(path.join(home, "video", "prepare.lock"), "video setup");
  try {
    await expect(prepareVideo()).rejects.toThrow("Another video setup is running");
  } finally { release(); }
});

it("prepares video tools during updates by default and honors the skip preference", async () => {
  if (videoStatus().state === "unsupported") return;
  writeConfig({ school: { id: "fixture", name: "Fixture", host: "fixture.invalid", lmsName: "D2L" } });
  const downloads = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
  vi.stubGlobal("fetch", downloads);
  const deps = { fetch: async () => new Response(JSON.stringify({ tag_name: "v1.0.0" })), version: "1.0.0" };
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await updateCommand({ check: true, json: true, withVideo: true }, deps)).toBe(0);
    expect(downloads).not.toHaveBeenCalled();
    expect(await updateCommand({ compatibleOnly: true, json: true }, { ...deps, allowed: () => false })).toBe(0);
    expect(downloads).not.toHaveBeenCalled();
    writeConfig({ prepareVideo: false });
    expect(await updateCommand({ compatibleOnly: true, json: true }, deps)).toBe(0);
    expect(await updateCommand({ json: true }, deps)).toBe(0);
    expect(downloads).not.toHaveBeenCalled();
    writeConfig({ prepareVideo: true });
    expect(await updateCommand({ compatibleOnly: true, json: true }, deps)).toBe(0);
    expect(downloads).toHaveBeenCalledTimes(1);
    expect(await updateCommand({ json: true }, deps)).toBe(0);
    expect(downloads).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("HTTP 403"));
  } finally {
    output.mockRestore();
    errors.mockRestore();
  }
});
