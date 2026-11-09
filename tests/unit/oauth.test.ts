import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OAuthError, OAuthStore } from "../../src/remote/oauth.js";

let dir: string;
let now: number;
let store: OAuthStore;
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const verifier = "a".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-"));
  now = Date.parse("2026-11-09T12:00:00Z");
  store = new OAuthStore(path.join(dir, "oauth.json"), () => now);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function connect(pairingCode?: string) {
  const { client_id } = store.register({ client_name: "ChatGPT", redirect_uris: [redirect] });
  const code = store.authorize({ clientId: client_id, redirectUri: redirect, challenge, method: "S256", pairingCode: pairingCode ?? store.newPairingCode() });
  return { client_id, code };
}

describe("OAuthStore", () => {
  it("runs the full flow: register, pair, exchange, use, refresh", () => {
    const { client_id, code } = connect();
    const tokens = store.exchangeCode({ code, clientId: client_id, redirectUri: redirect, verifier });
    expect(store.verifyAccessToken(tokens.access_token)).toBe(true);

    const refreshed = store.refresh({ refreshToken: tokens.refresh_token, clientId: client_id });
    expect(store.verifyAccessToken(refreshed.access_token)).toBe(true);
    // Refresh tokens rotate
    expect(() => store.refresh({ refreshToken: tokens.refresh_token, clientId: client_id })).toThrow(OAuthError);
  });

  it("rejects a wrong pairing code and locks after five tries", () => {
    const { client_id } = store.register({ redirect_uris: [redirect] });
    const real = store.newPairingCode();
    const wrong = real === "000000" ? "111111" : "000000";
    const attempt = (pairingCode: string) =>
      store.authorize({ clientId: client_id, redirectUri: redirect, challenge, method: "S256", pairingCode });
    for (let i = 0; i < 5; i++) expect(() => attempt(wrong)).toThrow(/Wrong pairing code/);
    expect(() => attempt(real)).toThrow(/expired/);
  });

  it("expires pairing codes after ten minutes and uses them once", () => {
    const { client_id } = store.register({ redirect_uris: [redirect] });
    const code = store.newPairingCode();
    now += 11 * 60 * 1000;
    expect(() => store.authorize({ clientId: client_id, redirectUri: redirect, challenge, method: "S256", pairingCode: code })).toThrow(/expired/);

    const fresh = store.newPairingCode();
    store.authorize({ clientId: client_id, redirectUri: redirect, challenge, method: "S256", pairingCode: fresh });
    expect(() => store.authorize({ clientId: client_id, redirectUri: redirect, challenge, method: "S256", pairingCode: fresh })).toThrow(/expired/);
  });

  it("enforces PKCE and single-use codes", () => {
    const { client_id, code } = connect();
    expect(() => store.exchangeCode({ code, clientId: client_id, redirectUri: redirect, verifier: "b".repeat(64) })).toThrow(/PKCE/);
    expect(() => store.exchangeCode({ code, clientId: client_id, redirectUri: redirect, verifier })).toThrow(/invalid or expired/);
  });

  it("only accepts https redirects and registered ones", () => {
    expect(() => store.register({ redirect_uris: ["http://evil.example/cb"] })).toThrow(OAuthError);
    const { client_id } = store.register({ redirect_uris: [redirect] });
    expect(() => store.clientName(client_id, "https://other.example/cb")).toThrow(/doesn't match/);
  });

  it("expires access tokens and revokes everything", () => {
    const { client_id, code } = connect();
    const { access_token } = store.exchangeCode({ code, clientId: client_id, redirectUri: redirect, verifier });
    now += 61 * 60 * 1000;
    expect(store.verifyAccessToken(access_token)).toBe(false);
    store.revokeAll();
    expect(() => store.clientName(client_id, redirect)).toThrow(/Unknown client/);
  });
});
