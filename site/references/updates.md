# Updates and features

- Run `amicooked features` to list shipped features and their requirements; `amicooked features <id>` reads a guide. These commands do not install optional dependencies or connect accounts.
- Run `amicooked update --check` to check the latest stable release without changing anything. Run `amicooked update` to install it and refresh installed skills, then summarize its release notes. `--json` is available for both commands. Updating does not repeat school login or setup.
- If you set up Am I Cooked with `npx`, use `npx -y amicooked@0 update` instead. Use `amicooked update` for the regular installer or a global npm install.
- App and skill references ship together. Use the release package, not loose files from GitHub main. Existing changed skill files are saved under each skill folder's `.backups/`; keep personal instructions in a separate file. Restart/reload the AI app after updates.
- Native binaries update from GitHub releases; npm installations use npm. A source checkout uses `git pull --ff-only`, `npm ci` and `npm run build`; the update command explains this rather than modifying a developer's checkout.

App upgrades also prepare the matching lecture-video tools unless setup opted out. Existing components are reused. If a download or test fails, course tools remain available and a previous compatible video runtime can still be used. Run `amicooked video status` or `amicooked video prepare` to check or retry.

## Automatic patch updates

Automatic patch updates are enabled after setup for installed copies. View `amicooked auto-update status --json`, turn them off with `amicooked auto-update disable`, or turn them back on with `amicooked auto-update enable`. Uninstall suspends checks until setup runs again. Setup and reinstall preserve an explicit opt-out.

An installed app can check in the background on MCP startup or when an Am I Cooked tool is used, at most once per 72 hours across both paths. For a workflow using only local files, the skill can ask the installed CLI to run `amicooked auto-update check-if-due` (use the `npx -y amicooked@0` prefix if setup used npx). The CLI honors the same preference and interval, so the skill does not need to track dates.

The updater applies stable patches within the installed major/minor (for example 0.1.7 to 0.1.8), verifies native checksums and retains the previous executable. Use `amicooked update` for a manual upgrade. Checks are detached, log locally, and need no scheduler. Offline use remains available. Source checkouts stay under Git control.

The already running MCP process keeps its loaded version. Restart the Am I Cooked server to load an installed update. For an AI app that launches its own server, this means reloading the app or starting a new session. Status reports the last attempt and local log location; the log records release notes, failures and restart instructions. A successful background install is not proof the current session reloaded. Optional feature dependencies and external accounts remain separately enabled.
