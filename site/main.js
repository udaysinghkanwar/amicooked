// Domain lives on <html data-site-domain>; change it there to repoint the page.
const DOMAIN = document.documentElement.dataset.siteDomain || "amicooked-mcp.vercel.app";
document.querySelectorAll("[data-domain]").forEach((el) => { el.textContent = DOMAIN; });

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const live = document.getElementById("live");

// ---- OS tabs, auto-selected from the visitor's computer ----

const osTabs = [...document.querySelectorAll('.segmented [role="tab"]')];
function selectOs(tab, focus) {
  osTabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
  if (focus) tab.focus();
}
osTabs.forEach((tab, i) => {
  tab.addEventListener("click", () => selectOs(tab));
  tab.addEventListener("keydown", (e) => {
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1 + osTabs.length, Home: 0, End: osTabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectOs(osTabs[next % osTabs.length], true);
  });
});
const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
if (/win/i.test(platform)) selectOs(document.getElementById("os-win"));

// ---- Copy buttons, with a select-the-text fallback ----

function legacyCopy(text) {
  const ta = Object.assign(document.createElement("textarea"), { value: text, readOnly: true, className: "sr-only" });
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  ta.remove();
  return ok;
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return legacyCopy(text); }
}
document.querySelectorAll("[data-copy]").forEach((btn) => {
  let timer;
  btn.addEventListener("click", async () => {
    const src = document.getElementById(btn.dataset.copy);
    const ok = await copy(src.textContent.trim());
    if (!ok) getSelection().selectAllChildren(src);
    btn.classList.toggle("is-done", ok);
    live.textContent = ok ? "Copied" : "Couldn't copy automatically. The text is selected, so copy it from your keyboard.";
    clearTimeout(timer);
    timer = setTimeout(() => btn.classList.remove("is-done"), 1600);
  });
});

// ---- The conversation replay ----
// Replies are written the way an AI actually answers in chat: plain text, bold, lists. No coloured
// widgets, because Claude and ChatGPT render the tool's data as text.
// Verdicts follow the am_i_cooked tool's real scoring (src/tools/cooked.ts) and the skill's answer style:
// +2 per overdue item, +1 per item due within 72h, +3/+2/+1 for a lowest grade under 50/60/70.
// Bands: raw 0-1, warming up 2-3, toasty 4-5, cooked 6-7, well done 8-10.

