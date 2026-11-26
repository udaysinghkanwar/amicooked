import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as p from "@clack/prompts";
import * as config from "../../src/config.js";
import { AmbiguousSchoolError, resolveSchool, resolveSchoolMatch } from "../../src/schools.js";
import { chooseSchool } from "../../src/cli/setup.js";

vi.mock("@clack/prompts", async (original) => ({
  ...await original<typeof p>(),
  select: vi.fn(), text: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  log: { warn: vi.fn() },
}));
vi.mock("../../src/schools.js", async (original) => ({
  ...await original<typeof import("../../src/schools.js")>(),
  resolveSchool: vi.fn(), resolveSchoolMatch: vi.fn(),
}));

const school: config.School = { id: "custom", name: "Example University", host: "courses.example.edu", lmsName: "D2L" };
const matches = [
  { name: "Example University", loginUrl: "https://courses.example.edu/" },
  { name: "Example College", loginUrl: "https://college.example.edu/" },
];
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
function setInteractive(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(p.text).mockResolvedValue(p.CANCEL_SYMBOL);
  vi.mocked(p.select).mockResolvedValue(p.CANCEL_SYMBOL);
  vi.spyOn(config, "getConfig").mockReturnValue({ version: 1, filesDir: "/unused" });
  setInteractive(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY);
  else Reflect.deleteProperty(process.stdin, "isTTY");
  if (stdoutTTY) Object.defineProperty(process.stdout, "isTTY", stdoutTTY);
  else Reflect.deleteProperty(process.stdout, "isTTY");
});

describe("school setup", () => {
  it("accepts a school name from the Somewhere else prompt", async () => {
    vi.mocked(p.select).mockResolvedValueOnce("other");
    vi.mocked(p.text).mockResolvedValueOnce("Example University");
    vi.mocked(resolveSchool).mockResolvedValueOnce(school);
    expect(await chooseSchool(undefined)).toEqual(school);
    expect(resolveSchool).toHaveBeenCalledWith("Example University");
  });

  it("asks which school when a name has multiple matches and validates that selection", async () => {
    vi.mocked(resolveSchool).mockRejectedValueOnce(new AmbiguousSchoolError(matches));
    vi.mocked(p.select).mockResolvedValueOnce("1");
    vi.mocked(resolveSchoolMatch).mockResolvedValueOnce(school);
    expect(await chooseSchool("Example")).toEqual(school);
    expect(resolveSchoolMatch).toHaveBeenCalledWith(matches[1]);
  });

  it("stops automated setup with choices and exit code 2 instead of opening a guessed portal", async () => {
    setInteractive(false);
    vi.mocked(resolveSchool).mockRejectedValueOnce(new AmbiguousSchoolError(matches));
    await expect(chooseSchool("Example")).rejects.toMatchObject({ code: 2, message: expect.stringContaining("Example College") });
    expect(p.select).not.toHaveBeenCalled();
    expect(resolveSchoolMatch).not.toHaveBeenCalled();
  });

  it("lets the student paste a URL after a failed name search", async () => {
    vi.mocked(resolveSchool).mockRejectedValueOnce(new Error("Directory unavailable")).mockResolvedValueOnce(school);
    vi.mocked(p.text).mockResolvedValueOnce("https://courses.example.edu/");
    expect(await chooseSchool("Example")).toEqual(school);
    expect(resolveSchool).toHaveBeenLastCalledWith("https://courses.example.edu/");
  });

  it("lets the student retry if their selected directory portal cannot be validated", async () => {
    vi.mocked(resolveSchool).mockRejectedValueOnce(new AmbiguousSchoolError(matches)).mockResolvedValueOnce(school);
    vi.mocked(p.select).mockResolvedValueOnce("0");
    vi.mocked(resolveSchoolMatch).mockRejectedValueOnce(new Error("Incompatible portal"));
    vi.mocked(p.text).mockResolvedValueOnce("https://courses.example.edu/");
    expect(await chooseSchool("Example")).toEqual(school);
    expect(p.log.warn).toHaveBeenCalledWith("Incompatible portal");
  });

  it("honors cancellation at the school-match picker", async () => {
    vi.mocked(resolveSchool).mockRejectedValueOnce(new AmbiguousSchoolError(matches));
    vi.mocked(p.select).mockResolvedValueOnce(p.CANCEL_SYMBOL);
    await expect(chooseSchool("Example")).rejects.toThrow("Setup cancelled");
    expect(resolveSchoolMatch).not.toHaveBeenCalled();
  });

  it("reuses the configured school in automated setup without searching or prompting", async () => {
    setInteractive(false);
    vi.mocked(config.getConfig).mockReturnValue({ version: 1, filesDir: "/unused", school });
    expect(await chooseSchool(undefined)).toEqual(school);
    expect(resolveSchool).not.toHaveBeenCalled();
    expect(p.select).not.toHaveBeenCalled();
  });

  it("requires a school in automated setup when none is configured", async () => {
    setInteractive(false);
    await expect(chooseSchool(undefined)).rejects.toMatchObject({ code: 2 });
    expect(resolveSchool).not.toHaveBeenCalled();
    expect(p.text).not.toHaveBeenCalled();
  });
});
