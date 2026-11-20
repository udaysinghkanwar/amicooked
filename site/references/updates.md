# Updates and features

- Run `amicooked features` to list shipped features and their requirements; `amicooked features <id>` reads a guide. These commands do not install optional dependencies or connect accounts.
- Run `amicooked update --check` to check the latest stable release without changing anything. Run `amicooked update` to install it and refresh installed skills, then summarize its release notes. `--json` is available for both commands. Updating does not repeat school login or setup.
- App and skill references ship together. Use the release package, not loose files from GitHub main. Existing changed skill files are saved under each skill folder's `.backups/`; keep personal instructions in a separate file. Restart/reload the AI app after updates.
- Native binaries update from GitHub releases; npm installations use npm. A source checkout uses `git pull --ff-only`, `npm ci` and `npm run build`; the update command explains this rather than modifying a developer's checkout.

## Optional weekly update routine

During setup, ask whether the student wants weekly updates. In a noninteractive agent setup, ask in the conversation and pass `--weekly-updates` or `--no-weekly-updates` to setup. `--yes` alone is not consent. Reuse an existing answer.

If they opt in, create one recurring task named **Am I Cooked weekly updates** using the host AI app's supported scheduling tool. Use the student's timezone and preferred time; if unspecified, offer Monday at 9 AM. The task must have local command access on the student's computer. A web-only scheduler cannot run this local updater.

Task instructions:

> Update Am I Cooked on this computer using its update command. Read the command result, tell me what changed and which new features I can use, and mention any restart needed. If the update fails, report the error and next step without claiming success. Do not install optional feature dependencies or connect new accounts. If nothing changed, stay quiet unless there is an actionable problem.

Use the executable, arguments and environment returned by `amicooked features updates --json` (or `get_feature_guide` with `feature: "updates"`); this identifies the current install even when `amicooked` is not on the scheduler's PATH. Keep that launch information in the task. Before creating a task, look for one with that name and update/reuse it instead of duplicating it. Only report scheduling success after the scheduling tool confirms it.

If scheduling or local execution is unavailable, explain that limitation and give the manual command. Do not claim a reminder or a skill file will execute updates. Students can change, pause or delete the recurring task in the AI app that created it. `setup --no-weekly-updates` removes the local update skill and preference; ask the host to remove its existing scheduled task too. Uninstalling Am I Cooked does not delete tasks owned by another app.
