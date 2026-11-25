# Setup and client verification

Setup runs on the student's computer. If the current chat cannot run local commands, give the student the installer for their OS to run in Terminal or PowerShell. The installer asks for their school and which AI apps to connect.

| Platform | Installer |
|---|---|
| macOS or Linux | `curl -fsSL https://amicooked-mcp.vercel.app/install.sh \| sh` |
| Windows (PowerShell) | `irm https://amicooked-mcp.vercel.app/install.ps1 \| iex` |
| Node.js 22+ | `npx -y amicooked@0 setup` |

If you can run commands locally:

1. Ask which school and AI app to connect if the student hasn't said. Ask whether they want to install the optional lecture-video tools now (roughly 1–2 GB) or wait until they request a video. Any D2L Brightspace school works; use its login URL when there is no preset.
2. For an automated setup, install without opening the picker. On macOS or Linux, append `-s -- --no-setup` to the shell command above. On Windows, set `$env:AMICOOKED_NO_SETUP=1` before running the installer. With Node.js, use `npx -y amicooked@0` in place of `amicooked`.
3. Run `amicooked setup --school mcmaster --clients <app>` with the real school and app, and allow at least five minutes for browser sign-in. Choose only the apps the student requested. Add `--with-video-deps` when the student opted in.

   | App | Value for `--clients` |
   |---|---|
   | Claude Desktop | `desktop` |
   | Claude Code | `code` |
   | ChatGPT desktop or Codex | `chatgpt-desktop` |
   | Gemini app on Mac or Antigravity CLI on Windows | `gemini` |

4. Have the student sign in on their school's page. Never ask for their password.
5. Relay the Next steps printed by setup. When the selected app is ready, start a chat or session there and ask “am I cooked?” If an app asks for connection approval, use its normal prompts.

Interactive setup also offers the video tools when they need preparation. The lecture-video guide is installed either way. The student can rerun setup later or let their AI prepare the tools when they request a video.

For troubleshooting, run `amicooked status`. For Gemini, `amicooked doctor --live` checks school access. If running inside a Gemini sandbox home such as `.gemini/users/…`, have the student run the regular installer from their Mac Terminal. Windows users need [Antigravity CLI](https://antigravity.google/docs/cli-getting-started). The standalone Windows Gemini app, legacy Gemini CLI, and web or phone chats are outside this setup flow.

## Other local AI clients

Any compatible local MCP client can launch `amicooked mcp` over stdio. For a client with a skill folder, use `amicooked setup --clients none --skill-dir "/path/to/client/skills/amicooked" --school <school>`. This installs all references and remembers the destination for updates; configure the MCP launch command printed by setup in that client. MCP-only clients can retrieve the same bundled guides with `get_feature_guide`. Do not claim automatic client configuration or scheduling support where it has not been provided.


Automatic patch updates are on after setup for installed copies. See [updates.md](updates.md) for status and how to turn them off.
