import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { OAuthStore } from "../../src/remote/oauth.js";
import { createRemoteServer } from "../../src/remote/http.js";

let dir: string;
let server: Server;
let base: string;
let store: OAuthStore;
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const verifier = "v".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "http-"));
  store = new OAuthStore(path.join(dir, "oauth.json"));
  server = createRemoteServer({ publicUrl: "https://abc.amicooked.app", store });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

const form = (body: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body).toString(),
  redirect: "manual" as const,
});

const mcpCall = (token?: string) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

describe("remote server", () => {
  it("challenges unauthenticated MCP calls with resource metadata", async () => {
    const res = await mcpCall();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("https://abc.amicooked.app/.well-known/oauth-protected-resource");
    const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    expect(meta.registration_endpoint).toBe("https://abc.amicooked.app/register");
  });

  it("connects a client end to end with the pairing code", async () => {
    const reg = await (await fetch(`${base}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: [redirect] }),
    })).json();

    const authParams = { client_id: reg.client_id, redirect_uri: redirect, state: "xyz", code_challenge: challenge, code_challenge_method: "S256" };
    const page = await fetch(`${base}/authorize?${new URLSearchParams({ ...authParams, response_type: "code" })}`);
    expect(await page.text()).toContain("Connect ChatGPT");

    const wrong = await fetch(`${base}/authorize`, form({ ...authParams, pairing_code: "not-it" }));
    expect(wrong.status).toBe(403);

    const approved = await fetch(`${base}/authorize`, form({ ...authParams, pairing_code: store.newPairingCode() }));
    expect(approved.status).toBe(302);
    const location = new URL(approved.headers.get("location")!);
    expect(location.searchParams.get("state")).toBe("xyz");

    const tokens = await (await fetch(`${base}/token`, form({
      grant_type: "authorization_code", code: location.searchParams.get("code")!, client_id: reg.client_id, redirect_uri: redirect, code_verifier: verifier,
    }))).json();
    const res = await mcpCall(tokens.access_token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools.map((t: { name: string }) => t.name)).toContain("am_i_cooked");
  });

  it("returns 404 for anything else", async () => {
    expect((await fetch(`${base}/admin`)).status).toBe(404);
  });
});
