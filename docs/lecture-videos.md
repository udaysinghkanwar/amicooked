# Lecture videos

Turn selected course material into a lesson that explains a concept, shows how to use it, and gives the student a way to check understanding. The workflow lives in `skill/SKILL.md`, so the installed skill and MCP server instructions receive the same teaching guidance. Am I Cooked retrieves sources; the student's host agent writes and renders the lesson.

## Start with the student's intent

Ask for missing details in one message: lecture/topic, learning goal, prior knowledge, mode and viewing-time budget. Do this before scripting or rendering. Reuse information already in the request. If the student delegates the choice, state the assumptions and continue.

| Mode | What to make | Suggested starting budget |
|---|---|---|
| **cramming** | High-yield methods, when to use them, one worked example, and explicit omissions. | 4–8 minutes per focused topic |
| **fully cooked** | Start from foundations; explain symbols, prerequisites, every operation and application. | 15–25 minute parts, adjustable |
| **chill** | Comfortable conceptual teaching with examples and time to process. | 8–15 minutes per topic |
| **bird's-eye** / **bird** | A conceptual map and key connections, with deferred depth identified. | 2–4 minutes |

These are starting points, not limits or a difficulty score. “Fully cooked” describes the student's need for support, not an assumption that they cannot learn. Use the playful label in the conversation and clear teaching inside the lesson. If a requested scope does not fit, offer a smaller scope or multiple parts.

Examples:

- “Make a cramming video on conditional probability. I know basic probability, but struggle with choosing the denominator. I have 6 minutes.”
- “I'm fully cooked on feedback diagrams. Start from what each wire means. Use the lecture notes and split it if needed.”
- “Give me a bird's-eye view of this lecture before class. Three minutes, no long derivation.”

## Local setup

Use an agent with **local command execution and file access**, such as Codex or Claude Code, with Am I Cooked connected. A host that only exposes the nine Brightspace tools can retrieve text but cannot render a video. Client support for local files and commands must be checked separately; installing the Am I Cooked skill does not add those capabilities.

When trying this branch from source, run `npm install`, `npm run build`, then `node dist/cli.js setup --clients chatgpt-desktop --no-login` (or `--clients code` for Claude Code) to refresh the installed skill without starting school login. Restart/reconnect the client so it reloads the skill and MCP instructions. A released install needs a version containing this workflow.

