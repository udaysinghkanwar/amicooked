# Am I Cooked

Ask your AI if you're cooked. Am I Cooked connects supported local Claude, ChatGPT and Gemini clients to your D2L Brightspace courses (Avenue to Learn, LEARN, onQ, OWL Brightspace, CourseLink and others) so they can read your grades, deadlines, announcements and course files, and tell you straight.

It runs on your own computer. You sign in to your school in a normal browser window; your password never touches anything else.

## Install

1. Open **Terminal** on Mac (press ⌘ Space and search Terminal), or **PowerShell** on Windows (search in Start).
2. Paste the matching command below and press Enter.
3. Choose your school and AI app. Sign in only on your school’s page. Follow the printed next step, reopen the connected AI app if asked, then ask **am I cooked?** there.

macOS / Linux:

```sh
curl -fsSL https://amicooked-mcp.vercel.app/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://amicooked-mcp.vercel.app/install.ps1 | iex
```

If your current AI chat cannot run local commands, run the installer yourself using these steps. A coding AI with local access, such as Claude Code or Codex, is optional. An ordinary web or phone chat does not install software on your computer.

If the normal installer fails and you already have Node.js 22+, use `npx -y amicooked@0 setup`. Include the original error when asking for help.

Gemini works with the Mac app and its bundled CLI, or with [Antigravity CLI](https://antigravity.google/docs/cli-getting-started) on Windows. All supported apps use the same installer. See the [setup guide](skill/references/setup.md) for commands and troubleshooting.

## What you can ask

- "Am I cooked this week?"
- "What's my grade in 3BB4 so far?"
- "Did I submit lab 4?"
- "Summarize the week 7 slides."
- "Anything new from my profs?"
- "What's on the midterm?"
- "Make a chill study video on this lecture. I know the basics and have 10 minutes."

## Lecture videos

The Am I Cooked skill can guide a capable local agent through making a narrated, animated lesson from selected course material. It first asks about your goal, prior knowledge, time budget and mode: **cramming**, **fully cooked** (from the foundations), **chill**, or **bird's-eye**. Shorter modes reduce scope rather than skip necessary reasoning.

Setup downloads and verifies the managed local renderer, narration model and media tools automatically. Updates reuse installed components and prepare new dependencies when needed. To skip automatic video downloads, run `amicooked setup --skip-video-deps`. You can install the tools later with `amicooked video prepare` or ask your AI to prepare them when you request a video. Replace `amicooked` with `npx -y amicooked@0` in those commands if you installed through npx.

The AI session needs local command and file access and permission to launch the browser and use a loopback server. Run `amicooked video probe` in that session before rendering. The [lecture-video guide](skill/references/lecture-videos.md) covers the full workflow.

Managed lessons automatically use narrated slides if the browser probe or renderer cannot finish. Temporary-file cleanup failures (including Windows folder locks) are returned as warnings and do not replace the probe result or a verified export. Direct video commands report stages on stderr while keeping their final JSON on stdout. `get_video_render` includes the latest stage, scene count when available, and its `updatedAt` timestamp separately from the supervisor heartbeat, so any connected AI client can check useful progress. Locked scratch files may remain at the exact path reported in a cleanup warning; cleanup never scans course folders or stops unrelated processes.

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
| `get_lecture_video_workflow` | Get the video guide, check the installation and locate the local launcher |
| `create_video_lesson`, `write_video_lesson_file` | For chats without a shell: build a slide lesson (SVG slides, narration text) in your `Lessons` folder |
| `start_video_render`, `get_video_render` | Render that lesson to an MP4 on your computer and check on it. Lesson tools write only inside `Lessons` |

Course tools are read-only and take a code like `"3BB4"`.

## Schools

University presets cover McMaster, Waterloo, Western, Queen's, Guelph, Laurier, TMU, uOttawa, Carleton, Brock, Windsor, Laurentian, Lakehead, McGill and the University of Calgary.

School-board presets cover the Toronto District School Board (TDSB) and the Peel District School Board, e.g. `amicooked setup --school tdsb` or `amicooked setup --school "Peel District School Board"`. Other Ontario boards on the provincial Brightspace work through “Somewhere else” by name or portal URL; see the [verified portal list and research sources](docs/research/ontario-school-board-portals-2026-11-26.md). Student sign-in and course access are not yet tested at the boards.

For other schools, choose “Somewhere else” and enter a school name, or run `amicooked setup --school "Dalhousie University"`. Am I Cooked searches the public directory used by [D2L's Login Finder](https://login-finder.d2l.com/) and validates the portal's Brightspace API before opening it. If several schools match, setup asks you to pick one; automated setup lists the matches so you can retry with a full name or URL. You can always paste the URL you log in through if the school isn't listed or the directory is unavailable. School-name searches are sent to D2L. This supports Brightspace schools; it doesn't add Canvas, Moodle or Blackboard support. McMaster sign-in has been tested. Access at other schools depends on their Brightspace and sign-in configuration.

Custom schools do not need a preset: paste the Brightspace hostname, a course/homepage URL, or the school's normal course-portal link. For example, `amicooked setup --school https://mcgill.ca/mycourses`. Discovery checks the public Brightspace versions API, follows HTTPS redirects (including intermediate LMS hosts before SSO), and looks for explicit Brightspace/D2L links on a small number of public pages. If multiple instances are found, choose the one you use. If the portal requires login or JavaScript before exposing its LMS link, sign in in your browser and paste the final course homepage address containing `/d2l/`. Use a reusable portal link, not a temporary Microsoft/SAML authentication-response URL. See [custom portal research and limits](docs/research/custom-portal-discovery-2026-11-26.md).

## ChatGPT and Codex

Choose **ChatGPT desktop (Codex)** in setup or run `amicooked setup --clients chatgpt-desktop`. Restart the app, switch to **Codex**, and start a chat that runs on **This computer**. Setup configures the shared local MCP server for the desktop app and Codex CLI.

ChatGPT Work uses separate workspace configuration. The public installer supports the local Codex connection. See [OpenAI’s developer settings](https://learn.chatgpt.com/docs/developer-settings#developer-settings) for the distinction.

## Commands

```
amicooked setup      pick your school, sign in, connect apps
amicooked login      sign in again
amicooked status     what's set up
amicooked doctor     verify the Gemini connection (--live checks school access)
amicooked update     update app and skills (--check to only check)
amicooked features   list features; add an id to read a guide
amicooked uninstall  disconnect apps (--purge deletes your login and settings)
```

Your settings and login live in `~/.amicooked`; downloaded files go to `~/Downloads/amicooked`.

The first time setup finishes on a computer, it sends one anonymous count: your school's preset name (or "custom") and your OS. Successful manual/automatic version upgrades send an anonymous count with the old/new versions, update mode, native/npm channel and OS/architecture. Checks, unchanged versions and failures do not count. Nothing from Brightspace, no IP or installation ID is stored. Set `AMICOOKED_NO_TELEMETRY=1` or `DO_NOT_TRACK=1` to turn it off.

## Updates

Run `amicooked update` to install the latest stable release and refresh the full skill folder. Use `amicooked update --check` to check first. Both commands support `--json`. The updater uses GitHub release binaries or npm to match your installation, keeps your school login and settings, and reports release notes and any restart needed. Changed skill files are saved under that skill folder's `.backups/`; put personal instructions in a separate file so they stay in place.

After setup, installed copies automatically check for stable patches in the current major/minor when Am I Cooked starts or is used, at most once every three days. The check runs in the background. Run `amicooked auto-update status` for the last attempt and log, or `amicooked auto-update disable` to stop. Reload your AI app after an update. No update runs while the app is unused. This works with installed binaries/npm packages; source checkouts stay under Git control.

For other local AI clients, configure a stdio MCP server running `amicooked mcp`. `amicooked setup --clients none --skill-dir "/path/to/client/skills/amicooked" --school <school>` installs the full skill folder and remembers it for updates. MCP-only clients can read the same references using `get_feature_guide`. Account connections are set up for the apps you select. The updater itself has no AI-provider dependency.


## Development

```sh
npm ci
npm test
npm run build        # TypeScript to dist/
npm run build:bin    # standalone binaries in build/ (uses Bun)
node dist/cli.js setup
npm run stats        # downloads, setups, manual/automatic upgrades, repo traffic
```

`skill/` contains the agent skill and its on-demand references. `npm run sync:skill` updates the skill router from `src/feature-catalog.json`, embeds the full folder in `src/skill.ts`, and copies the skill and installers into `site/`. npm packages and standalone binaries carry the same files, so installs do not fetch loose skill files from `main`. To add a feature, add its reference and an entry in `src/feature-catalog.json`, then sync, test and release them together.

`npm run stats` retains existing counters and adds upgrade totals, manual/automatic counts and version transitions. Counters are best effort, not unique-user counts or proof that a running session reloaded. GitHub checksum downloads include native installers and updaters. CSV upgrade columns are appended, preserving historical rows.

For source checkouts, update your branch with `git pull --ff-only`, `npm ci` and `npm run build`, then run `node dist/cli.js update` to refresh installed skills. The updater does not modify developer checkouts automatically.

## Contribute or request a feature

Am I Cooked is free and open source. [Request a feature or report a bug](https://github.com/udaysinghkanwar/amicooked/issues/new): describe what you want to do, your OS and AI app, and what you expected. For bugs, include steps to reproduce and the exact error, with passwords, cookies, tokens and course data removed. Search existing issues first to avoid duplicates.

To contribute:
1. Fork the repository and create a branch for one focused change.
2. Follow the Development commands above (`npm ci`, `npm test`, `npm run build`). If you edit `skill/` or `install/`, run `npm run sync:skill` and include the generated changes.
3. Open a pull request explaining the problem, the change and how you tested it. Add before/after screenshots for UI changes when useful. Keep student data and credentials out of commits and issue reports.

## Made by students

Made with ♥ by students, for students — [Uday Kanwar](https://ca.linkedin.com/in/uday-kanwar), [Sachin Gupta](https://www.linkedin.com/in/sachin-ved-gupta/) and [Akshay Gupta](https://ca.linkedin.com/in/akshay-m-gupta). Built to make grades, deadlines and studying easier to manage through the AI tools students already use.

## Not affiliated

Am I Cooked is an independent project. It isn't affiliated with or endorsed by D2L Corporation or any university. Brightspace is a trademark of D2L Corporation. It only reads your own Brightspace data; check your school's policies before using it.

## Credits

Built on work by [Hamza Ammar](https://github.com/hamzakammar) ([mcp-workspace](https://github.com/hamzakammar/mcp-workspace)), [Bence Redmond](https://github.com/General-Mudkip) ([d2l-mcp-server](https://github.com/General-Mudkip/d2l-mcp-server)) and alanxue1. MIT licensed.
