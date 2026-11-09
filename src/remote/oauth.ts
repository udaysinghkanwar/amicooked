import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import * as fs from "fs";
import { paths, writePrivateFile } from "../config.js";

/**
 * A tiny OAuth 2.1 authorization server for remote MCP clients like ChatGPT:
 * dynamic client registration, authorization code + PKCE (S256), refresh tokens.
 * Consent needs a short pairing code shown on the student's own computer, so
 * someone who finds the public URL can't connect themselves.
 */

const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const PAIRING_MAX_ATTEMPTS = 5;

interface Client {
  name: string;
  redirectUris: string[];
  createdAt: number;
}

interface Grant {
  clientId: string;
  redirectUri: string;
  challenge: string;
  expiresAt: number;
}

interface Token {
  clientId: string;
  kind: "access" | "refresh";
  expiresAt: number;
}

interface State {
  clients: Record<string, Client>;
  codes: Record<string, Grant>;
  tokens: Record<string, Token>;
  pairing?: { hash: string; expiresAt: number; attempts: number };
}

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const b64url = (buf: Buffer) => buf.toString("base64url");
const secret = () => b64url(randomBytes(32));

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Redirects must go to an https URL (or loopback during development). */
function validRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "https:" || (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname));
  } catch {
    return false;
  }
}

export class OAuthStore {
  constructor(private file = paths().oauth, private now = () => Date.now()) {}

  private load(): State {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return { clients: {}, codes: {}, tokens: {} };
    }
  }

  private save(state: State): void {
    const t = this.now();
    // Drop anything expired so the file doesn't grow forever
    for (const [k, v] of Object.entries(state.codes)) if (v.expiresAt < t) delete state.codes[k];
    for (const [k, v] of Object.entries(state.tokens)) if (v.expiresAt < t) delete state.tokens[k];
    writePrivateFile(this.file, JSON.stringify(state));
  }

  /** A fresh 6-digit pairing code for the student to type into ChatGPT's consent page. */
  newPairingCode(): string {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const state = this.load();
    state.pairing = { hash: sha256(code), expiresAt: this.now() + PAIRING_TTL_MS, attempts: 0 };
    this.save(state);
    return code;
  }

  register(body: { client_name?: string; redirect_uris?: unknown }): { client_id: string; client_name: string; redirect_uris: string[] } {
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
    if (!uris.length || !uris.every(validRedirect)) throw new OAuthError("invalid_redirect_uri", "redirect_uris must be https URLs");
    const state = this.load();
    if (Object.keys(state.clients).length >= 50) throw new OAuthError("invalid_client_metadata", "Too many registered clients");
    const id = secret();
    const name = (body.client_name ?? "AI app").slice(0, 80);
    state.clients[id] = { name, redirectUris: uris, createdAt: this.now() };
    this.save(state);
    return { client_id: id, client_name: name, redirect_uris: uris };
  }

  clientName(clientId: string, redirectUri: string): string {
    const client = this.load().clients[clientId];
    if (!client) throw new OAuthError("invalid_client", "Unknown client");
    if (!client.redirectUris.includes(redirectUri)) throw new OAuthError("invalid_request", "redirect_uri doesn't match the registration");
    return client.name;
  }

  /** Check the pairing code and issue an authorization code bound to the PKCE challenge. */
  authorize(params: { clientId: string; redirectUri: string; challenge: string; method: string; pairingCode: string }): string {
    this.clientName(params.clientId, params.redirectUri);
    if (params.method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(params.challenge)) {
      throw new OAuthError("invalid_request", "PKCE with S256 is required");
    }
    const state = this.load();
    const pairing = state.pairing;
    if (!pairing || pairing.expiresAt < this.now() || pairing.attempts >= PAIRING_MAX_ATTEMPTS) {
      throw new OAuthError("access_denied", "That pairing code expired. Run `amicooked pair` for a new one.", 403);
    }
    if (!sameHash(sha256(params.pairingCode.replace(/\D/g, "")), pairing.hash)) {
      pairing.attempts++;
      this.save(state);
      throw new OAuthError("access_denied", "Wrong pairing code. Check the code from `amicooked pair`.", 403);
    }
    delete state.pairing; // one use
    const code = secret();
    state.codes[sha256(code)] = { clientId: params.clientId, redirectUri: params.redirectUri, challenge: params.challenge, expiresAt: this.now() + CODE_TTL_MS };
    this.save(state);
    return code;
  }

  private issue(state: State, clientId: string) {
    const access = secret();
    const refresh = secret();
    state.tokens[sha256(access)] = { clientId, kind: "access", expiresAt: this.now() + ACCESS_TTL_MS };
    state.tokens[sha256(refresh)] = { clientId, kind: "refresh", expiresAt: this.now() + REFRESH_TTL_MS };
    this.save(state);
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh };
  }

  exchangeCode(params: { code: string; clientId: string; redirectUri: string; verifier: string }) {
    const state = this.load();
    const key = sha256(params.code);
    const grant = state.codes[key];
    delete state.codes[key]; // codes are single-use even when the exchange fails
    this.save(state);
    if (!grant || grant.expiresAt < this.now()) throw new OAuthError("invalid_grant", "Authorization code is invalid or expired");
    if (grant.clientId !== params.clientId || grant.redirectUri !== params.redirectUri) throw new OAuthError("invalid_grant", "Code was issued to another client");
    if (b64url(createHash("sha256").update(params.verifier).digest()) !== grant.challenge) throw new OAuthError("invalid_grant", "PKCE verification failed");
    return this.issue(this.load(), grant.clientId);
  }

  refresh(params: { refreshToken: string; clientId: string }) {
    const state = this.load();
    const key = sha256(params.refreshToken);
    const token = state.tokens[key];
    if (!token || token.kind !== "refresh" || token.expiresAt < this.now() || token.clientId !== params.clientId) {
      throw new OAuthError("invalid_grant", "Refresh token is invalid or expired");
    }
    delete state.tokens[key]; // rotate
    return this.issue(state, token.clientId);
  }

  verifyAccessToken(token: string): boolean {
    const entry = this.load().tokens[sha256(token)];
    return Boolean(entry && entry.kind === "access" && entry.expiresAt > this.now());
  }

  /** Disconnect every remote app, e.g. when the student turns ChatGPT off. */
  revokeAll(): void {
    this.save({ clients: {}, codes: {}, tokens: {} });
  }
}
