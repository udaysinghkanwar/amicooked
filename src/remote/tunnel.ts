import { execFileSync, spawn, spawnSync, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { paths, writePrivateFile } from "../config.js";
import { VERSION } from "../version.js";

/** Hands out a permanent <id>.amicooked.app tunnel; holds the Cloudflare API token so we never ship it. */
const TUNNEL_API = process.env.AMICOOKED_TUNNEL_API || "https://tunnels.amicooked.app";
const USER_AGENT = `amicooked/${VERSION}`;

export interface Tunnel {
  url: string;
  tunnelId: string;
  tunnelToken: string;
  heartbeatSecret: string;
}

export function readTunnel(): Tunnel | null {
  try {
    return JSON.parse(fs.readFileSync(paths().tunnel, "utf8"));
  } catch {
    return null;
  }
}

/** Reuse this computer's tunnel, or ask the provisioning API for one. */
export async function ensureTunnel(): Promise<Tunnel> {
  const existing = readTunnel();
  if (existing) return existing;
  const res = await fetch(`${TUNNEL_API}/tunnels`, { method: "POST", headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30000) });
  if (res.status === 429) throw new Error("Too many ChatGPT connections were set up from this network today. Try again tomorrow.");
  if (!res.ok) throw new Error(`Couldn't set up the ChatGPT connection (error ${res.status}). Try again later.`);
  const body = (await res.json()) as Tunnel;
  const tunnel = { url: body.url, tunnelId: body.tunnelId, tunnelToken: body.tunnelToken, heartbeatSecret: body.heartbeatSecret };
  writePrivateFile(paths().tunnel, JSON.stringify(tunnel));
  return tunnel;
}

/** Tell the API this tunnel is still in use, so it isn't cleaned up after 30 quiet days. */
export async function heartbeat(tunnel: Tunnel): Promise<void> {
  await fetch(`${TUNNEL_API}/tunnels/heartbeat`, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, Authorization: `Bearer ${tunnel.heartbeatSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tunnelId: tunnel.tunnelId }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => {});
}

// ---- cloudflared ----

const CLOUDFLARED_VERSION = "2026.10.3";
// SHA-256 of each release asset as downloaded (GitHub's asset digest; the release notes hash the binary inside the .tgz)
const CLOUDFLARED_ASSETS: Record<string, { asset: string; sha256: string }> = {
  "darwin-arm64": { asset: "cloudflared-darwin-arm64.tgz", sha256: "1165d14b6f6360a3b8c283d7d1100024d6ec7cd9bc9e32519e96150645f3ec55" },
  "darwin-x64": { asset: "cloudflared-darwin-amd64.tgz", sha256: "81b7b85f2376815c4f59b1aa323887b62e16ce8b67555c2e1577dc23f2a82000" },
  "linux-x64": { asset: "cloudflared-linux-amd64", sha256: "053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0" },
  "win32-x64": { asset: "cloudflared-windows-amd64.exe", sha256: "76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2" },
};

const exe = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";

/** A cloudflared to run: one already on PATH, or our own pinned, checksum-verified copy. */
export async function ensureCloudflared(): Promise<string> {
  const onPath = spawnSync("cloudflared", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  if (!onPath.error && onPath.status === 0) return "cloudflared";

  const target = path.join(paths().bin, exe);
  if (fs.existsSync(target)) return target;

  const key = `${process.platform}-${os.arch()}`;
  const spec = CLOUDFLARED_ASSETS[key];
  if (!spec) throw new Error(`ChatGPT support isn't available on ${key} yet.`);
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${spec.asset}`;
  // GitHub's download CDN sometimes answers 5xx; retry a couple of times before giving up
  let res: Response | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await fetch(url, { signal: AbortSignal.timeout(120000) }).catch(() => null);
    if (res?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
  if (!res?.ok) throw new Error(`Couldn't download cloudflared (${res?.status ?? "network error"}). Check your connection and try again.`);
  const data = Buffer.from(await res.arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== spec.sha256) throw new Error("cloudflared download failed its checksum; not using it.");

  fs.mkdirSync(paths().bin, { recursive: true });
  if (spec.asset.endsWith(".tgz")) {
    const archive = path.join(paths().bin, spec.asset);
    fs.writeFileSync(archive, data);
    execFileSync("tar", ["-xzf", archive, "-C", paths().bin]);
    fs.rmSync(archive);
  } else {
    fs.writeFileSync(target, data);
  }
  fs.chmodSync(target, 0o755);
  return target;
}

/** Run the tunnel. The token goes through the environment so it isn't visible in `ps`. */
export function startCloudflared(binary: string, tunnel: Tunnel): ChildProcess {
  return spawn(binary, ["tunnel", "--no-autoupdate", "run"], {
    env: { ...process.env, TUNNEL_TOKEN: tunnel.tunnelToken },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
}
