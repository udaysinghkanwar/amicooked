import { spawn, type ChildProcess } from "child_process";
import { createRemoteServer, DEFAULT_PORT } from "../remote/http.js";
import { OAuthStore } from "../remote/oauth.js";
import { ensureCloudflared, ensureTunnel, heartbeat, readTunnel, startCloudflared, type Tunnel } from "../remote/tunnel.js";

const HEARTBEAT_MS = 12 * 60 * 60 * 1000;

/** Keep the tunnel up, restarting cloudflared with a growing delay if it exits. */
function superviseTunnel(binary: string, tunnel: Tunnel): void {
  let delay = 2000;
  const start = () => {
    const child = startCloudflared(binary, tunnel);
    const startedAt = Date.now();
    child.stderr?.on("data", (d) => {
      const line = String(d).trim();
      if (/ERR|error/i.test(line)) console.error(`[tunnel] ${line.slice(0, 300)}`);
    });
    child.on("exit", (code) => {
      if (Date.now() - startedAt > 60000) delay = 2000;
      console.error(`[tunnel] cloudflared exited (${code}); restarting in ${delay / 1000}s`);
      setTimeout(start, delay);
      delay = Math.min(delay * 2, 5 * 60 * 1000);
    });
  };
  start();
}

/** Developer fallback: a throwaway trycloudflare.com URL instead of a provisioned tunnel. */
async function quickTunnel(binary: string, port: number): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(binary, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "ignore", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cloudflared didn't report a URL")), 30000);
    child.stderr!.on("data", (d) => {
      const match = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) clearTimeout(timer), resolve(match[0]);
    });
    child.on("exit", () => reject(new Error("cloudflared exited")));
  });
  return { url, child };
}

/** Keep a Mac from idle-sleeping while ChatGPT may need it; released when we exit. */
function keepAwake(): void {
  if (process.platform !== "darwin") return;
  spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore", detached: true }).unref();
}

export async function serveCommand(options: { quick?: boolean; local?: boolean; port?: number }): Promise<number> {
  const port = options.port ?? DEFAULT_PORT;
  let publicUrl = `http://127.0.0.1:${port}`;
  let tunnel: Tunnel | null = null;
  let quick: ChildProcess | null = null;

  if (options.quick) {
    const q = await quickTunnel(await ensureCloudflared(), port);
    publicUrl = q.url;
    quick = q.child;
  } else if (!options.local) {
    tunnel = readTunnel() ?? (await ensureTunnel());
    publicUrl = tunnel.url;
  }

  const server = createRemoteServer({ publicUrl, store: new OAuthStore() });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  console.error(`[serve] listening on 127.0.0.1:${port}, public URL ${publicUrl}/mcp`);

  if (tunnel) {
    superviseTunnel(await ensureCloudflared(), tunnel);
    await heartbeat(tunnel);
    setInterval(() => heartbeat(tunnel!), HEARTBEAT_MS).unref();
  }
  keepAwake();

  const stop = () => {
    quick?.kill();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  if (options.quick) {
    console.log(`ChatGPT connector URL (changes every run): ${publicUrl}/mcp\nPairing code: ${new OAuthStore().newPairingCode()}`);
  }
  return new Promise<number>(() => {});
}
