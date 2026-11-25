import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { acquireLock } from "../lock.js";
import * as fs from "fs";
import * as path from "path";
import { currentRuntime, installationChannel, type Runtime } from "../clients/self.js";
import { installedSkillVersion, refreshSkills } from "../skills.js";
import { paths } from "../config.js";
import { prepareVideoIfEnabled } from "../video/runtime.js";
import { reportUpgrade } from "../telemetry.js";
import { VERSION } from "../version.js";

const REPO = "udaysinghkanwar/amicooked";
const RELEASES = `https://github.com/${REPO}/releases`;
interface Release {
  tag_name: string;
  body: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets: { name: string; browser_download_url: string }[];
}

export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    if (!/^v?\d+\.\d+\.\d+$/.test(v)) throw new Error(`Unsupported release version: ${v}`);
    return v.replace(/^v/, "").split(".").map(Number);
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]);
  return 0;
}

export function binaryAsset(platform: NodeJS.Platform, arch: string): string {
  const target = `${platform === "win32" ? "windows" : platform}-${arch}`;
  if (!["darwin-arm64", "darwin-x64", "linux-x64", "windows-x64"].includes(target)) {
    throw new Error(`No standalone release for ${target}. Use npm with Node.js 22 or newer.`);
  }
  return `amicooked-${target}${platform === "win32" ? ".exe" : ""}`;
}

/** Keep a rollback copy; Unix replacement is atomic even while the old process runs. */
export function replaceBinary(staged: string, target: string, platform = process.platform): void {
  const backup = `${target}.previous`;
  if (platform !== "win32") {
    fs.copyFileSync(target, backup);
    fs.renameSync(staged, target);
    return;
  }
  fs.rmSync(backup, { force: true });
  fs.renameSync(target, backup);
  try {
    fs.renameSync(staged, target);
  } catch (error) {
    fs.renameSync(backup, target);
    throw error;
  }
}

type Run = (command: string, args: string[]) => string;
const execute: Run = (command, args) => execFileSync(command, args, {
  encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 900_000,
}).trim();

/** Run npm through Node when possible; avoids shell quoting and npm.cmd on Windows. */
export function npmCommand(rt: Runtime): { command: string; args: string[] } {
  const bin = path.dirname(rt.execPath);
  const candidates = [
    path.join(bin, "node_modules/npm/bin/npm-cli.js"),
    path.resolve(bin, "../lib/node_modules/npm/bin/npm-cli.js"),
    ...(process.env.npm_execpath?.endsWith("npm-cli.js") ? [process.env.npm_execpath] : []),
  ];
  const cli = candidates.find(fs.existsSync);
  if (cli) return { command: rt.execPath, args: [cli] };
  if (rt.platform !== "win32") return { command: "npm", args: [] };
  throw new Error("Couldn't find npm. Install Node.js 22 or newer with npm, then retry.");
}

