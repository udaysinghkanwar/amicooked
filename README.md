# Am I Cooked

Ask your AI if you're cooked. Am I Cooked connects Claude and ChatGPT to your D2L Brightspace courses (Avenue to Learn, LEARN, onQ, OWL Brightspace, CourseLink and others) so they can read your grades, deadlines, announcements and course files, and tell you straight.

It runs on your own computer. You sign in to your school in a normal browser window; your password never touches anything else.

## Install

macOS / Linux:

```sh
curl -fsSL https://amicooked.app/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://amicooked.app/install.ps1 | iex
```

With Node.js 18+: `npx -y amicooked@0 setup`

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

Every tool is read-only. Course tools take a code like `"3BB4"`.

## Schools

Presets for McMaster, Waterloo, Western, Queen's, Guelph, Laurier, TMU, uOttawa, Carleton, Brock, Windsor, Laurentian and Lakehead. Any other Brightspace school works with the URL you log in through. Login is tested at McMaster; other schools should work and we'd love to hear if they don't.

## ChatGPT

`amicooked setup --clients chatgpt` gives your computer a private, permanent HTTPS address and runs Am I Cooked in the background. Add it in ChatGPT under Settings → Apps & Connectors (Developer mode), and enter the pairing code from `amicooked pair`. ChatGPT can reach it while your computer is on and awake. Requests travel through Cloudflare's network to your computer; nothing is stored on our servers.

## Commands

```
amicooked setup      pick your school, sign in, connect apps
amicooked login      sign in again
amicooked pair       new ChatGPT pairing code
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

`skill/SKILL.md` is the single source for the agent skill; `npm run sync:skill` copies it (and `install/`) into `src/skill.ts` and `site/`.

## Not affiliated

Am I Cooked is an independent project. It isn't affiliated with or endorsed by D2L Corporation or any university. Brightspace is a trademark of D2L Corporation. It only reads your own data; check your school's policies before using it.

## Credits

Built on work by [Hamza Ammar](https://github.com/hamzakammar) ([mcp-workspace](https://github.com/hamzakammar/mcp-workspace)), [Bence Redmond](https://github.com/General-Mudkip) ([d2l-mcp-server](https://github.com/General-Mudkip/d2l-mcp-server)) and alanxue1. MIT licensed.
