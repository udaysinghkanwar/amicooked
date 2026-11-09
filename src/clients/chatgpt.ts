import { OAuthStore } from "../remote/oauth.js";
import { installService, serviceInstalled, uninstallService } from "../remote/service.js";
import { ensureCloudflared, ensureTunnel, readTunnel } from "../remote/tunnel.js";
import { selfCommand } from "./self.js";

/** Give this computer a permanent ChatGPT URL and keep `amicooked serve` running in the background. */
export async function installChatGPT(): Promise<{ url: string; pairingCode: string }> {
  const tunnel = await ensureTunnel();
  await ensureCloudflared();
  installService(selfCommand(["serve"]));
  return { url: `${tunnel.url}/mcp`, pairingCode: new OAuthStore().newPairingCode() };
}

export function chatgptUrl(): string | null {
  const tunnel = readTunnel();
  return tunnel && serviceInstalled() ? `${tunnel.url}/mcp` : null;
}

export function chatgptSteps(url: string, pairingCode: string): string {
  return [
    "In ChatGPT (on the web):",
    "  1. Settings → Apps & Connectors → Advanced settings → turn on Developer mode",
    "  2. Apps & Connectors → Create",
    `  3. Name: Am I Cooked · URL: ${url} · Authentication: OAuth`,
    `  4. When ChatGPT asks for a code, enter ${pairingCode} (valid 10 minutes; \`amicooked pair\` makes a new one)`,
    "ChatGPT can reach Am I Cooked while this computer is on and awake.",
  ].join("\n");
}

/** Stop the background service and disconnect every ChatGPT session. The tunnel is kept for next time. */
export function uninstallChatGPT(): boolean {
  new OAuthStore().revokeAll();
  return uninstallService();
}
