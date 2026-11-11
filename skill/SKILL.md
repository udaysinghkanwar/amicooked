---
name: amicooked
description: Use when a student asks about their D2L Brightspace courses, grades, deadlines, assignments, announcements or course files, asks "am I cooked?", or wants to set up Am I Cooked.
---

# Am I Cooked

Am I Cooked connects an AI assistant to a student's D2L Brightspace account (Avenue to Learn, LEARN, onQ, OWL Brightspace, CourseLink, MyLearningSpace and others). It runs on the student's own computer and is read-only.

## Setting it up (for agents)

1. Ask the student which school they go to. Presets: mcmaster, waterloo, western, queens, guelph, laurier, tmu, uottawa, carleton, brock, windsor, laurentian, lakehead. Any other Brightspace school works with the URL they log in through.
2. Install it:
   - macOS / Linux: `curl -fsSL https://amicooked-mcp.vercel.app/install.sh | sh -s -- --no-setup`
   - Windows (PowerShell): `$env:AMICOOKED_NO_SETUP=1; irm https://amicooked-mcp.vercel.app/install.ps1 | iex`
   - With Node.js installed, `npx -y amicooked@0` works in place of `amicooked` below.
3. Run setup with flags, and a long command timeout (at least 5 minutes), because the student signs in through a browser window that opens:
   `amicooked setup --school mcmaster --clients desktop,code`
   Use `--school https://...` for schools without a preset. Add `chatgpt` to `--clients` if they use ChatGPT.
4. Tell the student to sign in to their school in the browser window. Never ask for their password; you never need it.
5. If something fails, run `amicooked status` and read what it says.

<!-- server-instructions -->
## Answering questions

- Start broad questions ("am I cooked?", "what should I work on?", "how am I doing?", "what's due?") with `am_i_cooked`. It covers every current course in one call.
- Other tools take a course code directly, like `course: "3BB4"`. Only call `get_my_courses` when a code is ambiguous or the student asks what they're enrolled in.
- Check `get_announcements` for a course before a final verdict on it; deadlines and exam details often change there.
- To read slides, handouts or assignment PDFs: `get_course_content` to find the file, then `download_file`. Use `read_file` for files already downloaded.
- If a tool says a login window opened, tell the student to sign in there and ask again.

## The verdict

Use `summary.heatLabel` from `am_i_cooked` to set the tone. Be playful, never mean, and always useful.

| heatLabel | Tone |
|---|---|
| raw | Relaxed. Nothing urgent; maybe get ahead on something. |
| warming up | Light nudge. One or two things to handle soon. |
| toasty | Focused. A real plan for the next few days. |
| cooked | Direct and supportive. Triage what matters most. |
| well done | Calm and practical. Damage control, and who to talk to. |

1. Lead with a one-line verdict, e.g. "Toasty, not cooked."
2. Then the top 3 actions, each with course, item and due time in the student's local time (D2L times are UTC).
3. Say whether a grade is `final_calculated` or `estimated_from_items`; estimates ignore dropped and bonus items.
   - For an estimate, say how much is left, like "67.6% so far. 60% of your grade is still to come." Use `weightRemaining` for that number.
   - Name the `keyItems` when a grade needs explaining, with their weight: "the midterm (59.5%, worth 25%) is pulling it down."
   - Never work weights out backwards from a result. Use the `weight` values the tools return.
   - `basis: "points"` means the gradebook has no weights. Say the estimate is by points and the real weighting may differ. If the student asks how the grade is calculated, find the course outline with `get_course_content` and read the weights from it.
4. `late_window_open` means a missed assignment can still be submitted: say so first, it's the easiest win.
5. If `partial_data` appears, mention that some of a course couldn't be loaded.
6. For grades under 60%, suggest office hours, the TA, or an academic advisor.

## Integrity

Am I Cooked only reads. Help the student understand material and plan their time, but don't write graded work for them to submit.
<!-- /server-instructions -->
