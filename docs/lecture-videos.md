# Lecture videos

Turn selected course material into a lesson that explains a concept, shows how to use it, and gives the student a way to check understanding. The main skill routes video requests to [the detailed workflow](../skill/references/lecture-videos.md); ordinary course conversations do not load that guide. Am I Cooked retrieves sources; the student's host agent writes and renders the lesson.

Setup installs `references/lecture-videos.md` beside `SKILL.md` for local skill clients. MCP-only clients call the read-only `get_lecture_video_guide` tool to retrieve the same bundled text without filesystem access, school login or a website fetch. The guide remains separate from the MCP initialization instructions and is embedded in npm builds and standalone binaries. Reading it does not give a host rendering capabilities.

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

Use an agent with **local command execution and file access**, such as Codex or Claude Code, with Am I Cooked connected. A host that only exposes MCP tools can retrieve the guide and course text but cannot render a video. Client support for local files and commands must be checked separately; installing the Am I Cooked skill does not add those capabilities.

When trying this branch from source, run `npm install`, `npm run build`, then `node dist/cli.js setup --clients chatgpt-desktop --no-login` (or `--clients code` for Claude Code) to refresh the installed skill without starting school login. Restart/reconnect the client so it reloads the skill and MCP instructions. A released install needs a version containing this workflow.

