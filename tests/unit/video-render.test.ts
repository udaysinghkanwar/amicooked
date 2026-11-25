import { it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
vi.mock("../../src/video/process.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/video/process.js")>()),
  hyperframes: vi.fn(async () =>
    JSON.stringify({ ok: false, runtime: { findings: ["invalid scene"] } }),
  ),
}));
import { hyperframes } from "../../src/video/process.js";
import { renderVideo } from "../../src/video/command.js";
it.each([{ ok: false }, {}])("does not start export when the checker exits zero without success: %j", async (report) => {
  vi.mocked(hyperframes).mockResolvedValueOnce(JSON.stringify(report));
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "amicooked-video-failed-check-"),
  );
  try {
    await expect(renderVideo(root)).rejects.toThrow("checks failed");
    expect(vi.mocked(hyperframes).mock.calls.map((c) => c[0][0])).toEqual([
      "check",
    ]);
    expect(
      JSON.parse(await fs.readFile(path.join(root, "check.json"), "utf8")).ok,
    ).toBe(report.ok);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
