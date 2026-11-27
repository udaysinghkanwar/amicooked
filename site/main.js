// Domain lives on <html data-site-domain>; change it there to repoint the page.
const DOMAIN = document.documentElement.dataset.siteDomain || "amicooked-mcp.vercel.app";
document.querySelectorAll("[data-domain]").forEach((el) => { el.textContent = DOMAIN; });

const compactScreen = matchMedia("(max-width: 600px)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const live = document.getElementById("live");

// Vercel endpoints are available when the page is served, not when opened from disk.
const hosted = location.protocol === "https:" || location.protocol === "http:";
if (hosted) {
  const analytics = document.createElement("script");
  analytics.src = "/_vercel/insights/script.js";
  document.head.append(analytics);
}

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
// Anonymous click counts (see site/api/e.js): no cookies, nothing about the visitor
function count(event) {
  if (!hosted) return;
  try { navigator.sendBeacon?.("/api/e", JSON.stringify(event)); } catch {}
}
const COPY_TABS = { "cmd-mac": "mac", "cmd-win": "win", "cmd-npm": "npm", "agent-prompt": "agent" };
const commandBoxes = [...document.querySelectorAll("[data-copy]")].map(button => ({
  button,
  setup: document.getElementById(button.dataset.copy),
}));

// Alternative setup methods stay separate from the primary OS instructions.
const otherWays = [...document.querySelectorAll('[data-setup-method]')];
otherWays.forEach((button) => button.addEventListener('click', () => {
  const opening = button.getAttribute('aria-expanded') !== 'true';
  otherWays.forEach((item) => {
    const active = opening && item === button;
    item.setAttribute('aria-expanded', String(active));
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
  });
  if (opening && button.getAttribute('aria-controls') === 'agent-panel') {
    otherSetup.hidden = true;
    otherSetupToggle.setAttribute('aria-expanded', 'false');
  }
}));
const otherSetup = document.getElementById('other-setup-panel');
const otherSetupToggle = document.getElementById('other-setup-toggle');
otherSetupToggle.addEventListener('click', () => {
  otherSetup.hidden = !otherSetup.hidden;
  otherSetupToggle.setAttribute('aria-expanded', String(!otherSetup.hidden));
  if (!otherSetup.hidden) {
    document.getElementById('agent-panel').hidden = true;
    document.querySelector('[aria-controls="agent-panel"]').setAttribute('aria-expanded', 'false');
  }
});

// ---- The agent prompt: one line until asked for in full ----

const promptToggle = document.getElementById("prompt-toggle");
promptToggle?.addEventListener("click", () => {
  const open = document.querySelector(".cmd-prompt").classList.toggle("is-open");
  promptToggle.setAttribute("aria-expanded", open);
  promptToggle.textContent = open ? "Show less" : "Show full prompt";
  if (open) count({ e: "prompt" });
});

for (const { button: btn, setup } of commandBoxes) {
  let timer;
  btn.addEventListener("click", async () => {
    const src = setup;
    if (COPY_TABS[setup.id]) count({ e: "copy", tab: COPY_TABS[setup.id] });
    const ok = await copy(src.textContent.trim());
    if (!ok) getSelection().selectAllChildren(src);
    btn.classList.toggle("is-done", ok);
    live.textContent = ok ? "Copied" : "Couldn't copy automatically. The text is selected, so copy it from your keyboard.";
    clearTimeout(timer);
    timer = setTimeout(() => btn.classList.remove("is-done"), 1600);
  });
}

// Save the public setup link; this does not subscribe anyone or send mail.
const installDetails = document.querySelector('.install-details');
const setupLink = `https://${DOMAIN}/#install`;
const handoffStatus = document.getElementById('handoff-status');
let handoffStatusTimer;
let handoffAction = 0;
function resetHandoffStatus() {
  clearTimeout(handoffStatusTimer);
  handoffStatus.textContent = '';
  return ++handoffAction;
}
function showHandoffStatus(action, message, success = false) {
  if (action !== handoffAction) return;
  clearTimeout(handoffStatusTimer);
  handoffStatus.textContent = message;
  if (success) handoffStatusTimer = setTimeout(() => {
    if (action === handoffAction) handoffStatus.textContent = '';
  }, 10000);
}
const shareSetup = document.getElementById('share-setup');
const setupShareData = {title: 'Am I Cooked', text: 'Set up Am I Cooked on your computer.', url: setupLink};
function canShareSetupLink() {
  if (!isSecureContext || typeof navigator.share !== 'function') return false;
  try {
    // Older Safari versions can share links even without canShare().
    return typeof navigator.canShare !== 'function' || navigator.canShare(setupShareData);
  } catch {
    return false;
  }
}
let sharePending = false;
shareSetup.hidden = !canShareSetupLink();
const copySetup = document.getElementById('copy-setup');
copySetup.textContent = 'Copy Setup Link';
if (shareSetup.hidden) {
  document.querySelector('.handoff-actions').append(copySetup);
  document.querySelector('.utility-copy-separator').hidden = true;
}
const mobileInstallToggle = document.getElementById('mobile-install-toggle');
const syncInstallToggle = () => mobileInstallToggle.setAttribute('aria-expanded', String(installDetails.open));
mobileInstallToggle.addEventListener('click', () => {
  resetHandoffStatus();
  installDetails.open = !installDetails.open;
  syncInstallToggle();
});
installDetails.addEventListener('toggle', syncInstallToggle);
shareSetup.addEventListener('click', async () => {
  if (sharePending) return;
  const action = resetHandoffStatus();
  sharePending = true;
  shareSetup.disabled = true;
  try {
    // Keep this call synchronous with the tap: iOS/Android require transient user activation.
    await navigator.share(setupShareData);
    showHandoffStatus(action, 'Setup link shared. Open it on your computer to get started.', true);
  } catch (error) {
    if (error?.name !== 'AbortError') showHandoffStatus(action, 'Couldn’t share the link. Try Copy Setup Link instead.');
  } finally {
    sharePending = false;
    shareSetup.disabled = false;
  }
});
copySetup.addEventListener('click', async () => {
  const action = resetHandoffStatus();
  const copied = await copy(setupLink);
  showHandoffStatus(action, copied
    ? 'Link copied. Send it to your computer and setup from there.'
    : `Copy this link: ${setupLink}`, copied);
});
installDetails.open = !compactScreen.matches;
syncInstallToggle();
compactScreen.addEventListener('change', () => {
  installDetails.open = !compactScreen.matches;
  setPaused(reducedMotion);
  reserveHeight();
  restart(current);
});

// ---- The conversation replay ----
// Replies stay as chat text. A colour accent on verdicts reinforces the written heat label.
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
        lead: "Raw (0/10).", text: "Nothing due for five days. Go outside.",
        list: [
          ["2C03", "assignment 3 opens Monday"],
          ["3XA3", "no new announcements this week"],
          ["2XB3", "you’re at 86% so far"],
        ],
      },
      {
        // 2 due within 72h (+2), lowest grade 78% = 2, warming up
        lead: "Warming up (2/10).", text: "Two things this week. Start one tonight.",
        list: [
          ["2C03", "assignment 2 due Thursday at 11:59 pm"],
          ["3XA3", "lab 5 due Friday"],
          ["2XB3", "you’re at 78%"],
        ],
      },
      {
        // 3 due within 72h (+3), lowest grade 64% (+1) = 4, toasty
        lead: "Toasty (4/10).", text: "Not cooked yet, but it’s getting warm.",
        list: [
          ["3XA3", "lab report due tomorrow at 11:59 pm, not submitted"],
          ["2C03", "assignment 2 and a quiz, both by Friday"],
          ["2XB3", "you’re at 64% (an estimate from graded items)"],
        ],
      },
      {
        // 1 overdue (+2), 3 due within 72h (+3), lowest grade 58% (+2) = 7, cooked
        lead: "Cooked (7/10).", text: "One overdue lab and a midterm Friday. Today, not tomorrow.",
        list: [
          ["3XA3", "lab 4 is 2 days late, but the dropbox is open until tonight"],
          ["2XB3", "midterm Friday, and you’re at 58% (estimate)"],
          ["2C03", "assignment 2 and a quiz, both by Friday"],
        ],
      },
      {
        // 3 overdue (+6), lowest grade 47% (+3) = 9, well done
        lead: "Well done (9/10).", text: "Three things overdue. Email your profs today; some late windows are still open.",
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
    q: "make a video of the week 7 lecture",
    tools: ["get_course_content", "start_video_render"], note: "Week7-Graphs.pdf",
    video: { file: "Week7-Graphs-Lecture.mp4", title: "Week 7 · Graphs", length: "4:02" },
    lead: "4-minute narrated recap.", text: "BFS, Dijkstra and the shortest-path example from your slides, with the path traced step by step.",
    without: "can’t see your course 💔 the only video i can make is you panicking in 4k",
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
    lead: "Well done (8/10).", text: "Bad, but fixable. Start with the labs.",
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

// A rendered lecture video as a chat attachment: a slide-like thumbnail with a play button, length and file name
function buildVideo({ file, title, length }) {
  const card = el("figure", "file video line");
  const frame = el("div", "video-frame");
  // The thumbnail is a frame from the lesson: a small weighted graph with the shortest path traced
  frame.innerHTML = `<svg class="video-slide" viewBox="0 0 320 180" aria-hidden="true">
    <g class="edges"><path d="M60 120L130 145M110 58L130 145M130 145L265 125"/></g>
    <path class="route" d="M60 120L110 58L215 58L265 125"/>
    <g class="nodes"><circle cx="60" cy="120" r="9"/><circle cx="110" cy="58" r="9"/><circle cx="130" cy="145" r="9"/><circle cx="215" cy="58" r="9"/><circle cx="265" cy="125" r="9"/></g>
  </svg>`;
  frame.append(el("span", "video-title", title), el("span", "video-length", length));
  const play = el("span", "video-play");
  play.append(svgUse("i-play"));
  frame.append(play);
  card.append(frame, el("figcaption", "", file));
  return card;
}

// The answer as chat text, with every word and line hidden until it streams in
function buildAnswer(ex, mode) {
  const answer = el("div", "answer");
  const heat = ex.lead?.match(/^(Raw|Warming up|Toasty|Cooked|Well done)\b/i)?.[1];
  if (mode === "with" && heat) answer.dataset.heat = heat.toLowerCase().replace(/ /g, "-");
  if (mode === "with" && ex.video) answer.append(buildVideo(ex.video));
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
  if (!compactScreen.matches) await typeQuestion(ex.q, id);

  const bubble = el("p", "msg-user pop", ex.q);
  thread.append(bubble);
  show(bubble);
  await sleep(320, id);

  if (mode === "with") {
    const tool = buildTool(ex);
    tool.classList.add("is-running");
    thread.append(tool);
    show(tool);
    await sleep(compactScreen.matches ? 180 : 900, id);
    tool.classList.replace("is-running", "is-done");
    await sleep(140, id);
  } else {
    await sleep(380, id);
  }

  const answer = buildAnswer(ex, mode);
  thread.append(answer);
  await nextFrame();

  // A finished file (the rendered video) lands first, like an attachment
  const file = answer.querySelector(".file");
  if (file) {
    file.classList.add("is-in");
    await sleep(240, id);
  }
  // The bold verdict leads and gets a beat to itself, then the rest of the sentence streams
  const lead = answer.querySelector("strong.w");
  if (lead) {
    lead.classList.add("is-in");
    await sleep(180, id);
  }
  await stream([...answer.querySelectorAll(".w:not(strong)")], id);
  // List items arrive as whole lines, slightly overlapping
  const lines = [...answer.querySelectorAll(".line:not(.file)")];
  if (lines.length) await sleep(60, id);
  for (const line of lines) {
    line.classList.add("is-in");
    await sleep(110, id);
  }
}

const held = () => paused || focused || !visible || document.hidden;

// Wait on the finished answer. The rail line is a WAAPI animation (compositor, not per-frame style writes)
// that doubles as the timer: pause explicitly, for keyboard focus, or while offscreen.
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
  if (compactScreen.matches) {
    const list = railButtons[index].closest("ul");
    const item = railButtons[index].getBoundingClientRect();
    const viewport = list.getBoundingClientRect();
    if (item.left < viewport.left || item.right > viewport.right) {
      list.scrollTo({ left: list.scrollLeft + item.left - viewport.left - (viewport.width - item.width) / 2,
        behavior: reducedMotion ? "auto" : "smooth" });
    }
  }
}

async function loop(id) {
  try {
    for (;;) {
      await hold(id);
      if (id !== run) throw CANCEL;
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
  if (reducedMotion || compactScreen.matches) {
    const ex = pickVariant(EXCHANGES[index]);
    renderFinal(ex, mode);
    loop(id);
    return;
  }
  play(index, mode, id).then(() => loop(id), (e) => { if (e !== CANCEL) throw e; });
}

// Reserve the tallest exchange's height so the window never jumps between them
function reserveHeight() {
  if (compactScreen.matches) { thread.style.removeProperty("--thread-h"); return; }
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

// A mouse click should not leave the carousel paused indefinitely. Keyboard navigation still pauses it.
win.addEventListener("pointerdown", () => { focused = false; });
win.addEventListener("focusin", (e) => { focused = e.target.matches(":focus-visible"); });
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
thread.replaceChildren();
if (compactScreen.matches) { started = true; restart(0); }
reserveHeight();
document.fonts.ready.then(() => { reserveHeight(); placePill(); });
let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { reserveHeight(); placePill(); }, 150);
});
