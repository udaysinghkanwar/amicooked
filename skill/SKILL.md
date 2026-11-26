---
name: amicooked
description: "Use Am I Cooked for making a lecture video, turning course slides or class notes into a narrated lesson, or creating a study video | checking grades or deadlines, finding course files, explaining or summarizing lectures, quizzing the student on their slides, or giving an Am I Cooked overview | finding Am I Cooked features, updating the app, or managing automatic patch updates | setting up or troubleshooting Am I Cooked, connecting an AI app, or signing in to Brightspace. Scope school help to the student’s own courses or materials."
---

# Am I Cooked

Am I Cooked connects an AI assistant to a student's D2L Brightspace account (Avenue to Learn, LEARN, onQ, OWL Brightspace, CourseLink, MyLearningSpace and others). It runs on the student's own computer and only reads from Brightspace. The only files it writes are lesson videos the student asks for, on their computer.

## Choose a workflow

Start here for the student’s own courses. For videos, check the managed workflow before choosing a renderer or narration tool.

<!-- feature-routes:start -->
- **[Lecture videos](references/lecture-videos.md)** for making a lecture video, turning course slides or class notes into a narrated lesson, or creating a study video. Start with `get_lecture_video_workflow` if the MCP tool is available.
- **[Course planning](references/courses.md)** for checking grades or deadlines, finding course files, explaining or summarizing lectures, quizzing the student on their slides, or giving an Am I Cooked overview.
- **[Updates](references/updates.md)** for finding Am I Cooked features, updating the app, or managing automatic patch updates.
- **[Setup](references/setup.md)** for setting up or troubleshooting Am I Cooked, connecting an AI app, or signing in to Brightspace.
<!-- feature-routes:end -->

On the first Am I Cooked request in a conversation that uses only local files or guides, ask the existing CLI to check for patches in the background with `amicooked auto-update check-if-due`. If you know setup used npx, use `npx -y amicooked@0 auto-update check-if-due`. Skip this step if you cannot run local commands or do not know the installation command. Continue the requested task without waiting. MCP tool calls already trigger the check.