const EXCHANGES = [
  {
    // One verdict per heat level; a different one is picked every time this chat plays
    q: "am i cooked?",
    tools: ["am_i_cooked"], note: "read 4 courses",
    variants: [
      {
        // nothing overdue or due within 72h, lowest grade 86% = 0, raw
        heat: "raw", lead: "Raw (0/10).", text: "Nothing due for five days. Go outside.",
        list: [
          ["2C03", "assignment 3 opens Monday"],
          ["3XA3", "no new announcements this week"],
          ["2XB3", "you’re at 86% so far"],
        ],
      },
      {
        // 2 due within 72h (+2), lowest grade 78% = 2, warming up
        heat: "warming", lead: "Warming up (2/10).", text: "Two things this week. Start one tonight.",
        list: [
          ["2C03", "assignment 2 due Thursday at 11:59 pm"],
          ["3XA3", "lab 5 due Friday"],
          ["2XB3", "you’re at 78%"],
        ],
      },
      {
        // 3 due within 72h (+3), lowest grade 64% (+1) = 4, toasty
        heat: "toasty", lead: "Toasty (4/10).", text: "Not cooked yet, but it’s getting warm.",
        list: [
          ["3XA3", "lab report due tomorrow at 11:59 pm, not submitted"],
          ["2C03", "assignment 2 and a quiz, both by Friday"],
          ["2XB3", "you’re at 64% (an estimate from graded items)"],
        ],
      },
      {
        // 1 overdue (+2), 3 due within 72h (+3), lowest grade 58% (+2) = 7, cooked
        heat: "cooked", lead: "Cooked (7/10).", text: "One overdue lab and a midterm Friday. Today, not tomorrow.",
        list: [
          ["3XA3", "lab 4 is 2 days late, but the dropbox is open until tonight"],
          ["2XB3", "midterm Friday, and you’re at 58% (estimate)"],
          ["2C03", "assignment 2 and a quiz, both by Friday"],
        ],
      },
      {
        // 3 overdue (+6), lowest grade 47% (+3) = 9, well done
        heat: "welldone", lead: "Well done (9/10).", text: "Three things overdue. Email your profs today; some late windows are still open.",
        list: [
          ["3XA3", "two labs overdue, late window closes Sunday"],
          ["2C03", "assignment 3 is a week late"],
          ["2XB3", "you’re at 47%. Book office hours this week"],
        ],
      },
    ],
    without: "bro i can’t even see your avenue 😭 u might be cooked lil bro idk",
  },
  {
    q: "did I submit lab 4?",
    tools: ["get_assignments"], note: "3XA3",
    text: "Yes, Tuesday at 10:42 pm. Lab 5 isn’t in yet, and it’s due Friday.",
    without: "bro how would i know 😭 check your email or pray",
  },
  {
    q: "summarize the week 7 slides",
    tools: ["get_course_content", "download_file"], note: "Week7-Graphs.pdf",
    text: "Week 7 is graphs, in three points:",
    bullets: [
      "A graph is nodes plus edges, directed or not.",
      "BFS finds shortest paths when edges have no weights.",
      "Dijkstra needs non-negative weights. Your prof said this is on the midterm.",
    ],
    without: "i don’t have them 😭 but trust me it’s important, the prof said so",
  },
  {
    q: "what’s on the midterm?",
    tools: ["get_announcements"], note: "2XB3",
    text: "Chapters 4 to 7, 90 minutes, no calculators. That’s from Friday’s announcement.",
    without: "everything bro 💀 that’s always the answer",
  },
  {
    // 2 overdue (+4), 1 due within 72h (+1), lowest grade 47% (+3) = 8, well done
    q: "how bad is finals week?",
    tools: ["am_i_cooked"], note: "read 4 courses",
    heat: "welldone", lead: "Well done (8/10).", text: "Bad, but fixable. Start with the labs.",
    list: [
      ["3XA3", "two labs overdue. The late window closes Sunday, so submit those first"],
      ["2C03", "final project due Monday"],
      ["2XB3", "you’re at 47%. Email your prof or go to office hours this week"],
    ],
    without: "no clue fr, but drink water, sleep, and maybe start today 💀🙏",
  },
];

const win = document.getElementById("window");
const thread = document.getElementById("thread");
const composer = win.querySelector(".composer");
const composerText = win.querySelector(".composer-text");
const railButtons = [...win.querySelectorAll(".rail button")];
const railProgress = win.querySelector(".rail-progress");
const playButton = win.querySelector(".play");
const withToggle = win.querySelector(".with-toggle");

const HOLD_MS = 4200;
const CANCEL = Symbol("cancel");

let current = 0;
let withTool = true;
let run = 0; // bumps on every jump; anything still running for an older run stops
let paused = reducedMotion; // no autoplay for people who asked for less motion
let hovering = false;
let focused = false;
let visible = false;

// An exchange with variants gets a random one each time it plays, never the one shown last
let lastVariant = -1;
function pickVariant(ex) {
  if (!ex.variants) return ex;
  let i;
  do i = Math.floor(Math.random() * ex.variants.length);
  while (ex.variants.length > 1 && i === lastVariant);
  lastVariant = i;
  return { ...ex, ...ex.variants[i] };
}
// Every version an exchange can show, for measuring the tallest
const allVersions = (ex) => (ex.variants ? ex.variants.map((v) => ({ ...ex, ...v })) : [ex]);

// The edge light takes the heat of the answer in the window. Answers without a verdict keep the last
// one; without Am I Cooked there's nothing to read, so it drains to grey.
const lights = [...document.querySelectorAll(".heat-light span")];
let lastHeat = "toasty";
function setHeat(ex, mode) {
  if (mode === "with" && ex?.heat) lastHeat = ex.heat;
  const heat = mode === "without" ? "none" : lastHeat;
  lights.forEach((l) => l.classList.toggle("is-on", l.dataset.heat === heat));
}

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const svgUse = (id) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
};
const sleep = (ms, id) => new Promise((resolve, reject) => setTimeout(() => (id === run ? resolve() : reject(CANCEL)), ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const show = (node) => requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add("is-in")));

// Words wrapped one by one so they can stream in
function words(text, cls = "") {
  const frag = document.createDocumentFragment();
  text.split(" ").forEach((word, i) => {
    if (i) frag.append(" ");
    frag.append(el("span", `w ${cls}`.trim(), word));
  });
  return frag;
}

