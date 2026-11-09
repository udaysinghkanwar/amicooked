# Am I Cooked: agent guide

A local MCP server that lets students' AI apps read their D2L Brightspace courses. TypeScript, Node 22+, compiled to standalone binaries with Bun.

## Map

| Path | Purpose |
|---|---|
| `src/cli.ts` | `amicooked` entry point and command dispatch |
| `src/cli/` | `setup`, `serve`, and `login` / `pair` / `status` / `uninstall` |
| `src/config.ts` | `~/.amicooked` paths and config (`AMICOOKED_HOME` overrides) |
| `src/schools.ts` | School presets and login-URL detection |
| `src/browser.ts`, `src/auth.ts` | Login through the student's Chrome/Edge; token capture and sharing via `token.json` |
| `src/client.ts` | D2L REST client (4 concurrent requests, 20 s timeout, retry on 401) |
| `src/courseResolver.ts` | Course code → org unit ID; current-term detection |
| `src/tools/` | The 9 MCP tools (`cooked.ts` is the flagship) |
| `src/server.ts` | Registers tools on the MCP server |
| `src/clients/` | Writers for Claude Desktop, Claude Code and ChatGPT |
| `src/remote/` | ChatGPT: OAuth store, HTTP server, tunnel, background service |
| `skill/SKILL.md` | Single source for the skill and server instructions |
| `install/` | One-line installers (copied into `site/`) |
| `site/` | Landing page (Vercel, root directory `site`) |
| `worker/` | Cloudflare Worker that provisions per-student tunnels |

## Conventions

- Run `npm test` before committing; keep commits small with short messages.
- Never print tokens, cookies or pairing codes to logs. `mcp` mode must keep stdout clean.
- Tools are read-only. Tool errors are returned as results so the AI can relay them.
- After editing `skill/SKILL.md` or `install/`, run `npm run sync:skill`.
- Release: bump `package.json` and `src/version.ts`, tag `vX.Y.Z`; CI builds binaries and a GitHub release.