The optional builder uses [HyperFrames](https://github.com/heygen-com/hyperframes) **0.9.72**, FFmpeg/FFprobe and Chrome/Chromium. Node.js 22+ and `npx` are required even with Am I Cooked's standalone binary. Install system tools through their official OS instructions, then run:

```sh
npx hyperframes@0.9.72 doctor --json
```

Inspect individual doctor checks; a zero exit code can still report missing tools. No renderer, model or speech service is installed by normal Am I Cooked setup. The first `npx` renderer download needs internet.

For on-device speech, create a Python virtual environment and install `kokoro-onnx` and `soundfile`. Download the model and voice files using the [official Kokoro ONNX instructions](https://github.com/thewh1teagle/kokoro-onnx). Pass those explicit paths when building. On Windows, the venv executable is typically `voice-env\Scripts\python.exe`; on macOS/Linux it is `voice-env/bin/python`. There is no hardcoded home directory or host-specific tool name. Voice availability and Python/runtime compatibility depend on the installed Kokoro version; test a short passage first.

Alternatively provide a local audio file for each narration cue. This removes the Python/Kokoro dependency and supports human narration or any chosen speech provider. Am I Cooked does not call that provider. Local synthesis/rendering needs no AI-provider API key; the host AI may still send selected material to its own provider, and its permissions/limits apply.

## Reusable production commands

The model authors plain JSON; reusable scripts handle narration caching, measured timing, visual scenes, captions, checks and export. They do not generate teaching content or choose the student's learning goal. Get an example spec through the CLI (works in npm and standalone distributions):

```sh
amicooked video example break-even > lesson.json
# Also available: breadth-first, petri-net.
amicooked video build lesson.json --out my-lesson \
  --python /path/to/venv/python --model /path/to/kokoro.onnx --voices /path/to/voices.bin
amicooked video check my-lesson
npx hyperframes@0.9.72 preview my-lesson/project --background
# Inspect the preview, narration and saved snapshots before export.
amicooked video render my-lesson
amicooked video serve my-lesson --port 8058
```

When working from source, use `node dist/cli.js` in place of `amicooked`. Quote paths with spaces and adapt executable paths to the user's OS. In an agent host, save example stdout using the available file tool if shell redirection is unavailable. `video --help` lists the options. Omit speech flags when every cue supplies `audio`; relative audio paths resolve against the input JSON. `--cache` selects a narration cache instead of the default `~/.amicooked/video-cache`.

The [workflow reference](../skill/references/lecture-videos.md#reusable-local-builder) contains the format and component fields. Examples in [examples/video](../examples/video/) cover cumulative KaTeX equations, numerical plots, code highlights, a graph execution trace and computed Petri-net markings. No executable lesson specs, provider SDKs or cloud rendering keys are involved. Small visual components remain editable HTML/SVG/GSAP; custom scenes are appropriate when the topic needs more than these components.

The delivery folder contains `lesson.mp4`, `player.html`, `captions.vtt`, `captions.srt`, `transcript.txt`, `notes.md`, `lesson.json`, `timing.json`, validation reports and `project/` with offline scripts/fonts/media and editable animation scenes. The MP4 includes visible captions. The player adds chapter/replay controls and practice answers. Run the serve command and open **http://127.0.0.1:8058/**; keep the server running. It binds to loopback and supports byte ranges for seeking. A changed spec requires a new output folder; rerendering the same spec preserves the previous MP4 as a timestamped backup.

## Make the lesson

1. **Select sources.** Find the lecture through Am I Cooked, download the needed files, and read the relevant pages. Inspect diagrams with the host's visual tools. Preserve original files and page references. If the sources are missing or unreadable, ask for them rather than invent their contents.
2. **Save the brief.** Record the intent, selected mode, viewing budget, assumed prerequisites, chapters, omissions and source/page map. Use the instructor's notation; label invented example data as illustrative.
3. **Write for understanding.** Start with a concrete question. Explain quantities and assumptions, why each operation is valid, intermediate results and what the result means. Use analogous practice for assessed work. A shorter lesson covers fewer things; it does not hide the steps needed to follow its chosen example.
4. **Create narration and meaningful motion.** A spoken substitution should appear as that substitution, not an unexplained final equation. Time reveals and captions from measured narration segments. Hold important results briefly; avoid padded silence, distracting music and unreadably dense screens. Keep playback continuous unless the student wants quiz pauses.
5. **Preview, check, render.** Use the production commands above. Review snapshots from every chapter and dense step, plus the ending. The automated checker is a gate, not a teaching-quality score: `ok:false` blocks render even when the checker exits successfully. Render also verifies audio/video tracks, measured duration and a full FFmpeg decode. Keep independent correctness review and actual listening/browser checks in the loop.

## Quality and delivery

| Check | Evidence to collect |
|---|---|
| Teaching and correctness | Review every substantive script transition. Recalculate the example independently. Check scope, prerequisites, sources and meaningful omissions. |
| Visuals | Inspect every chapter and dense step; check readable notation, intermediate states and alignment with spoken actions. |
| Media | Inspect the exported tracks, actual duration, decoded frames and last spoken line. Check captions against the current narration. |
| Listening | Listen to an opening and a math-heavy passage where possible. Audio levels and transcription are supporting checks, not a listening substitute. |
| Player | Open it in a real browser; play, seek to a chapter, replay, read captions and reveal a practice answer if included. |

Keep a captioned MP4, transcript, chapter/source notes, a simple study player and editable source together in the chosen course's `Study Videos/<topic>/` folder. This builder uses burned-in captions for consistent playback; retain a sidecar caption file with the MP4. Chapters and answer-reveal controls live in the player, not inside a linear MP4. If serving is necessary, use a loopback server with HTTP byte-range support, for example `npx http-server . -a 127.0.0.1 -p 8057 -c-1` from the lesson folder. Verify seeking to an unbuffered chapter; a basic server can play from the beginning while silently failing to seek. Provide the reopen command. Do not publish private sources or renders automatically.

Report the actual runtime, coverage and checks performed, including any listening or browser checks you could not do. A successful export is not proof of teaching quality, and watching to the end is not evidence of mastery. Verify one installment before generating a series.

## Try a small lesson

For a smoke test without a school login or private materials, save this original illustrative source as `source.md`:

> A fictional course has a quiz worth 20%, a project worth 30%, and a final worth 50%. Weights are fixed, with no dropped items, bonus or penalties. The completed quiz score is 70% and project score 80%; the final is ungraded. Weighted contributions are 0.20 × 70 = 14 and 0.30 × 80 = 24 course percentage points. The completed-work average is (38 / 50) × 100 = 76%. An 80% overall target requires 38 + 0.50F = 80, hence F = 84%. If the project score were 90%, the completed-work average would instead be 82% and an 80% overall target would require 78% on the final.

Ask the agent:

> Use the Am I Cooked lecture-video workflow and source.md. Make a chill lesson explaining why 38 earned course points means a 76% average so far. I know basic percentages. Aim for roughly three minutes, include the target-grade example and one practice check, and save the MP4 and local player. Use local narration and rendering.

Check the numbers independently, inspect when each result appears, and use the quality table above. This tests local production from a supplied source; it does not test Brightspace authentication, another host's behavior, or learning outcomes. Also try an underspecified request (“make a lecture video”) to check that the agent asks about intent before generating, and a host without command access to check that it explains the limitation rather than claiming a render.

## Compatibility and validation boundaries

| Surface | What is portable | What still needs verification |
|---|---|---|
| ChatGPT, Claude, Gemini and other models | The Markdown workflow and JSON spec have no provider dependency. | The exact app must expose file access and command execution for local production. MCP alone is insufficient. |
| Ordinary web/mobile chats | Read the guide and prepare a script/spec when supported. | Running a local CLI or reaching this computer's loopback player is not implied. Free-plan support is not claimed. |
| macOS, Linux, Windows | Node APIs, argument-array subprocesses, relative audio paths and configurable executables. | Install each OS's media dependencies. Actual export evidence currently comes from macOS; CI unit/build checks are separate. |

The three original illustrative demos exercise all visual types and the review arc. They are short production tests rather than evidence of learning outcomes, real Brightspace authentication or tested behavior inside every named AI app. Narration captions are segment-timed, not forced word alignment. Initial downloads need network access; cached assets and models support local production thereafter.

The generated renderer project uses one shared timeline with timed chapter sections. HyperFrames currently reports organizational warnings recommending sub-compositions; these are reviewed warnings, not hidden failures. This layout avoids a preview/export mismatch observed with nested template styles and timelines in the tested renderer. Inspect decoded exports as well as preview snapshots.