function buildTool(ex) {
  const tool = el("p", "tool pop");
  tool.append(svgUse("i-check"), el("span", "", "Used Am I Cooked"));
  ex.tools.forEach((t) => { tool.append(" ", el("code", "", t)); });
  tool.append(" ", el("span", "tool-note", ex.note));
  return tool;
}

// The answer as chat text, with every word and line hidden until it streams in
function buildAnswer(ex, mode) {
  const answer = el("div", "answer");
  if (mode === "without") {
    const p = el("p", "answer-text");
    p.append(words(ex.without));
    answer.append(p);
    return answer;
  }
  if (ex.lead || ex.text) {
    const p = el("p", "answer-text");
    if (ex.lead) p.append(el("strong", "w", ex.lead), " ");
    if (ex.text) p.append(words(ex.text));
    answer.append(p);
  }
  if (ex.list) {
    const ol = el("ol", "reply-list");
    ex.list.forEach(([code, item]) => {
      const li = el("li", "line");
      li.append(el("strong", "", code), ` ${item}`);
      ol.append(li);
    });
    answer.append(ol);
  }
  if (ex.bullets) {
    const ul = el("ul", "bullets");
    ex.bullets.forEach((b) => ul.append(el("li", "line", b)));
    answer.append(ul);
  }
  return answer;
}

// A finished exchange, all at once (reduced motion, measuring)
function renderFinal(ex, mode, target = thread) {
  target.replaceChildren(el("p", "msg-user", ex.q));
  if (mode === "with") {
    const tool = buildTool(ex);
    tool.classList.add("is-in", "is-done");
    target.append(tool);
  }
  const answer = buildAnswer(ex, mode);
  answer.querySelectorAll(".w, .line").forEach((n) => n.classList.add("is-in"));
  target.append(answer);
}

async function clearThread(id) {
  if (!thread.children.length) return;
  thread.classList.add("is-leaving");
  await sleep(200, id);
  thread.replaceChildren();
  thread.classList.remove("is-leaving");
}

async function typeQuestion(text, id) {
  composerText.textContent = "";
  composer.classList.add("has-text");
  for (const ch of text) {
    composerText.textContent += ch;
    await sleep(24 + Math.random() * 14, id);
  }
  await sleep(260, id);
  composerText.textContent = "";
  composer.classList.remove("has-text");
}

// Streams words with delays that shorten as the line goes on, so it reads as speech, not a metronome
async function stream(nodes, id, first = 46, last = 22) {
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].classList.add("is-in");
    const t = nodes.length > 1 ? i / (nodes.length - 1) : 1;
    await sleep(first + (last - first) * t, id);
  }
}

async function play(index, mode, id) {
  const ex = pickVariant(EXCHANGES[index]);
  await clearThread(id);
  await typeQuestion(ex.q, id);

  const bubble = el("p", "msg-user pop", ex.q);
  thread.append(bubble);
  show(bubble);
  await sleep(320, id);

  if (mode === "with") {
    const tool = buildTool(ex);
    tool.classList.add("is-running");
    thread.append(tool);
    show(tool);
    await sleep(900, id);
    tool.classList.replace("is-running", "is-done");
    await sleep(140, id);
  } else {
    await sleep(380, id);
  }

  const answer = buildAnswer(ex, mode);
  thread.append(answer);
  await nextFrame();

  // The bold verdict leads and gets a beat to itself, then the rest of the sentence streams.
  // The edge light changes with it.
  setHeat(ex, mode);
  const lead = answer.querySelector("strong.w");
  if (lead) {
    lead.classList.add("is-in");
    await sleep(180, id);
  }
  await stream([...answer.querySelectorAll(".w:not(strong)")], id);
  // List items arrive as whole lines, slightly overlapping
  const lines = [...answer.querySelectorAll(".line")];
  if (lines.length) await sleep(60, id);
  for (const line of lines) {
    line.classList.add("is-in");
    await sleep(110, id);
  }
}

const held = () => paused || hovering || focused || !visible;

// Wait on the finished answer. The rail line is a WAAPI animation (compositor, not per-frame style writes)
// that doubles as the timer: it pauses while anyone is reading or interacting.
async function hold(id) {
  // Verdicts carry more to read, so they stay up longer
  const ex = EXCHANGES[current];
  const duration = ex.list || ex.variants ? HOLD_MS + 1400 : HOLD_MS;
  const timer = railProgress.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration, fill: "forwards" });
  while (timer.playState !== "finished") {
    await nextFrame();
    if (id !== run) { timer.cancel(); throw CANCEL; }
    if (held() && timer.playState === "running") timer.pause();
    else if (!held() && timer.playState === "paused") timer.play();
  }
}

