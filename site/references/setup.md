# Setup and client verification

Setup runs on the student's computer. Start with the normal Mac/Linux or Windows installer below, unchanged. Use the student's Mac, Windows or Linux OS when already known from the conversation or reliable information about their own computer; do not ask again. Ask only when it is unknown. Begin installation instructions with “Since you’re on [Mac/Windows/Linux], …”. Never ask for their school password, cookies or tokens.

If this chat cannot run commands on the student's own computer, do not install into a hosted sandbox, container or temporary AI environment. Do not infer the student's OS from that environment. Use their known OS without asking again, or ask if unknown. Say “Since you’re on [OS], you can still install it yourself:” and give only the matching manual instructions:

1. Explain how to open Terminal on Mac (⌘ Space, type Terminal, press Return) or PowerShell on Windows (Windows key, type PowerShell, press Enter). On Linux, use their terminal.
2. Put the exact matching installer from the table below in its own copyable fenced code block, not just a guide link or a reference to “the command above.” Tell them to paste it into that window and press Enter, then choose their school and AI app and sign in on the school's page.
3. Follow setup's printed next step, reopen the selected AI app if requested, and ask “am I cooked?” there. Use the current chat only if it is the connected app.

Do not stop at explaining that local access is unavailable. A coding AI with local access, such as Claude Code or Codex, may be mentioned only after the manual steps. Do not add installer flags, environment overrides or custom commands for a routine install. If the normal installer fails, use its actual error to troubleshoot and offer npm only when Node.js 22+ is available. Do not claim installation is complete from instructions alone or a sandbox install; verify that the connected app can read the student's courses.

| Platform | Installer |
|---|---|
| macOS or Linux | `curl -fsSL https://amicooked-mcp.vercel.app/install.sh \| sh` |
| Windows (PowerShell) | `irm https://amicooked-mcp.vercel.app/install.ps1 \| iex` |
| Node.js 22+ | `npx -y amicooked@0 setup` |

If you can run commands on the student’s computer, run the normal installer and guide them through its school/app prompts and browser sign-in. Use the advanced flow below only when the student explicitly requests unattended configuration and execution is on their own computer. An unavailable interactive picker in a hosted chat is a reason to give the manual instructions above, not to use this advanced flow.

## Advanced unattended configuration

1. Ask which school and AI app to connect if the student hasn't said. For a Brightspace school without a preset, use `--school "Full School Name"` to search D2L's public directory, or `--school https://...` with the course portal URL. If several schools match, ask which one the student uses and retry with its full name or listed URL.
2. For an automated setup, install without opening the picker. On macOS or Linux, append `-s -- --no-setup` to the shell command above. On Windows, set `$env:AMICOOKED_NO_SETUP=1` before running the installer. With Node.js, use `npx -y amicooked@0` in place of `amicooked`.
3. Run `amicooked setup --school mcmaster --clients <app>` with the real school and app, and allow at least five minutes for browser sign-in. Choose only the apps the student requested.

   | App | Value for `--clients` |
   |---|---|
   | Claude Desktop | `desktop` |
   | Claude Code | `code` |
   | ChatGPT desktop in Codex mode or Codex CLI | `chatgpt-desktop` |
   | Gemini app on Mac or Antigravity CLI on Windows | `gemini` |

   Custom URLs can be the Brightspace host, a deep course URL, or a stable portal link that redirects or links to Brightspace. If discovery cannot see the LMS behind a portal's sign-in or JavaScript, have the student sign in in their browser and paste the final course homepage URL containing `/d2l/`. Do not ask for cookies, tokens or temporary Microsoft/SAML callback links.

4. Have the student sign in on their school's page. Never ask for their password.
5. Relay the Next steps printed by setup. When the selected app is ready, start a chat or session there and ask “am I cooked?” If an app asks for connection approval, use its normal prompts.

For ChatGPT desktop, switch to **Codex** and choose **This computer**. This setup configures local Codex MCP. ChatGPT Work uses [separate workspace settings](https://learn.chatgpt.com/docs/developer-settings#developer-settings).

Setup downloads and verifies the lecture-video tools automatically. If the student asks to skip automatic video downloads, add `--skip-video-deps`. This applies to future updates too. Use `amicooked setup --with-video-deps` to re-enable automatic preparation. The guide is installed either way, and video requests can still prepare the tools on demand.

## Troubleshooting

Capture the exact error and run `amicooked --version` and `amicooked status` when local commands are available. If setup used npx, use `npx -y amicooked@0` in place of `amicooked`.

Use the [Am I Cooked GitHub repository](https://github.com/udaysinghkanwar/amicooked) to trace errors and find supported fixes. Read the source at the tag for the installed version (for example, `v0.1.14`). If you find a bug, prepare minimal steps to reproduce it with secrets removed and propose a patch for review.

For Gemini, `amicooked doctor --live` checks school access. If running inside a Gemini sandbox home such as `.gemini/users/…`, have the student run the regular installer from their Mac Terminal. Windows users need [Antigravity CLI](https://antigravity.google/docs/cli-getting-started). The standalone Windows Gemini app, legacy Gemini CLI, and web or phone chats are outside this setup flow.

## Other local AI clients

Any compatible local MCP client can launch `amicooked mcp` over stdio. For a client with a skill folder, use `amicooked setup --clients none --skill-dir "/path/to/client/skills/amicooked" --school <school>`. This installs all references and remembers the destination for updates; configure the MCP launch command printed by setup in that client. MCP-only clients can retrieve the same bundled guides with `get_feature_guide`. Do not claim automatic client configuration or scheduling support where it has not been provided.


Automatic patch updates are on after setup for installed copies. See [updates.md](updates.md) for status and how to turn them off.
