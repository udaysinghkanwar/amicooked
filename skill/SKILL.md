---
name: amicooked
description: Use when a student asks about their D2L Brightspace courses, grades, deadlines, assignments, announcements or course files, asks "am I cooked?", or wants to set up or update Am I Cooked or explore its features.
---

# Am I Cooked

Am I Cooked connects an AI assistant to a student's D2L Brightspace account (Avenue to Learn, LEARN, onQ, OWL Brightspace, CourseLink, MyLearningSpace and others). It runs on the student's own computer and is read-only.

## Setup and optional features

- To install or connect an AI app, read [references/setup.md](references/setup.md).
- For updates, available features or a weekly update routine, read [references/updates.md](references/updates.md).

The app installs this entire skill folder from its release, including references. Do not install just this file or fetch individual files from the repository's main branch into an older app.

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

## Optional features

Use `get_feature_guide` to discover available features or read their instructions when local skill references are unavailable. Load only the requested guide. For setup or weekly updates, retrieve the corresponding guide. Scheduling depends on the host AI app; never claim a task was scheduled without a successful scheduler result.

## Integrity

Am I Cooked only reads. Help the student understand material and plan their time, but don't write graded work for them to submit.
<!-- /server-instructions -->
