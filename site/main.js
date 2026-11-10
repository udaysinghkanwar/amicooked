// Domain lives on <html data-site-domain>; change it there to repoint the page.
const DOMAIN = document.documentElement.dataset.siteDomain || "amicooked.app";
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
// Each verdict's heat uses the same scoring as the am_i_cooked tool:
// +2 per overdue item, +1 per item due within 72h, +3/+2/+1 for a lowest grade under 50/60/70.
// Bands: raw 0-1, warming up 2-3, toasty 4-5, cooked 6-7, well done 8-10.

const EXCHANGES = [
  {
    q: "am i cooked?",
    tools: ["am_i_cooked"], note: "read 4 courses",
    verdict: { heat: 4, word: "Toasty.", rest: "Not cooked yet." },
    facts: [
      ["3XA3", "lab report due tomorrow, not submitted"],
      ["2C03", "assignment 2 and a quiz due by Friday"],
      ["2XB3", "at 64% (estimate)"],
    ],
    without: "I can’t see your Avenue account, so I don’t know what’s due. Check your course pages.",
  },
  {
    q: "did I submit lab 4?",
    tools: ["get_assignments"], note: "3XA3",
    text: "Yes, Tuesday at 10:42 pm. Lab 5 isn’t in yet, and it’s due Friday.",
    without: "I don’t have access to your submissions. Check the lab 4 dropbox on Avenue.",
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
    without: "I can’t open your course files. Paste the slides here and I’ll summarize them.",
  },
  {
    q: "what’s on the midterm?",
    tools: ["get_announcements", "read_file"], note: "2XB3",
    text: "Chapters 4 to 7, 90 minutes, no calculators. That’s from Friday’s announcement.",
    without: "I can’t see your course announcements. Check the course page or ask your prof.",
  },
  {
    q: "how bad is finals week?",
    tools: ["am_i_cooked"], note: "read 4 courses",
    verdict: { heat: 8, word: "Well done.", rest: "Bad, but fixable." },
    facts: [
      ["3XA3", "two labs overdue, late window closes Sunday"],
      ["2C03", "final project due Monday"],
      ["2XB3", "at 47%. Email your prof today."],
    ],
    without: "I can’t see your deadlines or grades, so I can’t say. List what’s due and I’ll help you plan.",
  },
];
const HEAT_TEXT = ["--raw-text", "--warming-text", "--toasty-text", "--cooked-text", "--welldone-text"];
const levelIndex = (heat) => Math.min(Math.floor(heat / 2), 4);

const win = document.getElementById("window");
const thread = document.getElementById("thread");
const composer = win.querySelector(".composer");
const composerText = win.querySelector(".composer-text");
const railButtons = [...win.querySelectorAll(".rail button")];
const railProgress = win.querySelector(".rail-progress");
const playButton = win.querySelector(".play");
const withToggle = win.querySelector(".with-toggle");
const appButtons = [...win.querySelectorAll(".app-switch button")];

const HOLD_MS = 4200;
const CANCEL = Symbol("cancel");

let current = 0;
let withTool = true;
let run = 0; // bumps on every jump; anything still running for an older run stops
let paused = reducedMotion; // no autoplay for people who asked for less motion
let hovering = false;
let focused = false;
let visible = false;

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

// The answer, with every word and line hidden; `reveal` decides how they appear
function buildAnswer(ex, mode) {
  const answer = el("div", "answer");
  if (mode === "without") {
    const p = el("p", "answer-text");
    p.append(words(ex.without));
    answer.append(p);
    return answer;
  }
  if (ex.verdict) {
    const row = el("div", "verdict-row");
    const verdict = el("p", "verdict");
    const word = el("b", "heat-word w", ex.verdict.word);
    word.style.setProperty("--heat-text", `var(${HEAT_TEXT[levelIndex(ex.verdict.heat)]})`);
    verdict.append(word, " ", words(ex.verdict.rest));
    const meter = el("span", "mini-meter");
    meter.setAttribute("role", "img");
    meter.setAttribute("aria-label", `Heat ${ex.verdict.heat} out of 10`);
    const track = el("span", "mini-track");
    track.append(el("span", "mini-rest"));
    meter.append(track, el("span", "mini-marker"));
    row.append(verdict, meter);
    answer.append(row);
  }
  if (ex.text) {
    const p = el("p", "answer-text");
    p.append(words(ex.text));
    answer.append(p);
  }
  if (ex.facts) {
    const ul = el("ul", "facts");
    ex.facts.forEach(([code, fact]) => {
      const li = el("li", "line");
      li.append(el("code", "", code), fact);
      ul.append(li);
    });
    answer.append(ul);
  }
  if (ex.bullets) {
    const ul = el("ul", "bullets");
    ex.bullets.forEach((b) => ul.append(el("li", "line", b)));
    answer.append(ul);
  }
  return answer;
}

