import * as http from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { serverInstructions } from "../instructions.js";
import { createServer } from "../server.js";
import { OAuthError, OAuthStore } from "./oauth.js";

export const DEFAULT_PORT = 8787;
const MAX_BODY = 1024 * 1024;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new OAuthError("invalid_request", "Request too large", 413);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  if ((req.headers["content-type"] ?? "").includes("application/json")) return JSON.parse(raw);
  return Object.fromEntries(new URLSearchParams(raw));
}

function consentPage(params: Record<string, string>, clientName: string, error?: string): string {
  const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"]
    .map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(params[k] ?? "")}">`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Am I Cooked</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F3EC;color:#1A1714;font:16px/1.5 system-ui,sans-serif;padding:16px}
main{max-width:380px;width:100%}h1{font-size:28px;margin:0 0 8px}p{color:#6B645C;margin:0 0 20px}
input[name=pairing_code]{width:100%;box-sizing:border-box;font:600 28px ui-monospace,monospace;letter-spacing:.3em;text-align:center;padding:12px;border:1px solid #E4DDD2;border-radius:10px;background:#fff}
button{margin-top:12px;width:100%;padding:12px;border:0;border-radius:10px;background:#1A1714;color:#F7F3EC;font:600 16px system-ui}
.error{color:#B42318;margin:0 0 12px}code{background:#EFE8DC;padding:1px 5px;border-radius:5px}
</style></head><body><main>
<h1>Connect ${escapeHtml(clientName)}</h1>
<p>Enter the 6-digit code from <code>amicooked pair</code> on your computer. It lets ${escapeHtml(clientName)} read your courses through Am I Cooked.</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/authorize">${hidden}
<input name="pairing_code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required autofocus aria-label="Pairing code">
<button type="submit">Connect</button></form></main></body></html>`;
}

export interface RemoteServerOptions {
  /** The public https URL clients reach us at, e.g. https://abc123.amicooked.app */
  publicUrl: string;
  store?: OAuthStore;
}

/** HTTP MCP server with OAuth, for ChatGPT and other remote clients. Listens on loopback only. */
export function createRemoteServer({ publicUrl, store = new OAuthStore() }: RemoteServerOptions): http.Server {
  const base = publicUrl.replace(/\/+$/, "");
  const resourceMetadata = `${base}/.well-known/oauth-protected-resource`;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const route = `${req.method} ${url.pathname}`;
    try {
      if (req.method === "GET" && url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
        return send(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ["header"] });
      }
      if (req.method === "GET" && url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
        return send(res, 200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      }
      if (route === "POST /register") {
        return send(res, 201, { ...store.register(await readBody(req)), token_endpoint_auth_method: "none" });
      }
      if (route === "GET /authorize") {
        const params = Object.fromEntries(url.searchParams);
        if (params.response_type !== "code") throw new OAuthError("unsupported_response_type", "Only response_type=code is supported");
        return send(res, 200, consentPage(params, store.clientName(params.client_id, params.redirect_uri)));
      }
      if (route === "POST /authorize") {
        const params = await readBody(req);
        const clientName = store.clientName(params.client_id, params.redirect_uri);
        try {
          const code = store.authorize({
            clientId: params.client_id,
            redirectUri: params.redirect_uri,
            challenge: params.code_challenge,
            method: params.code_challenge_method,
            pairingCode: String(params.pairing_code ?? ""),
          });
          const target = new URL(params.redirect_uri);
          target.searchParams.set("code", code);
          if (params.state) target.searchParams.set("state", params.state);
          res.writeHead(302, { Location: target.toString(), "Cache-Control": "no-store" });
          return res.end();
        } catch (error) {
          if (!(error instanceof OAuthError) || error.status !== 403) throw error;
          return send(res, 403, consentPage(params, clientName, error.message));
        }
      }
      if (route === "POST /token") {
        const body = await readBody(req);
        if (body.grant_type === "authorization_code") {
          return send(res, 200, store.exchangeCode({ code: body.code, clientId: body.client_id, redirectUri: body.redirect_uri, verifier: body.code_verifier }));
        }
        if (body.grant_type === "refresh_token") {
          return send(res, 200, store.refresh({ refreshToken: body.refresh_token, clientId: body.client_id }));
        }
        throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token");
      }
      if (url.pathname === "/mcp") {
        const auth = req.headers.authorization ?? "";
        if (!auth.startsWith("Bearer ") || !store.verifyAccessToken(auth.slice(7))) {
          return send(res, 401, { error: "invalid_token" }, { "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadata}"` });
        }
        if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
        // Stateless: a fresh server per request, JSON responses (no SSE, which quick tunnels drop)
        const server = createServer({ instructions: serverInstructions() });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on("close", () => {
          transport.close().catch(() => {});
          server.close().catch(() => {});
        });
        await server.connect(transport);
        return await transport.handleRequest(req, res, await readBody(req));
      }
      return send(res, 404, { error: "not_found" });
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof OAuthError) return send(res, error.status, { error: error.code, error_description: error.message });
      if (error instanceof SyntaxError) return send(res, 400, { error: "invalid_request", error_description: "Malformed body" });
      console.error(`[http] ${route} failed: ${error instanceof Error ? error.message : error}`);
      return send(res, 500, { error: "server_error" });
    }
  });
}
