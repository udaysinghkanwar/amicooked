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
- "Make a chill study video on this lecture. I know the basics and have 10 minutes."

## Lecture videos

The Am I Cooked skill can guide a capable local agent through making a narrated, animated lesson from selected course material. It first asks about your goal, prior knowledge, time budget and mode: **cramming**, **fully cooked** (from the foundations), **chill**, or **bird's-eye**. Shorter modes reduce scope rather than skip necessary reasoning.

Video creation is optional and requires local command/file access, a renderer and narration tools in addition to the Brightspace connection. The main skill loads [the detailed workflow](skill/references/lecture-videos.md) only for video requests. Setup installs that reference alongside the skill; MCP-only clients can retrieve the same guide with `get_lecture_video_guide`. The guide provides instructions, not a rendering service. See [setup, usage and quality checks](docs/lecture-videos.md).

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
| `get_lecture_video_guide` | Load the optional lecture-video workflow and study modes |

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
amicooked uninstall  disconnect apps (--purge deletes your login and settings)
```

Your settings and login live in `~/.amicooked`; downloaded files go to `~/Downloads/amicooked`.

## Development

```sh
npm install
npm test
npm run build        # TypeScript to dist/
npm run build:bin    # standalone binaries in build/ (uses Bun)
node dist/cli.js setup
```

`skill/SKILL.md` is the skill entry point; `skill/references/lecture-videos.md` holds the optional video workflow. `npm run sync:skill` embeds them separately in `src/skill.ts` and copies them (and `install/`) into `site/`. The npm package includes `skill/`, and standalone binaries carry both files for setup and on-demand guide retrieval.

## Not affiliated

Am I Cooked is an independent project. It isn't affiliated with or endorsed by D2L Corporation or any university. Brightspace is a trademark of D2L Corporation. It only reads your own data; check your school's policies before using it.

## Credits

Built on work by [Hamza Ammar](https://github.com/hamzakammar) ([mcp-workspace](https://github.com/hamzakammar/mcp-workspace)), [Bence Redmond](https://github.com/General-Mudkip) ([d2l-mcp-server](https://github.com/General-Mudkip/d2l-mcp-server)) and alanxue1. MIT licensed.