export async function installRelease(release: Release, options: {
  runtime: Runtime; arch: string; fetch: typeof fetch; run: Run;
}): Promise<void> {
  const { runtime: rt, run } = options;
  const version = release.tag_name.replace(/^v/, "");
  if (!rt.isCompiled) {
    const npm = npmCommand(rt);
    const runNpm = (args: string[]) => run(npm.command, [...npm.args, ...args]);
    const script = fs.realpathSync(rt.argv[1]);
    if (/[\\/]_npx[\\/]/.test(script)) {
      runNpm(["exec", "--yes", `--package=amicooked@${version}`, "--", "amicooked", "refresh-skills"]);
      return;
    }
    const root = path.resolve(path.dirname(script), "..");
    if (path.basename(path.dirname(root)) !== "node_modules") {
      throw new Error("This is a source checkout. Update your branch with git pull --ff-only, then npm ci and npm run build. Run amicooked update again to refresh installed skills. No checkout files were changed.");
    }
    const globalRoot = fs.realpathSync(runNpm(["root", "--global"]));
    if (fs.realpathSync(path.dirname(root)) === globalRoot) {
      const prefix = runNpm(["prefix", "--global"]);
      runNpm(["install", "--global", "--prefix", prefix, `amicooked@${version}`]);
    } else {
      runNpm(["install", "--prefix", path.dirname(path.dirname(root)), `amicooked@${version}`]);
    }
    run(rt.execPath, [script, "refresh-skills"]);
    return;
  }

  const asset = binaryAsset(rt.platform, options.arch);
  const download = async (name: string) => {
    const url = release.assets.find(a => a.name === name)?.browser_download_url;
    const expected = `${RELEASES}/download/${release.tag_name}/${name}`;
    if (url !== expected) throw new Error(`Release is missing ${name} at its expected GitHub URL. Try again once the release finishes publishing.`);
    return request(url, options.fetch);
  };
  const sums = await (await download("SHA256SUMS")).text();
  const expected = sums.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts[1] === asset)?.[0];
  if (!expected || !/^[a-f\d]{64}$/i.test(expected)) throw new Error(`No checksum for ${asset}.`);
  const bytes = Buffer.from(await (await download(asset)).arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected.toLowerCase()) {
    throw new Error("Checksum mismatch. The existing installation was left unchanged.");
  }
  const stagingDir = fs.mkdtempSync(path.join(path.dirname(rt.execPath), ".amicooked-update-"));
  const staged = path.join(stagingDir, path.basename(rt.execPath));
  try {
    fs.writeFileSync(staged, bytes, { mode: 0o755 });
    if (run(staged, ["--version"]) !== version) throw new Error("Downloaded executable reports the wrong version; the existing installation was left unchanged.");
    try {
      replaceBinary(staged, rt.execPath, rt.platform);
    } catch (error) {
      throw new Error(`Couldn't replace the executable. Close AI apps using Am I Cooked, then retry. ${error instanceof Error ? error.message : error}`);
    }
    try {
      run(rt.execPath, ["refresh-skills"]);
    } catch (error) {
      throw new Error(`The app was updated, but skill refresh failed. Run \`amicooked update\` again to repair it. ${error instanceof Error ? error.message : error}`);
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

async function request(url: string, fetcher: typeof fetch): Promise<Response> {
  const response = await fetcher(url, {
    headers: { "User-Agent": "amicooked-updater", Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Update request failed (${response.status}). Check your connection or try again later. Releases: ${RELEASES}`);
  return response;
}

export const acquireUpdateLock = () => acquireLock(path.join(paths().home, "update.lock"), "update");

export async function updateCommand(options: { check?: boolean; json?: boolean; compatibleOnly?: boolean } = {}, deps: {
  fetch?: typeof fetch; runtime?: Runtime; run?: Run; version?: string; arch?: string; allowed?: () => boolean; report?: typeof reportUpgrade;
} = {}): Promise<number> {
  let releaseLock: (() => void) | undefined;
  try {
    const fetcher = deps.fetch ?? fetch;
    const version = deps.version ?? VERSION;
    const runtime = deps.runtime ?? currentRuntime();
    // npx may already have fetched a newer runtime before this command starts.
    const previousVersion = installedSkillVersion() ?? version;
    const release = await (await request(`https://api.github.com/repos/${REPO}/releases/latest`, fetcher)).json() as Release;
    if (release.draft || release.prerelease) throw new Error("The latest release is not a stable release.");
    if (options.compatibleOnly && release.tag_name.replace(/^v/, "").split(".").slice(0, 2).join(".") !== version.split(".").slice(0, 2).join(".")) {
      console.log(JSON.stringify({ updated: false, manualUpdateRequired: true, latestVersion: release.tag_name, reason: "Automatic updates only apply patch releases in the current major/minor." }));
      return 0;
    }
    const available = compareVersions(release.tag_name, version) > 0;
    const changed = available || compareVersions(version, previousVersion) > 0;
    if (!options.check) {
      if (deps.allowed && !deps.allowed()) return 0;
      releaseLock = acquireUpdateLock();
      if (compareVersions(previousVersion, version) > 0 && !available) throw new Error("Installed skills are newer than this runtime. Reload your AI app or run the newer installation; older instructions were not written.");
    }
    if (!options.check && available) await installRelease(release, {
      runtime, arch: deps.arch ?? process.arch, fetch: fetcher, run: deps.run ?? execute,
    });
    const skills = !options.check && !available ? refreshSkills() : [];
    if (!options.check && !available) await prepareVideoIfEnabled();
    const skillsChanged = skills.some(result => !result.endsWith(": unchanged"));
    const result = {
      previousVersion,
      version: !options.check && available ? release.tag_name.replace(/^v/, "") : version,
      latestVersion: release.tag_name.replace(/^v/, ""),
      updateAvailable: Boolean(options.check && changed),
      updated: !options.check && changed,
      skills,
      releaseNotes: compareVersions(release.tag_name, previousVersion) > 0 ? release.body ?? "See the release page for details." : null,
      releaseUrl: `${RELEASES}/tag/${release.tag_name}`,
      restart: !options.check && (changed || skillsChanged) ? "Restart/reload your AI app to pick up changed skills and the MCP server. Existing login and settings are kept. Changed skill files are saved in each skill folder's .backups/." : null,
    };
    const channel = installationChannel(runtime);
    if (result.updated && channel) {
      await (deps.report ?? reportUpgrade)({
        from: previousVersion, to: result.version,
        mode: options.compatibleOnly ? "automatic" : "manual",
        channel,
      });
    }
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.updated ? `Updated Am I Cooked ${previousVersion} → ${result.version}.` : changed ? `Update available: ${previousVersion} → ${result.latestVersion}. Run amicooked update.` : `Am I Cooked ${version} is up to date${skills.length ? "; installed skills refreshed" : ""}.`);
      if (result.releaseNotes) console.log(`\nWhat's new:\n${result.releaseNotes}\n${result.releaseUrl}`);
      if (result.restart) console.log(`\n${result.restart}`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) console.log(JSON.stringify({ updated: false, error: message }));
    else console.error(message);
    return 1;
  } finally { releaseLock?.(); }
}
