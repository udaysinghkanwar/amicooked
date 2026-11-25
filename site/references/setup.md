# Setup and client verification

**First, check that you can run commands on the student's computer.** Setup installs a program there, so it only works from an agent with a terminal, like Claude Code, Codex, Antigravity CLI or a desktop agent with local terminal access. If you're on a website (chatgpt.com, claude.ai, gemini.google.com), in a phone app, or in a chat with no command tool, don't try. Tell the student instead:

- Get an app that can do it: Claude Desktop (https://claude.ai/download) or the ChatGPT app (https://chatgpt.com/download), then paste the same request there. Or install it themselves by pasting this into Terminal (Mac): `curl -fsSL https://amicooked-mcp.vercel.app/install.sh | sh`, or this into PowerShell (Windows): `irm https://amicooked-mcp.vercel.app/install.ps1 | iex`.
- Setup prints exactly what remains for the selected app. Gemini Mac and its bundled Antigravity CLI share a local HTTP registration; verify the app/session the student actually uses.

If you can run commands:

1. Ask the student which school they go to. Reuse answers already given. Presets: mcmaster, waterloo, western, queens, guelph, laurier, tmu, uottawa, carleton, brock, windsor, laurentian, lakehead. Any other Brightspace school works with the URL they log in through.
2. Install it:
   - macOS / Linux: `curl -fsSL https://amicooked-mcp.vercel.app/install.sh | sh -s -- --no-setup`
   - Windows (PowerShell): `$env:AMICOOKED_NO_SETUP=1; irm https://amicooked-mcp.vercel.app/install.ps1 | iex`
   - With Node.js installed, `npx -y amicooked@0` works in place of `amicooked` below.
3. Run setup with flags, and a long command timeout (at least 5 minutes), because the student signs in through a browser window that opens:
   `amicooked setup --school mcmaster --clients desktop,code`
   For Gemini Mac, its bundled Antigravity CLI, or [Antigravity CLI on Windows](https://antigravity.google/docs/cli-getting-started), use `--clients gemini` (alias `gemini-desktop`). Select the app the student requested explicitly so setup does not configure unrelated apps. Setup registers MCP and checks the connection and discovers the available tools automatically; no manual JSON is needed.
   Use `--school https://...` for schools without a preset. Add `chatgpt-desktop` to `--clients` if they use the ChatGPT desktop app, then tell them to restart it. ChatGPT and Claude on the web or on phones aren't supported.
4. Tell the student to sign in to their school in the browser window. Never ask for their password; you never need it.
5. Setup ends with a "Next" list: one line per app saying it's open and ready, needs a restart, needs opening, or needs installing (with a link). Tell the student each line as written. If you're running inside Claude Desktop, they need to quit it; Am I Cooked then reopens it with everything set up.
6. For Gemini, run `amicooked doctor --live` after school login to verify actual school access without exposing grades. Then verify the host itself:
   - Gemini desktop on Mac: setup starts a dedicated authenticated loopback MCP service automatically. It requires no public server or broader Gemini file permissions. Direct stdio executables can be rejected by the native sandbox with exit 126; do not suggest chmod as a universal fix. After setup, quit with Cmd+Q and reopen, start a new Task, mention Am I Cooked with @ if needed, and call `am_i_cooked`. Do not quit the app from an agent running inside it. Respect Gemini's connection, network and file-access approvals. The Mac adapter uses `~/.gemini/config/mcp_config.json`; The standalone Gemini Windows app is outside this integration.
   - Antigravity CLI: start a new session, check `/mcp`, and call `am_i_cooked` through normal approvals. On Mac it shares the Gemini app's connection. On Windows install Antigravity CLI first, then use the same Am I Cooked setup command. The CLI starts the MCP server directly. The separate legacy `gemini` CLI has no dedicated adapter here; individual Google sign-in was retired (https://github.com/google-gemini/gemini-cli/discussions/28017). Other eligible MCP clients can use the generic stdio setup below. Do not ask an individual user to retry retired sign-in or buy API credits to make this adapter work.
   - A protocol check is not proof the current Gemini session has loaded the server or the account can use it. If a tool cannot be discovered after reload, report that instead of declaring success. Never fall back to configuring Claude or ChatGPT unless requested.
   - The native app does not need the setup guide saved as a skill: MCP supplies usage guidance. Do not bypass a skill scanner rejection. Both tested hosts receive usage instructions through MCP and optional guides through `get_feature_guide`.
   - If the agent's home is a sandbox such as `.gemini/users/...`, do not pretend its install/config is in the Mac user's home. Report the exact paths from setup/status and use the user's host Terminal for setup when necessary; never bypass the sandbox.
7. If something fails, run `amicooked status --json` and the Gemini doctor command. Only report checks that actually passed.


## Other local AI clients

Any compatible local MCP client can launch `amicooked mcp` over stdio. For a client with a skill folder, use `amicooked setup --clients none --skill-dir "/path/to/client/skills/amicooked" --school <school>`. This installs all references and remembers the destination for updates; configure the MCP launch command printed by setup in that client. MCP-only clients can retrieve the same bundled guides with `get_feature_guide`. Do not claim automatic client configuration or scheduling support where it has not been provided.


Automatic patch updates are on after setup for installed copies. See [updates.md](updates.md) for status and how to turn them off.
