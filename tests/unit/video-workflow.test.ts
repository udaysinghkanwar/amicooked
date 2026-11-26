import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { getLectureVideoWorkflow } from "../../src/features.js";

it("tells the agent which computer the tools are on, so it can check its own shell first", async () => {
  const result = JSON.parse(await getLectureVideoWorkflow.handler({}));
  expect(result.host).toBe(`${process.platform}-${process.arch}`);
  expect(result.supportedTargets).toEqual(expect.arrayContaining(["darwin-arm64", "linux-x64", "win32-x64"]));
  expect(result.checkFirst).toContain("Before asking the student anything");
});

it("puts the capability check before any questions in the workflow", () => {
  const guide = readFileSync("skill/references/lecture-videos.md", "utf8");
  expect(guide.indexOf("## 1. Check capabilities")).toBeLessThan(guide.indexOf("## 2. Choose the lesson"));
  expect(guide).toContain("Fallback when you can't render");
});
