# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML, CSS and vanilla JS in `site/`, no framework and no build step. Deployed on Vercel with Root Directory `site`.

## Users

University students, mostly Gen Z and mostly non-technical, at Ontario schools that run D2L Brightspace (launching at McMaster, Waterloo, Western, Queen's, Guelph, Laurier, TMU, Ottawa, Carleton, Brock, Windsor, Laurentian, Lakehead). They already use Claude or ChatGPT and want a straight answer about how their term is going without digging through their LMS.

## Product Purpose

Am I Cooked connects a student's AI (Claude Desktop, Claude Code or ChatGPT) to their school's D2L Brightspace. They ask "am I cooked?" and get a straight answer about grades, deadlines and announcements, plus what to do next. Success for the landing page: the idea lands in 5 seconds and a student is installed in under a minute.

## Positioning

It runs on the student's own laptop and their school login never leaves it. The flagship tool returns a doneness verdict (raw, warming up, toasty, cooked, well done) with the three things to do next. Free and open source (MIT).

## Operating Context

Students install with one command (`curl ... | sh` on macOS and Linux, `irm ... | iex` on Windows, or `npx -y amicooked@0 setup` with Node 22+), pick their school, and sign in on their school's own login page in a real browser window. ChatGPT reaches the laptop through a private tunnel and needs Developer mode plus a pairing code; the laptop must be on and awake. Agents can set it up from `amicooked-mcp.vercel.app/SKILL.md`.

## Capabilities and Constraints

- Nine read-only tools: `am_i_cooked`, `get_my_courses`, `get_my_grades`, `get_upcoming_due_dates`, `get_announcements`, `get_assignments`, `get_course_content`, `download_file`, `read_file`.
- Read-only: it never submits work or changes anything in a course.
- Settings and login live in `~/.amicooked`; downloaded files go to `~/Downloads/amicooked`. `amicooked uninstall` disconnects apps; `--purge` also deletes login and settings.
- Not affiliated with or endorsed by D2L Corporation or any university. Brightspace is a D2L trademark. No school logos.

## Brand Commitments

- Name: "Am I Cooked" (wordmark "am i cooked?", lowercase).
- The heat scale is the brand: raw, warming up, toasty, cooked, well done. Colour only ever means heat.
- Voice: short, plain, confident sentences. Playful, never mean. No em dashes. No "supercharge", "seamless", "next-generation", "world-class". No "Not X. Y." slogans.
- Should feel like a well-made indie tool: not edtech, not a university portal, not an AI template.

## Evidence on Hand

No testimonials, user counts or press yet: do not invent any. Example verdicts and course codes on the site are made up and must read as samples. Login is tested at McMaster only.

## Product Principles

1. Explain it in five seconds, install it in one minute.
2. Show the verdict, don't describe it: the doneness meter is the proof.
3. Trust is earned with specifics: local, read-only, school's own login page, open source.
4. Funny in the copy, serious in the layout.

## Accessibility & Inclusion

WCAG 2.1 AA. Works at 360px wide with no horizontal scroll, 44px tap targets, native controls (range input, details), visible focus, respects reduced motion, content visible without JS.
