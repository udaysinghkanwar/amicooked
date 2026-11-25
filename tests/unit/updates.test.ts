import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
import { compareVersions, binaryAsset, installRelease, replaceBinary, updateCommand } from "../../src/cli/update.js";
import { installSkillBundle, skillBundleIs } from "../../src/clients/skillFiles.js";
import { featureInfo } from "../../src/features.js";
import { refreshSkills } from "../../src/skills.js";
import { reloadConfig, writeConfig } from "../../src/config.js";
import { SKILL_FILES } from "../../src/skill.js";
import { VERSION } from "../../src/version.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-update-"));
  vi.stubEnv("AMICOOKED_HOME", path.join(dir, ".amicooked"));
  // Even tests of the unchanged-version path must not touch the developer's real skills.
  vi.stubEnv("HOME", dir);
  vi.stubEnv("USERPROFILE", dir);
  reloadConfig();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  reloadConfig();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("bundled skill installation", () => {
  it("upgrades a single-file installation, preserves changed originals and unrelated files, and repairs missing references", () => {
    const dest = path.join(dir, "skills/amicooked");
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "SKILL.md"), "my old customized skill");
    fs.writeFileSync(path.join(dest, "personal.md"), "keep me");
    expect(installSkillBundle(dest)).toBe("updated");
    expect(skillBundleIs(dest)).toBe(true);
    const backup = fs.readdirSync(path.join(dest, ".backups"))[0];
    expect(fs.readFileSync(path.join(dest, ".backups", backup, "SKILL.md"), "utf8")).toBe("my old customized skill");
    expect(fs.readFileSync(path.join(dest, "personal.md"), "utf8")).toBe("keep me");
    expect(installSkillBundle(dest)).toBe("unchanged");
    fs.rmSync(path.join(dest, "references/updates.md"));
    expect(skillBundleIs(dest)).toBe(false);
    expect(installSkillBundle(dest)).toBe("updated");
    expect(skillBundleIs(dest)).toBe(true);
  });

  it("refreshes both AI clients and explicit destinations and leaves account configuration alone", () => {
    const destinations = [path.join(dir, ".agents/skills/amicooked"), path.join(dir, ".claude/skills/amicooked"), path.join(dir, "other/amicooked")];
    for (const dest of destinations.slice(0, 2)) installSkillBundle(dest, { "SKILL.md": "old skill" });
    const config = writeConfig({ skillDirs: [destinations[2]], school: { id: "mcmaster", name: "McMaster", lmsName: "Avenue", host: "example.edu" } });
    const configFile = path.join(dir, ".amicooked/config.json");
    const before = fs.readFileSync(configFile, "utf8");
    fs.writeFileSync(path.join(dir, ".amicooked/token.json"), "private session");
    refreshSkills(dir);
    for (const dest of destinations) {
      expect(skillBundleIs(dest)).toBe(true);
    }
    expect(fs.readFileSync(configFile, "utf8")).toBe(before);
    expect(fs.readFileSync(path.join(dir, ".amicooked/token.json"), "utf8")).toBe("private session");
    expect(config.school?.host).toBe("example.edu");
    expect((featureInfo("updates") as any).instructions).toBe(SKILL_FILES["references/updates.md"]);
    expect(() => featureInfo("notion")).toThrow("Unknown feature");
  });
});

