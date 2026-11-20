# Gemini support investigation — November 20, 2026

## Decision

Implement two local setup targets: `gemini-desktop` for the native Gemini Mac app (the user's actual client), and `gemini-cli` for the terminal agent. `gemini` aliases the native app. Reuse the existing read-only stdio MCP server and school browser login. Do not add hosted infrastructure, API-key requirements, an unofficial chat wrapper or a hidden model backend.

Native registration can be automated on the observed app version. Public Google documentation is much clearer for the CLI than for the native app, so native compatibility must retain an explicit version/acceptance-test caveat.

## Host distinctions and sources

| Host | Integration and evidence | Consequence |
|---|---|---|
| Native Gemini Mac | Public [Mac help](https://support.google.com/gemini/answer/17011627) and [desktop page](https://gemini.google/desktop/) establish the separate app. Installed app inspection and bundled helper establish a local config reader. | Native adapter; do not write CLI settings and claim native success. |
| Gemini CLI | [MCP configuration](https://geminicli.com/docs/tools/mcp-server/) documents stdio, user scope, env and management commands. | Merge the user config and verify the installed executable. |
| CLI authentication | [Authentication](https://geminicli.com/docs/get-started/authentication/) documents personal Google login and free-tier accounts. [Quotas](https://geminicli.com/docs/resources/quota-and-pricing/) remain separate from MCP support. | No Gemini API key is needed for the Google-login route. Do not claim unlimited/free availability for every account. |
| CLI skills | [Skills](https://geminicli.com/docs/cli/skills/) documents user directories and reload. | Install usage guidance only; MCP already carries server instructions. |
| CLI folder trust | [Trusted folders](https://geminicli.com/docs/cli/trusted-folders/) and MCP docs describe host restrictions. Real CLI 0.70.0 suppressed user servers in an untrusted test folder. | Preserve trust controls and explain reload/trust prompts. |
| Hosted Gemini Apps | [Custom connected apps](https://support.google.com/gemini/answer/17209137) lists its own account, region and history requirements. [Developer guide](https://developers.google.com/connected-apps/mcp/) requires a public HTTPS endpoint. | A separate network/auth/availability project. Local config is not web/mobile registration. |
| Antigravity | Separate Google agent product. Some local paths/helpers overlap. | Do not claim its eligibility, UI or MCP settings are interchangeable with ordinary Gemini chat. |

## Native app evidence

The installed official bundle identifies as `com.google.GeminiMacOS`, version `1.147.5.1526`. Read-only inspection of its executable found `McpServerRegistry`, `loadMcpConfigFile(from:)`, `McpConfigFile`, `McpConfigServerEntry` and `.gemini/config/mcp_config.json`. It also contains local connector UI strings and `Custom local MCP` sandbox/permission controls. This establishes implemented functionality; it does not guarantee feature eligibility on every account.

The app includes `Contents/Helpers/agy`. Its own help reports `mcp add/remove/list/enable/disable`; `mcp add --help` explicitly describes adding or updating an MCP server, environment flags, and stdio arguments.

Executed the bundled helper in a disposable HOME/XDG_CONFIG_HOME with a non-executing probe command. `mcp add` created `.gemini/config/mcp_config.json` under that home and `mcp list` reported the entry. The emitted JSON has root `mcpServers`, per-server `command`, optional `args` and `env`, and `disabled: false`. A second probe verified an environment value and a server argument containing `=`. This is stronger evidence than an AI response suggesting a settings menu, but is still an observed native implementation rather than a public stable-API contract.

UI inspection confirmed the user's native client and a Customize entry. Further UI navigation failed with repeated stale-element errors from the computer-use tool. No completed native Free-account model/tool execution was observed. Do not turn configuration/parser checks into a native end-to-end claim.

## Changes required

1. Detect the actual native application separately from `gemini --version`; explicit target names and alias behavior.
2. Merge only our server into the appropriate config, preserve unrelated fields and host policies, keep an original backup, reject malformed data, and use an absolute durable launch command.
3. Persist AMICOOKED_HOME with the server launch so school session/config access does not silently switch homes.
4. Forward installer setup arguments as exact arguments. Allow client/school environment choices on PowerShell. Propagate setup failures.
5. Initialize the configured subprocess and discover all nine read-only tools, with instructions present. Close it after checking. Add optional live school verification without echoing course data.
6. Expose status/uninstall; install a usage-only CLI skill. Native guidance uses MCP instructions rather than uploading the installer guide.
7. Teach agents to choose the requested host, run diagnostics, respect scanners and sandbox-home boundaries, and verify actual session tool use after reload.

## Verification record

- Build and unit suite, including Gemini config preservation, invalid settings, idempotence, disabled/approval preferences, usage-only skill and explicit host selection.
- Checksum-verified local installer fixture tests for exact forwarding, --no-setup and failure propagation; no release download is required.
- Full compiled CLI smoke test in an isolated home: setup, subprocess handshake, instructions, nine tools, doctor, repeat setup, uninstall, malformed settings and failure codes.
- Real npm Gemini CLI **0.70.0** loaded generated settings. Its first `mcp list` suppressed the server in the untrusted fixture folder. After trusting only that temporary fixture folder, it connected to the configured Am I Cooked subprocess. No Google login or model call.
- Native Gemini's bundled helper loaded the generated desktop configuration in an isolated home. This checks the real helper's parser/registration, not app UI reload or model behavior.
- A separate MCP diagnostic used the existing active school session and successfully called `get_my_courses`; it returned only verification status to the test output. No grades or course names were logged, no model request was made, and no new school login was needed.

## Remaining acceptance evidence

A user-operated Free-account native test must verify restart/loading, eligibility, network/file approvals, discovery and actual `am_i_cooked` execution, plus announcement/file use. CLI Free-account model behavior is also separate from parser/transport testing. CI covers synthetic subprocess tests on macOS/Windows/Linux; the initial local run was on Apple Silicon macOS. Native Windows is intentionally unsupported pending investigation.

The user's earlier native attempt reported a skill scanner rejection and a different agent HOME. Neither is safe to solve by bypassing protections. Avoid requiring the installer guide as a usage skill, surface exact paths, and direct host-level setup through the user's Terminal if the agent sandbox cannot reach the host's configuration. The ideal agent-only flow remains constrained by the host's permissions and reload capabilities.
