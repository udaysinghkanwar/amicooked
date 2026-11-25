import { createHash } from "node:crypto";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { updateCommand } from "../../src/cli/update.js";
import { reloadConfig } from "../../src/config.js";
import { acquireLock } from "../../src/lock.js";
import { download, installComponent } from "../../src/video/install.js";
import { getVideoTools, prepareVideo, videoStatus } from "../../src/video/runtime.js";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-video-"));
  vi.stubEnv("AMICOOKED_HOME", home);
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
  await expect(download({ url, sha256 }, file, async () => new Response("corrupt"))).rejects.toThrow("Checksum");
  expect(fs.existsSync(file)).toBe(false);
  const body = new ReadableStream({ pull(controller) { controller.error(new Error("interrupted")); } });
  await expect(download({ url, sha256 }, file, async () => new Response(body))).rejects.toThrow("interrupted");
  expect(fs.existsSync(file)).toBe(false);
  await download({ url, sha256 }, file, async () => new Response("trusted"));
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
  const fetcher = vi.fn().mockRejectedValue(new Error("blocked DNS"));
  vi.stubGlobal("fetch", fetcher);
  await expect(prepareVideo(() => {})).rejects.toThrow("blocked DNS");
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

it("prepares video tools only for a manual update with consent", async () => {
  if (videoStatus().state === "unsupported") return;
  const downloads = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", downloads);
  const release = async () => new Response(JSON.stringify({ tag_name: "v1.0.0" }));
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await updateCommand({ check: true, json: true, withVideo: true }, { fetch: release, version: "1.0.0" })).toBe(0);
    expect(downloads).not.toHaveBeenCalled();
    expect(await updateCommand({ compatibleOnly: true, json: true, withVideo: true }, { fetch: release, version: "1.0.0" })).toBe(0);
    expect(await updateCommand({ json: true }, { fetch: release, version: "1.0.0" })).toBe(0);
    expect(downloads).not.toHaveBeenCalled();
    expect(await updateCommand({ json: true, withVideo: true }, { fetch: release, version: "1.0.0" })).toBe(0);
    expect(downloads).toHaveBeenCalledOnce();
  } finally {
    output.mockRestore();
    errors.mockRestore();
  }
});