describe("release updates", () => {
  const base = "https://github.com/udaysinghkanwar/amicooked/releases/download/v0.1.5/";
  const bytes = Buffer.from("new executable");
  const releaseFor = (platform: NodeJS.Platform = "darwin", arch = "arm64") => ({
    tag_name: "v0.1.5", body: "New lecture videos", assets: [binaryAsset(platform, arch), "SHA256SUMS"].map(name => ({ name, browser_download_url: base + name })),
  });
  const fetchFor = (asset: string, corrupt = false) => vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith("SHA256SUMS")) return new Response(`${createHash("sha256").update(bytes).digest("hex")}  ${asset}\n`);
    return new Response(corrupt ? "corrupt" : bytes);
  }) as unknown as typeof fetch;

  it.each([
    ["darwin", "arm64", "amicooked-darwin-arm64", true], ["darwin", "x64", "amicooked-darwin-x64", false],
    ["linux", "x64", "amicooked-linux-x64", false], ["win32", "x64", "amicooked-windows-x64.exe", true],
  ])("selects and installs a verified %s/%s binary, retaining the old one", async (platform, arch, asset, withVideo) => {
    const target = path.join(dir, platform === "win32" ? "amicooked.exe" : "amicooked");
    fs.writeFileSync(target, "old executable");
    const calls: string[][] = [];
    await installRelease(releaseFor(platform as NodeJS.Platform, arch), {
      runtime: { execPath: target, argv: [target], platform: platform as NodeJS.Platform, isCompiled: true }, arch, fetch: fetchFor(asset), withVideo,
      run: (command, args) => {
        calls.push([command, ...args]);
        expect(fs.readFileSync(command, "utf8")).toBe(bytes.toString());
        return args[0] === "--version" ? "0.1.5" : "";
      },
    });
    expect(fs.readFileSync(target, "utf8")).toBe(bytes.toString());
    expect(fs.readFileSync(`${target}.previous`, "utf8")).toBe("old executable");
    expect(calls[1]).toEqual(withVideo ? [target, "refresh-skills", "--with-video-deps"] : [target, "refresh-skills"]);
  });

  it("rejects corrupt downloads before touching the installed executable", async () => {
    const target = path.join(dir, "amicooked");
    fs.writeFileSync(target, "old");
    await expect(installRelease(releaseFor(), { runtime: { execPath: target, argv: [], platform: "darwin", isCompiled: true }, arch: "arm64", fetch: fetchFor("amicooked-darwin-arm64", true), run: vi.fn() })).rejects.toThrow("Checksum mismatch");
    expect(fs.readFileSync(target, "utf8")).toBe("old");
  });

  it("restores the previous executable when replacement fails", () => {
    const target = path.join(dir, "amicooked");
    fs.writeFileSync(target, "old");
    expect(() => replaceBinary(path.join(dir, "missing"), target)).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("old");
  });

  it.each(["global", "local", "npx"])("updates a %s npm installation using arguments rather than a shell command", async kind => {
    const refresh = ["refresh-skills", "--with-video-deps"];
    const parent = kind === "npx" ? path.join(dir, "_npx/cache/node_modules") : path.join(dir, "prefix/node_modules");
    const script = path.join(parent, "amicooked/dist/cli.js");
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, "old CLI");
    const globalRoot = kind === "global" ? parent : path.join(dir, "global/node_modules");
    fs.mkdirSync(globalRoot, { recursive: true });
    const calls: { command: string; args: string[] }[] = [];
    await installRelease(releaseFor(), {
      runtime: { execPath: process.execPath, argv: [process.execPath, script], platform: process.platform, isCompiled: false },
      arch: process.arch, fetch: vi.fn(), withVideo: true, run: (command, args) => {
        calls.push({ command, args });
        if (args.includes("root")) return globalRoot;
        if (args.includes("prefix")) return path.dirname(globalRoot);
        return "";
      },
    });
    if (kind === "npx") {
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual(expect.arrayContaining(["exec", "--yes", "--package=amicooked@0.1.5", "--", "amicooked", ...refresh]));
    } else {
      const install = calls.find(c => c.args.includes("install"))!;
      expect(install.args).toContain("amicooked@0.1.5");
      expect(install.args.includes("--global")).toBe(kind === "global");
      expect(calls.at(-1)).toEqual({ command: process.execPath, args: [fs.realpathSync(script), ...refresh] });
    }
  });

  it("leaves developer checkouts alone and explains how to update them", async () => {
    const script = path.join(dir, "checkout/dist/cli.js");
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, "source checkout");
    const run = vi.fn();
    await expect(installRelease(releaseFor(), { runtime: { execPath: process.execPath, argv: [process.execPath, script], platform: process.platform, isCompiled: false }, arch: process.arch, fetch: vi.fn(), run })).rejects.toThrow("git pull --ff-only");
    expect(run).not.toHaveBeenCalled();
    expect(fs.readFileSync(script, "utf8")).toBe("source checkout");
  });

  it("checks without writing files or invoking any installer", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const run = vi.fn();
    const fetcher = vi.fn(async () => Response.json(releaseFor())) as unknown as typeof fetch;
    expect(await updateCommand({ check: true, json: true }, { fetch: fetcher, run, version: "0.1.4" })).toBe(0);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ updateAvailable: true, updated: false, version: "0.1.4" });
    expect(run).not.toHaveBeenCalled();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("detects an npx runtime that has already advanced and reports new features once", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    fs.mkdirSync(path.join(dir, ".amicooked"));
    fs.writeFileSync(path.join(dir, ".amicooked/installed-version.json"), JSON.stringify({ version: "0.1.3" }));
    const log = vi.mocked(console.log);
    const fetcher = vi.fn(async () => Response.json({ ...releaseFor(), tag_name: `v${VERSION}`, body: "What's new" })) as unknown as typeof fetch;
    const run = vi.fn();
    expect(await updateCommand({ json: true }, { fetch: fetcher, run })).toBe(0);
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({ updated: true, previousVersion: "0.1.3", releaseNotes: "What's new" });
    expect(await updateCommand({ json: true }, { fetch: fetcher, run })).toBe(0);
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({ updated: false, releaseNotes: null, restart: null });
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["native", "npm"] as const)("counts successful manual/automatic %s upgrades, excluding checks and repeats", async (channel) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const report = vi.fn(async () => true);
    const runtime = { execPath: process.execPath, argv: [process.execPath, path.join(dir, "node_modules/amicooked/dist/cli.js")], platform: process.platform, isCompiled: channel === "native" };
    const fetcher = vi.fn(async () => Response.json({ tag_name: `v${VERSION}`, body: "New version", assets: [] }));
    for (const automatic of [false, true]) {
      fs.mkdirSync(path.join(dir, ".amicooked"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".amicooked/installed-version.json"), JSON.stringify({ version: "0.1.3" }));
      const options = { json: true, compatibleOnly: automatic };
      const deps = { fetch: fetcher as typeof fetch, runtime, report };
      const before = report.mock.calls.length;
      expect(await updateCommand({ ...options, check: true }, deps)).toBe(0);
      expect(report).toHaveBeenCalledTimes(before);
      expect(await updateCommand(options, deps)).toBe(0);
      expect(report).toHaveBeenLastCalledWith({ from: "0.1.3", to: VERSION, mode: automatic ? "automatic" : "manual", channel });
      expect(await updateCommand(options, deps)).toBe(0);
      expect(report).toHaveBeenCalledTimes(before + 1);
    }
  });

  it("does not count failed installations or source-checkout refreshes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const report = vi.fn(async () => true);
    const fetcher = vi.fn(async () => Response.json(releaseFor()));
    const runtime = { execPath: path.join(dir, "old-binary"), argv: [], platform: process.platform, isCompiled: true };
    fs.writeFileSync(runtime.execPath, "unchanged");
    expect(await updateCommand({ json: true }, { version: "0.1.4", fetch: fetcher as typeof fetch, runtime, report })).toBe(1);
    expect(report).not.toHaveBeenCalled();
    expect(fs.readFileSync(runtime.execPath, "utf8")).toBe("unchanged");
    fs.mkdirSync(path.join(dir, ".amicooked"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".amicooked/installed-version.json"), JSON.stringify({ version: "0.1.3" }));
    fetcher.mockImplementation(async () => Response.json({ tag_name: `v${VERSION}`, body: "", assets: [] }));
    expect(await updateCommand({ json: true }, { fetch: fetcher as typeof fetch, report })).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });

  it("reports network failures without modifying an installation", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await updateCommand({ json: true }, { fetch: vi.fn(async () => new Response("", { status: 503 })) as unknown as typeof fetch })).toBe(1);
    expect(JSON.parse(log.mock.calls[0][0]).error).toContain("503");
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(compareVersions("v0.1.10", "0.1.9")).toBe(1);
    expect(compareVersions("0.1.4", "0.2.0")).toBe(-1);
    expect(() => binaryAsset("linux", "arm64")).toThrow();
  });
});