function markRail(index) {
  railProgress.getAnimations().forEach((a) => a.cancel());
  railButtons.forEach((b, i) => {
    if (i === index) { b.setAttribute("aria-current", "true"); b.append(railProgress); }
    else b.removeAttribute("aria-current");
  });
}

async function loop(id) {
  try {
    for (;;) {
      await hold(id);
      current = (current + 1) % EXCHANGES.length;
      markRail(current);
      await play(current, withTool ? "with" : "without", id);
    }
  } catch (e) {
    if (e !== CANCEL) throw e;
  }
}

// Start an exchange from the top (picking a chat, flipping the toggle), then let the loop carry on.
// Anything still playing for an older run stops at its next step.
function restart(index) {
  const id = ++run;
  current = index;
  markRail(index);
  composerText.textContent = "";
  composer.classList.remove("has-text");
  const mode = withTool ? "with" : "without";
  if (reducedMotion) {
    const ex = pickVariant(EXCHANGES[index]);
    renderFinal(ex, mode);
    setHeat(ex, mode);
    loop(id);
    return;
  }
  play(index, mode, id).then(() => loop(id), (e) => { if (e !== CANCEL) throw e; });
}

// Reserve the tallest exchange's height so the window never jumps between them
function reserveHeight() {
  const probe = thread.cloneNode(false);
  probe.removeAttribute("id");
  Object.assign(probe.style, { position: "absolute", visibility: "hidden", width: `${thread.clientWidth}px`, minHeight: "0" });
  thread.parentElement.append(probe);
  let tallest = 0;
  EXCHANGES.flatMap(allVersions).forEach((ex) => ["with", "without"].forEach((mode) => {
    renderFinal(ex, mode, probe);
    tallest = Math.max(tallest, probe.offsetHeight);
  }));
  probe.remove();
  thread.style.setProperty("--thread-h", `${Math.ceil(tallest)}px`);
}

// The With/Without pill is clipped to whichever label is active (the pill itself sits 3px inside the toggle)
function placePill() {
  const active = withToggle.querySelector(withTool ? ".with-on" : ".with-off");
  const left = active.offsetLeft - 3;
  const right = withToggle.clientWidth - 6 - left - active.offsetWidth;
  withToggle.style.setProperty("--pill-l", `${left}px`);
  withToggle.style.setProperty("--pill-r", `${Math.max(right, 0)}px`);
}

railButtons.forEach((b, i) => b.addEventListener("click", () => restart(i)));

withToggle.addEventListener("click", () => {
  withTool = !withTool;
  withToggle.setAttribute("aria-checked", withTool);
  withToggle.setAttribute("aria-label", withTool ? "With Am I Cooked" : "Without Am I Cooked");
  placePill();
  restart(current);
});

function setPaused(value) {
  paused = value;
  playButton.dataset.paused = value;
  playButton.setAttribute("aria-label", value ? "Play the examples" : "Pause the examples");
}
playButton.addEventListener("click", () => setPaused(!paused));

win.addEventListener("pointerenter", () => { hovering = true; });
win.addEventListener("pointerleave", () => { hovering = false; });
win.addEventListener("focusin", () => { focused = true; });
win.addEventListener("focusout", (e) => { if (!win.contains(e.relatedTarget)) focused = false; });

// The window now sits in the hero, so the first question waits for its entrance to land before typing
const landed = Promise.all(win.parentElement.getAnimations().map((a) => a.finished)).catch(() => {});

let started = false;
new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  // The first answer plays once the window comes into view, unless someone already picked a chat
  if (visible && !started) {
    started = true;
    landed.then(() => { if (run === 0) restart(0); });
  }
}, { threshold: 0.35 }).observe(win);

setPaused(paused);
placePill();
// The light eases in with the page, warm until the first verdict lands
requestAnimationFrame(() => requestAnimationFrame(() => setHeat(null, "with")));
thread.replaceChildren();
reserveHeight();
document.fonts.ready.then(() => { reserveHeight(); placePill(); });
let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { reserveHeight(); placePill(); }, 150);
});
