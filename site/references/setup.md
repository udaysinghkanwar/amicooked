## Setting it up (for agents)

**First, check that you can run commands on the student's computer.** Setup installs a program there, so it only works from an agent with a terminal, like Claude Code, Codex or the ChatGPT desktop app. If you're on a website (chatgpt.com, claude.ai, gemini.google.com), in a phone app, or in a chat with no command tool, don't try. Tell the student instead:

- Get an app that can do it: Claude Desktop (https://claude.ai/download) or the ChatGPT app (https://chatgpt.com/download), then paste the same request there. Or install it themselves by pasting this into Terminal (Mac): `curl -fsSL https://amicooked-mcp.vercel.app/install.sh | sh`, or this into PowerShell (Windows): `irm https://amicooked-mcp.vercel.app/install.ps1 | iex`.
- Either way, it ends by opening their AI app, ready to ask "am I cooked?".

If you can run commands:

1. Ask the student which school they go to and whether they want a weekly update skill. Reuse answers already given. Presets: mcmaster, waterloo, western, queens, guelph, laurier, tmu, uottawa, carleton, brock, windsor, laurentian, lakehead. Any other Brightspace school works with the URL they log in through.
2. Install it:
   - macOS / Linux: `curl -fsSL https://amicooked-mcp.vercel.app/install.sh | sh -s -- --no-setup`
   - Windows (PowerShell): `$env:AMICOOKED_NO_SETUP=1; irm https://amicooked-mcp.vercel.app/install.ps1 | iex`
   - With Node.js installed, `npx -y amicooked@0` works in place of `amicooked` below.
3. Run setup with flags, and a long command timeout (at least 5 minutes), because the student signs in through a browser window that opens:
   `amicooked setup --school mcmaster --clients desktop,code --weekly-updates`
   Use `--no-weekly-updates` instead if they decline. Opting in installs an update skill; the AI host must create the actual scheduled task using [updates.md](updates.md).
   Use `--school https://...` for schools without a preset. Add `chatgpt-desktop` to `--clients` if they use the ChatGPT desktop app, then tell them to restart it. ChatGPT and Claude on the web or on phones aren't supported.
4. Tell the student to sign in to their school in the browser window. Never ask for their password; you never need it.
5. Setup ends with a "Next" list: one line per app saying it's open and ready, needs a restart, needs opening, or needs installing (with a link). Tell the student each line as written. If you're running inside Claude Desktop, they need to quit it; Am I Cooked then reopens it with everything set up.
6. If they opted into weekly updates, read [updates.md](updates.md) and create/reuse the recurring task only if the host supports local scheduled commands. Otherwise give the manual update command.
7. If something fails, run `amicooked status` and read what it says.


## Other local AI clients

Any compatible local MCP client can launch `amicooked mcp` over stdio. For a client with a skill folder, use `amicooked setup --clients none --skill-dir "/path/to/client/skills/amicooked" --school <school>` plus the weekly-update preference. This installs all references and remembers the destination for updates; configure the MCP launch command printed by setup in that client. MCP-only clients can retrieve the same bundled guides with `get_feature_guide`. Do not claim automatic client configuration or scheduling support where it has not been provided.
