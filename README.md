# Am I Cooked

Ask your AI if you're cooked. Am I Cooked connects Claude and ChatGPT to your D2L Brightspace courses (Avenue to Learn, LEARN, onQ, OWL Brightspace, CourseLink and others) so they can read your grades, deadlines, announcements and course files, and tell you straight.

It runs on your own computer. You sign in to your school in a normal browser window; your password never touches anything else.

## Install

macOS / Linux:

```sh
curl -fsSL https://amicooked-mcp.vercel.app/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://amicooked-mcp.vercel.app/install.ps1 | iex
```

With Node.js 22+: `npx -y amicooked@0 setup`

Setup asks for your school, opens a browser window to sign in, and connects the AI apps you use. Then ask: **am I cooked?**

## What you can ask

- "Am I cooked this week?"
- "What's my grade in 3BB4 so far?"
- "Did I submit lab 4?"
- "Summarize the week 7 slides."
- "Anything new from my profs?"
- "What's on the midterm?"

## Tools

| Tool | What it does |
|---|---|
| `am_i_cooked` | Every current course at once: grade so far, what's due, overdue work, new announcements, and a heat score |
| `get_my_courses` | Your courses |
| `get_my_grades` | Grade items and feedback for a course |
| `get_upcoming_due_dates` | Calendar deadlines, for one course or all of them |
| `get_announcements` | Instructor announcements |
| `get_assignments` | Assignments with due dates and whether you submitted |
| `get_course_content` | Modules, lectures and files |
| `download_file` | Save a course file and read its text (PDF, Word, PowerPoint) |
| `read_file` | Read a file you already downloaded |
| `get_feature_guide` | List shipped features or read a bundled guide |

Every tool is read-only. Course tools take a code like `"3BB4"`.

## Schools

Presets for McMaster, Waterloo, Western, Queen's, Guelph, Laurier, TMU, uOttawa, Carleton, Brock, Windsor, Laurentian and Lakehead. Any other Brightspace school works with the URL you log in through. Login is tested at McMaster; other schools should work and we'd love to hear if they don't.

## ChatGPT

`amicooked setup --clients chatgpt-desktop` connects the ChatGPT desktop app the same way as Claude Desktop: the app starts Am I Cooked on your computer, with no tunnel or extra account. Restart the app afterwards. It works with the ChatGPT desktop app that's built on Codex (and the Codex CLI), which reads `~/.codex/config.toml`.

ChatGPT on the web and on phones can't start programs on your computer, so they aren't supported yet. Neither is Claude on the web.

## Commands

```
amicooked setup      pick your school, sign in, connect apps
amicooked login      sign in again
amicooked status     what's set up
amicooked update     update app and skills (--check to only check)
amicooked features   list features; add an id to read a guide
amicooked uninstall  disconnect apps (--purge deletes your login and settings)
```

Your settings and login live in `~/.amicooked`; downloaded files go to `~/Downloads/amicooked`.

The first time setup finishes on a computer, it sends one anonymous count: your school's preset name (or "custom") and your OS. Nothing from Brightspace, no IP or ID is stored. Set `AMICOOKED_NO_TELEMETRY=1` or `DO_NOT_TRACK=1` to turn it off.

## Updates

Run `amicooked update` to install the latest stable release and refresh the full skill folder. Use `amicooked update --check` to check first. Both commands support `--json`. The updater uses GitHub release binaries or npm to match your installation, keeps your school login and settings, and reports release notes and any restart needed. Changed skill files are saved under that skill folder's `.backups/`; put personal instructions in a separate file so they stay in place.

Setup asks whether you want a weekly update skill. If you opt in (`--weekly-updates` for agent setup), it installs the skill and asks your AI app to create the recurring task. The AI host must support scheduling **with local command access**. The CLI does not create a background service or claim a task was scheduled. If the host cannot schedule local commands, run updates manually. Read `amicooked features updates` for the task instructions and this installation's executable/arguments. Change or remove the schedule in the app that created it; `--no-weekly-updates` removes the local update skill but cannot remove a host-owned task.

For other local AI clients, configure a stdio MCP server running `amicooked mcp`. `amicooked setup --clients none --skill-dir "/path/to/client/skills/amicooked" --school <school>` installs the full skill folder and remembers it for updates. MCP-only clients can read the same references using `get_feature_guide`. Optional feature dependencies and account connections are only set up when requested. The updater itself has no AI-provider dependency.

## Development

```sh
npm install
npm test
npm run build        # TypeScript to dist/
npm run build:bin    # standalone binaries in build/ (uses Bun)
node dist/cli.js setup
npm run stats        # installs, npm downloads, setups, repo traffic
```

`skill/` is the single source for the agent skill and its on-demand references; `npm run sync:skill` embeds the full folder in `src/skill.ts` and copies it (and `install/`) into `site/`. npm packages and standalone binaries carry the same files, so installs do not fetch loose skill files from `main`. To add a feature, add its reference and an entry in `src/features.ts`, then sync, test and release them together.

For source checkouts, update your branch with `git pull --ff-only`, `npm ci` and `npm run build`, then run `node dist/cli.js update` to refresh installed skills. The updater does not modify developer checkouts automatically.

## Not affiliated

Am I Cooked is an independent project. It isn't affiliated with or endorsed by D2L Corporation or any university. Brightspace is a trademark of D2L Corporation. It only reads your own data; check your school's policies before using it.

## Credits

Built on work by [Hamza Ammar](https://github.com/hamzakammar) ([mcp-workspace](https://github.com/hamzakammar/mcp-workspace)), [Bence Redmond](https://github.com/General-Mudkip) ([d2l-mcp-server](https://github.com/General-Mudkip/d2l-mcp-server)) and alanxue1. MIT licensed.
