# Gemini support

Choose the client you actually use. The native Gemini Mac app and Gemini CLI do not share their MCP settings. This adapter configures a local server; it does not expose Brightspace through a tunnel or hosted endpoint.

## Native Gemini Mac app

Install the current [Gemini Mac app](https://gemini.google/desktop/), then run:

```sh
curl -fsSL https://amicooked-mcp.vercel.app/install.sh | sh -s -- --clients gemini-desktop
```

Already installed:

```sh
amicooked setup --school mcmaster --clients gemini-desktop
```

`gemini` is an alias for `gemini-desktop`. Setup opens the school login if needed, adds the installed executable to Gemini's local MCP configuration, and automatically verifies initialization, usage instructions and nine read-only tools. It prints the exact configuration path. No JSON editing or skill upload is required.

Quit Gemini with Cmd+Q and reopen it so it loads the configuration. Start a new Task, mention Am I Cooked with `@` if needed, and ask **am I cooked?** Approve Gemini's normal connection/network/file prompts when shown. Setup does not silently change its sandbox or approval settings. A successfully tested server does not mean an already open Gemini session has reloaded it.

The native adapter currently targets macOS. It uses `~/.gemini/config/mcp_config.json`, matching the installed Gemini app's bundled `agy mcp` helper and native registry. This native configuration route was observed in app version 1.147.5.1526; Google does not currently document it as a stable external installation API. Native Free-account tool execution and scanner behavior require acceptance testing on the student's app version. Windows native setup is not implemented.

## Gemini CLI

```sh
curl -fsSL https://amicooked-mcp.vercel.app/install.sh | sh -s -- --clients gemini-cli
```

Or, with Node.js 22+:

```sh
npx -y amicooked@0 setup --school mcmaster --clients gemini-cli
npx -y @google/gemini-cli
```

For Windows PowerShell:

```powershell
$env:AMICOOKED_CLIENTS="gemini-cli"; $env:AMICOOKED_SCHOOL="mcmaster"; irm https://amicooked-mcp.vercel.app/install.ps1 | iex
```

Setup registers MCP even if Gemini CLI has not been installed yet. Start it with `npx` as above, or follow [Google's installation guide](https://geminicli.com/docs/get-started/installation/). Choose **Sign in with Google** for the personal-account free tier; no Gemini API key is required for that route. Quotas and eligibility still apply. Existing sessions can run `/mcp reload` and `/skills reload`; starting a new session also loads the settings.

Gemini CLI blocks MCP in untrusted folders, including user-scoped servers. Respond to its folder-trust prompt for a folder you trust, then check `/mcp`. Organization policy, project overrides, a disabled server or an overriding skill can also block the connection. Setup preserves these settings and never enables YOLO, disables folder trust, or sets server-wide trust.

The CLI adapter merges `mcpServers.amicooked` into `~/.gemini/settings.json` (or `$GEMINI_CLI_HOME/settings.json`), preserving comments and unrelated settings. It installs a usage-only skill in the corresponding `skills/amicooked/SKILL.md`. That skill contains course-tool guidance, not shell installer commands. Native Gemini uses the MCP instructions; it does not need this CLI skill.

## Agent setup and verification

Use the [setup skill](../skill/SKILL.md), with `--clients gemini-desktop` for the native Mac app or `--clients gemini-cli` for CLI. The installer also accepts `--school`, `--yes`, and other setup flags on macOS/Linux. `AMICOOKED_CLIENTS` and `AMICOOKED_SCHOOL` work with both installers. An explicit target prevents configuring unrelated Claude/ChatGPT apps.

Agents should finish the supported registration and diagnostics, then relay the exact remaining Google/school approval or reload step. They must not claim a tool is in their own session until it is discovered and used there. If running from Gemini itself, do not terminate that app to reload it.

```sh
amicooked status --json
amicooked doctor --clients gemini-desktop
amicooked doctor --clients gemini-desktop --live
# For CLI, replace gemini-desktop with gemini-cli.
```

`doctor` launches the configured executable, checks the MCP handshake, server instructions, and all nine read-only tools, then closes the subprocess. `--live` additionally calls `get_my_courses` using the existing school session. It reports success without printing course names or grades and returns nonzero on failure. It does not make a Gemini model request or certify the host's reload, trust, account or tool-use behavior.

A Gemini agent can have a separate home such as `.gemini/users/...`. Files created there are not automatically the Mac user's files. Check the exact paths printed by setup/status. If the sandbox cannot register a host configuration or complete browser login, run the command in the Mac user's Terminal; do not bypass sandbox restrictions or assume another app's configuration was changed. Likewise, respect any skill scanner rejection; do not disguise an installer guide to get it accepted.

`amicooked uninstall` removes Am I Cooked from both Gemini configs while preserving other servers. Original config backups use `.amicooked.bak`. Locally edited CLI skills are retained on uninstall. Rerunning setup preserves existing server approval/disabled settings; if the server was deliberately disabled, re-enable it in the host before retrying.

## Before release and acceptance testing

These commands require a release containing this change. The public installer and `amicooked@0` continue using the currently published release until maintainers release it. To test this PR without publishing:

```sh
npm ci
npm run build
node dist/cli.js setup --school mcmaster --clients gemini-desktop
node dist/cli.js doctor --clients gemini-desktop --live
```

Run those from the checked-out PR folder in your own Terminal. The generated config references that checkout, so keep it in place during testing. After a release, rerun normal setup to point Gemini at the installed binary.

For a Free-account native test: restart Gemini, start a new Task, verify Am I Cooked is discoverable, ask for a course overview, and inspect that `am_i_cooked` actually ran. Then ask about one announcement and a downloaded course file. Record app version, account tier, approval prompts and errors; avoid including private course data in public reports. This is separate from automated registration/protocol verification.

## Reproducing automated checks

```sh
npm run build
npm test
npm run test:gemini
```

The subprocess smoke test uses disposable HOME, USERPROFILE, GEMINI_CLI_HOME and AMICOOKED_HOME directories. It checks setup, repeat setup, actual stdio discovery, doctor, removal, malformed settings and failure exit codes. The existing CI matrix runs it through `npm test` on macOS, Windows and Linux.

Optionally set `GEMINI_TEST_COMMAND` to an installed `gemini` executable and/or `GEMINI_DESKTOP_TEST_HELPER` to the Mac app's `Contents/Helpers/agy`. These extend the smoke test to each real client's config reader. The CLI test checks untrusted-folder suppression and then trusts only its disposable fixture folder for discovery. No real user trust/config changes, Google login, model calls or school requests occur in these smoke tests.

Research and test evidence: [Gemini integration investigation](research/gemini-support-2026-11-20.md).
