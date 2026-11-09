// Domain lives on <html data-site-domain>; change it there to repoint the page.
const DOMAIN = document.documentElement.dataset.siteDomain || "amicooked.app";
document.querySelectorAll("[data-domain]").forEach((el) => { el.textContent = DOMAIN; });

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Background: a field of dots, each a deadline cooking at its own pace.
const field = document.querySelector(".field");
const speed = 13;
let seed = 7;
const dots = document.createDocumentFragment();
for (let i = 0; i < 32 * 25; i++) {
  seed = (seed * 9301 + 49297) % 233280;
  const r = seed / 233280;
  const dur = speed * (0.75 + r * 0.5);
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.cssText = `--delay: -${(r * dur).toFixed(2)}s; --d: ${dur.toFixed(2)}s`;
  dots.append(dot);
}
field.append(dots);

// OS tabs, auto-selected from the visitor's computer.
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
  if (focus) tab.focus();
}
tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (e) => {
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1 + tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectTab(tabs[next % tabs.length], true);
  });
});
const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
if (/win/i.test(platform)) selectTab(document.getElementById("os-win"));

// Copy buttons, with a select-the-text fallback.
const live = document.getElementById("live");
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
  const idle = btn.textContent;
  let timer;
  btn.addEventListener("click", async () => {
    const src = document.getElementById(btn.dataset.copy);
    const ok = await copy(src.textContent.trim());
    if (!ok) getSelection().selectAllChildren(src);
    btn.textContent = ok ? "Copied" : "Copy failed";
    live.textContent = ok ? "Copied" : "Couldn't copy automatically. Select the text and copy it from your keyboard.";
    clearTimeout(timer);
    timer = setTimeout(() => { btn.textContent = idle; }, 1600);
  });
});

// Verdict card. Each week's heat uses the same scoring as the am_i_cooked tool:
// +2 per overdue item, +1 per item due within 72h, +3/+2/+1 for a grade under 50/60/70, capped at 10.
const WEEKS = [
  { name: "Chill", overdue: 0, due: 0, lowest: 86, line: "Nothing due. Go outside." },
  { name: "Busy", overdue: 0, due: 2, lowest: 78, line: "Two due this week. Start tonight." },
  { name: "Midterms", overdue: 0, due: 3, lowest: 64, line: "Not cooked yet. Getting warm." },
  { name: "Missed lab", overdue: 1, due: 3, lowest: 58, line: "Overdue lab. Submit it today." },
  { name: "Finals", overdue: 3, due: 2, lowest: 47, line: "Email your prof. Right now." },
];
const LEVELS = [
  { name: "raw", color: "--raw" },
  { name: "warming up", color: "--warming" },
  { name: "toasty", color: "--toasty" },
  { name: "cooked", color: "--cooked" },
  { name: "well done", color: "--welldone" },
];
const heatOf = (w) => Math.min(2 * w.overdue + w.due + (w.lowest < 50 ? 3 : w.lowest < 60 ? 2 : w.lowest < 70 ? 1 : 0), 10);
const levelOf = (heat) => LEVELS[Math.min(Math.floor(heat / 2), 4)];
const nearestWeek = (v) => WEEKS.reduce((best, w, i) => (Math.abs(heatOf(w) - v) < Math.abs(heatOf(WEEKS[best]) - v) ? i : best), 0);

const card = document.getElementById("verdict");
const range = card.querySelector(".meter-range");
const weekButtons = [...card.querySelectorAll(".week")];
const progressBar = card.querySelector(".week-progress");
const playButton = card.querySelector(".play");

const WEEK_MS = 4500;
const IDLE_MS = 6000; // after someone drags or clicks, wait this long before playing again
let current = 2;
let progress = 0;
let paused = reducedMotion; // no autoplay for people who asked for less motion
let hovering = false;
let dragging = false;
let lastTouch = 0;

function setMarker(value) {
  card.style.setProperty("--heat", value);
}

function show(i) {
  const week = WEEKS[i];
  const heat = heatOf(week);
  const level = levelOf(heat);
  card.style.setProperty("--heat-color", `var(${level.color})`);
  card.querySelector("[data-label]").textContent = level.name;
  card.querySelector("[data-heat]").textContent = heat;
  card.querySelector("[data-line]").textContent = week.line;
  card.querySelector("[data-why]").textContent = `${week.overdue} overdue · ${week.due} due soon · ${week.lowest}% low`;
  weekButtons.forEach((b, j) => b.setAttribute("aria-pressed", j === i));
  weekButtons[i].append(progressBar);
  range.setAttribute("aria-valuetext", `${week.name} week, ${heat} out of 10, ${level.name}`);
}

function goTo(i, byUser) {
  current = i;
  progress = 0;
  progressBar.style.setProperty("--progress", 0);
  if (byUser) lastTouch = Date.now();
  show(i);
  setMarker(heatOf(WEEKS[i]));
  range.value = heatOf(WEEKS[i]);
}

setInterval(() => {
  if (paused || hovering || dragging || Date.now() - lastTouch < IDLE_MS) return;
  progress += 100 / WEEK_MS;
  if (progress >= 1) goTo((current + 1) % WEEKS.length);
  else progressBar.style.setProperty("--progress", progress);
}, 100);

// Dragging: the marker follows the pointer and the card shows the nearest week; letting go glides into it.
range.addEventListener("input", () => {
  const v = Number(range.value);
  dragging = true;
  lastTouch = Date.now();
  card.classList.add("is-dragging");
  setMarker(v);
  const i = nearestWeek(v);
  if (i !== current) { current = i; show(i); }
});
function release() {
  if (!dragging) return;
  dragging = false;
  card.classList.remove("is-dragging");
  goTo(nearestWeek(Number(range.value)), true);
}
range.addEventListener("change", release);
range.addEventListener("pointerup", release);
range.addEventListener("blur", release);
range.addEventListener("keydown", (e) => {
  const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  goTo(Math.max(0, Math.min(WEEKS.length - 1, current + step)), true);
});

weekButtons.forEach((b, i) => b.addEventListener("click", () => goTo(i, true)));

card.addEventListener("pointerenter", () => { hovering = true; });
card.addEventListener("pointerleave", () => { hovering = false; });
card.addEventListener("focusin", () => { hovering = true; });
card.addEventListener("focusout", () => { hovering = false; });

function setPaused(value) {
  paused = value;
  progress = 0;
  progressBar.style.setProperty("--progress", 0);
  playButton.dataset.paused = value;
  playButton.setAttribute("aria-label", value ? "Play the weeks" : "Pause the weeks");
}
playButton.addEventListener("click", () => setPaused(!paused));
setPaused(paused);
goTo(current);