One supported production path is [HyperFrames](https://github.com/heygen-com/hyperframes), which renders editable HTML animations locally. It needs Node.js 22+, Chrome/Chromium, FFmpeg and FFprobe. Install missing system tools for your OS using their official instructions; [FFmpeg downloads](https://ffmpeg.org/download.html) include platform options. Then check:

```sh
npx hyperframes --version
npx hyperframes doctor --json
```

Inspect the individual doctor results: it can exit successfully while reporting missing dependencies. Transcription and music generators are optional. For an agent unfamiliar with the renderer, `npx hyperframes skills` installs its production guidance; this is an optional setup action, not part of normal Brightspace setup. Follow the installed CLI help if flags change.

For natural on-device narration, use [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx) with a supported Python environment and its model/voice files. Keep Python packages in a virtual environment; install `kokoro-onnx` and `soundfile` there. HyperFrames also exposes `tts`; inspect `npx hyperframes tts --help` and ensure that command can find the Python environment and models. An existing working local Kokoro script is equally suitable. Start with `am_michael` or the student's preferred available voice. Test math pronunciation before generating a whole lecture.

Model/runtime downloads need internet initially. Local synthesis/rendering does not need a speech API key, but the host AI may still send selected material to its provider and its own usage limits apply. If local media tooling is unavailable, deliver a clearly labelled script/storyboard or explain setup; do not silently switch to a paid or hosted renderer.

## Make the lesson

1. **Select sources.** Find the lecture through Am I Cooked, download the needed files, and read the relevant pages. Inspect diagrams with the host's visual tools. Preserve original files and page references. If the sources are missing or unreadable, ask for them rather than invent their contents.
2. **Save the brief.** Record the intent, selected mode, viewing budget, assumed prerequisites, chapters, omissions and source/page map. Use the instructor's notation; label invented example data as illustrative.
3. **Write for understanding.** Start with a concrete question. Explain quantities and assumptions, why each operation is valid, intermediate results and what the result means. Use analogous practice for assessed work. A shorter lesson covers fewer things; it does not hide the steps needed to follow its chosen example.
4. **Create narration and meaningful motion.** A spoken substitution should appear as that substitution, not an unexplained final equation. Time reveals and captions from measured narration segments. Hold important results briefly; avoid padded silence, distracting music and unreadably dense screens. Keep playback continuous unless the student wants quiz pauses.
5. **Preview, check, render.** With HyperFrames, use a new project folder and the following production loop. Adapt scenes to the selected topic; a generic title-card export is not a completed lesson.

```sh
npx hyperframes init my-lesson --non-interactive
cd my-lesson
# The agent writes the source-grounded scenes and adds measured local narration.
npx hyperframes check --json
npx hyperframes snapshot --at 1,10,20
npx hyperframes preview --background
# After reviewing the preview; the requested video file authorizes export.
npx hyperframes render --quality delivery --output lesson.mp4
ffprobe -v error -show_streams -show_format -of json lesson.mp4
```

Choose snapshot times covering every chapter, a dense calculation, and the ending—not just the example timestamps above. Consult `--help` for preview, render and snapshot options. Review findings even when the overall check passes; fix errors and assess warnings before delivery. An existing local animation workflow can replace HyperFrames; keep the same source, timing and quality requirements.

## Quality and delivery

| Check | Evidence to collect |
|---|---|
| Teaching and correctness | Review every substantive script transition. Recalculate the example independently. Check scope, prerequisites, sources and meaningful omissions. |
| Visuals | Inspect every chapter and dense step; check readable notation, intermediate states and alignment with spoken actions. |
| Media | Inspect the exported tracks, actual duration, decoded frames and last spoken line. Check captions against the current narration. |
| Listening | Listen to an opening and a math-heavy passage where possible. Audio levels and transcription are supporting checks, not a listening substitute. |
| Player | Open it in a real browser; play, seek to a chapter, replay, toggle captions and reveal a practice answer if included. |

Keep a captioned MP4, transcript, chapter/source notes, a simple study player and editable source together in the chosen course's `Study Videos/<topic>/` folder. A WebVTT caption track works for a local HTML player; retain a sidecar caption file with the MP4. Chapters and answer-reveal controls live in the player, not inside a linear MP4. If serving is necessary, use a loopback server with HTTP byte-range support, for example `npx http-server . -a 127.0.0.1 -p 8057 -c-1` from the lesson folder. Verify seeking to an unbuffered chapter; a basic server can play from the beginning while silently failing to seek. Provide the reopen command. Do not publish private sources or renders automatically.

Report the actual runtime, coverage and checks performed, including any listening or browser checks you could not do. A successful export is not proof of teaching quality, and watching to the end is not evidence of mastery. Verify one installment before generating a series.

## Try a small lesson

For a smoke test without a school login or private materials, save this original illustrative source as `source.md`:

> A fictional course has a quiz worth 20%, a project worth 30%, and a final worth 50%. Weights are fixed, with no dropped items, bonus or penalties. The completed quiz score is 70% and project score 80%; the final is ungraded. Weighted contributions are 0.20 × 70 = 14 and 0.30 × 80 = 24 course percentage points. The completed-work average is (38 / 50) × 100 = 76%. An 80% overall target requires 38 + 0.50F = 80, hence F = 84%. If the project score were 90%, the completed-work average would instead be 82% and an 80% overall target would require 78% on the final.

Ask the agent:

> Use the Am I Cooked lecture-video workflow and source.md. Make a chill lesson explaining why 38 earned course points means a 76% average so far. I know basic percentages. Aim for roughly three minutes, include the target-grade example and one practice check, and save the MP4 and local player. Use local narration and rendering.

Check the numbers independently, inspect when each result appears, and use the quality table above. This tests local production from a supplied source; it does not test Brightspace authentication, another host's behavior, or learning outcomes. Also try an underspecified request (“make a lecture video”) to check that the agent asks about intent before generating, and a host without command access to check that it explains the limitation rather than claiming a render.
