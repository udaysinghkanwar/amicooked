// Domain lives on <html data-site-domain>; change it there to repoint the page.
const DOMAIN = document.documentElement.dataset.siteDomain || "amicooked.app";
document.querySelectorAll("[data-domain]").forEach((el) => { el.textContent = DOMAIN; });

// Tabs. OS tabs (data-os) stay in sync across both install blocks.
function select(tab, focus) {
  const lists = tab.dataset.os
    ? [...document.querySelectorAll(".tabs-os")]
    : [tab.closest('[role="tablist"]')];
  lists.forEach((list) => {
    list.querySelectorAll('[role="tab"]').forEach((t) => {
      const on = tab.dataset.os ? t.dataset.os === tab.dataset.os : t === tab;
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
  });
  if (focus) tab.focus();
}
document.querySelectorAll('[role="tablist"]').forEach((list) => {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const n = tabs.length;
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1 + n, Home: 0, End: n - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(tabs[next % n], true);
    });
  });
});
const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
if (/win/i.test(platform)) select(document.getElementById("os-win-1"));

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
  const label = btn.querySelector(".copy-label");
  const icon = btn.querySelector("use");
  const idle = label.textContent;
  let timer;
  btn.addEventListener("click", async () => {
    const src = document.getElementById(btn.dataset.copy);
    const ok = await copy(src.textContent.trim());
    if (!ok) getSelection().selectAllChildren(src);
    label.textContent = ok ? "Copied" : "Selected";
    icon.setAttribute("href", ok ? "#i-check" : "#i-copy");
    btn.classList.toggle("is-done", ok);
    live.textContent = ok ? "Copied" : "Couldn't copy automatically. The text is selected, so copy it from your keyboard.";
    clearTimeout(timer);
    timer = setTimeout(() => {
      label.textContent = idle;
      icon.setAttribute("href", "#i-copy");
      btn.classList.remove("is-done");
    }, 1800);
  });
});

// Heat slider. Bands: raw 0-1, warming up 2-3, toasty 4-5, cooked 6-7, well done 8-10.
const LEVELS = [
  { upTo: 1, name: "raw", color: "--raw", line: "Nothing due for 5 days. Go outside." },
  { upTo: 3, name: "warming up", color: "--warming", line: "Two things due this week. Start one tonight." },
  { upTo: 5, name: "toasty", color: "--toasty", line: "Not cooked yet, but it’s getting warm." },
  { upTo: 7, name: "cooked", color: "--cooked", line: "One overdue lab and a midterm Friday. Today, not tomorrow." },
  { upTo: 10, name: "well done", color: "--welldone", line: "Three overdue items. Email your prof now; late windows are still open." },
];
const card = document.getElementById("verdict");
const slider = document.getElementById("heat-slider");
const scale = [...card.querySelectorAll(".meter-scale li")];
slider.addEventListener("input", () => {
  const heat = Number(slider.value);
  const i = LEVELS.findIndex((l) => heat <= l.upTo);
  const level = LEVELS[i];
  card.style.setProperty("--heat", heat);
  card.style.setProperty("--heat-color", `var(${level.color})`);
  card.querySelector("[data-heat-label]").textContent = level.name;
  card.querySelector("[data-heat-value]").textContent = heat;
  card.querySelector("[data-heat-line]").textContent = level.line;
  scale.forEach((li, j) => li.classList.toggle("is-on", j === i));
  card.classList.toggle("is-other", heat !== 5);
  slider.setAttribute("aria-valuetext", `${heat} out of 10, ${level.name}`);
});