// The meter moves with transforms set on its own parts: the grey rest shrinks from the right, the marker slides
const METER_PX = 140;
function setHeat(meter, heat) {
  meter.querySelector(".mini-rest").style.transform = `scaleX(${1 - heat / 10})`;
  meter.querySelector(".mini-marker").style.transform = `translateX(${(heat / 10) * METER_PX}px)`;
}

// A finished exchange, all at once (jumps, reduced motion, measuring)
function renderFinal(ex, mode, target = thread) {
  target.replaceChildren(el("p", "msg-user", ex.q));
  if (mode === "with") {
    const tool = buildTool(ex);
    tool.classList.add("is-in", "is-done");
    target.append(tool);
  }
  const answer = buildAnswer(ex, mode);
  answer.querySelectorAll(".w, .line").forEach((n) => n.classList.add("is-in"));
  const meter = answer.querySelector(".mini-meter");
  if (meter) setHeat(meter, ex.verdict.heat);
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
  const ex = EXCHANGES[index];
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

  // The verdict word leads, and the meter slides with it
  const heatWord = answer.querySelector(".heat-word");
  if (heatWord) {
    heatWord.classList.add("is-in");
    setHeat(answer.querySelector(".mini-meter"), ex.verdict.heat);
    await sleep(160, id);
  }
  await stream([...answer.querySelectorAll(".w:not(.heat-word)")], id);
  // Fact lines arrive as whole lines, slightly overlapping
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
  const duration = EXCHANGES[current].verdict ? HOLD_MS + 1400 : HOLD_MS;
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

// Jumping shows the finished exchange right away, then the loop carries on from there
async function jump(index) {
  const id = ++run;
  current = index;
  markRail(index);
  composerText.textContent = "";
  composer.classList.remove("has-text");
  thread.classList.add("is-leaving");
  await new Promise((r) => setTimeout(r, reducedMotion ? 0 : 160));
  if (id !== run) return;
  thread.classList.remove("is-leaving");
  renderFinal(EXCHANGES[index], withTool ? "with" : "without");
  loop(id);
}

// Reserve the tallest exchange's height so the window never jumps between them
function reserveHeight() {
  const probe = thread.cloneNode(false);
  probe.removeAttribute("id");
  Object.assign(probe.style, { position: "absolute", visibility: "hidden", width: `${thread.clientWidth}px`, minHeight: "0" });
  thread.parentElement.append(probe);
  let tallest = 0;
  EXCHANGES.forEach((ex) => ["with", "without"].forEach((mode) => {
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

railButtons.forEach((b, i) => b.addEventListener("click", () => jump(i)));

withToggle.addEventListener("click", () => {
  withTool = !withTool;
  withToggle.setAttribute("aria-checked", withTool);
  withToggle.setAttribute("aria-label", withTool ? "With Am I Cooked" : "Without Am I Cooked");
  placePill();
  jump(current);
});

appButtons.forEach((b) => b.addEventListener("click", () => {
  appButtons.forEach((x) => x.setAttribute("aria-pressed", x === b));
  win.querySelectorAll("[data-app-name]").forEach((n) => { n.textContent = b.dataset.app; });
}));

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

let started = false;
new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  // The first answer plays once the window comes into view
  if (visible && !started) {
    started = true;
    const id = ++run;
    if (reducedMotion) { renderFinal(EXCHANGES[0], "with"); loop(id); return; }
    play(0, "with", id).then(() => loop(id), (e) => { if (e !== CANCEL) throw e; });
  }
}, { threshold: 0.35 }).observe(win);

setPaused(paused);
placePill();
thread.replaceChildren();
reserveHeight();
document.fonts.ready.then(() => { reserveHeight(); placePill(); });
let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { reserveHeight(); placePill(); }, 150);
});
