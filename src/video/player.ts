import { escape } from "./visuals.js";
import type { Lesson } from "./schema.js";
export type Chapter = {
  id: string;
  title: string;
  start: number;
  duration: number;
};

export function player(lesson: Lesson, chapters: Chapter[]) {
  const buttons = chapters
    .map(
      (c) =>
        `<button type="button" data-time="${c.start}">${escape(c.title)}</button>`,
    )
    .join("");
  const checks = lesson.scenes
    .filter((s) => s.check)
    .map(
      (s) =>
        `<details><summary>${escape(s.check!.question)}</summary><p>${escape(s.check!.answer)}</p></details>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(lesson.title)}</title><style>body{font:18px/1.6 system-ui;max-width:1120px;margin:35px auto;padding:20px;background:#f3f6fc;color:#18273c}h1{line-height:1.2}video{width:100%;border-radius:14px;background:white}nav{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}button,summary{font:inherit;cursor:pointer}button,details{background:white;border:1px solid #c6d0e2;border-radius:9px;padding:12px}details{margin:12px 0}a{color:#234dbb}</style><h1>${escape(lesson.title)}</h1><p>${escape(lesson.goal)}</p><p>${escape(lesson.mode)} · <a href="notes.md">Chapter notes and sources</a> · <a href="transcript.txt">Transcript</a> · <a href="captions.vtt">Captions</a></p><video controls preload="metadata" poster="poster.png"><source src="lesson.mp4" type="video/mp4"></video><nav aria-label="Chapters">${buttons}<button type="button" id="replay">Replay this chapter</button></nav>${checks}<script>const v=document.querySelector('video');const buttons=[...document.querySelectorAll('[data-time]')];buttons.forEach(b=>b.onclick=()=>{v.currentTime=Number(b.dataset.time);v.play().catch(()=>{});});document.querySelector('#replay').onclick=()=>{v.currentTime=buttons.map(b=>Number(b.dataset.time)).reverse().find(t=>t<=v.currentTime+.01)??0;v.play().catch(()=>{});};</script></html>`;
}
