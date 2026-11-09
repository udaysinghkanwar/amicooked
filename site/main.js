// Domain lives on <html data-site-domain>; change it there to repoint the page.
const DOMAIN = document.documentElement.dataset.siteDomain || "amicooked.app";
document.querySelectorAll("[data-domain]").forEach((el) => { el.textContent = DOMAIN; });

// Mac / Windows install tabs
const tabs = [...document.querySelectorAll('[role="tab"]')];
const where = document.querySelector(".install-where");
function select(tab, focus) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
  if (where) where.textContent = where.dataset[tab.id === "tab-win" ? "whereWin" : "whereMac"];
  if (focus) tab.focus();
}
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
const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
if (/win/i.test(platform)) select(document.getElementById("tab-win"));

// Copy buttons
const live = document.getElementById("live");
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.className = "sr-only";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return fallbackCopy(text); }
}
document.querySelectorAll("[data-copy]").forEach((btn) => {
  const label = btn.querySelector(".copy-label");
  const icon = btn.querySelector("use");
  let timer;
  btn.addEventListener("click", async () => {
    const src = document.getElementById(btn.dataset.copy);
    const ok = await copy(src.textContent.trim());
    if (!ok) getSelection().selectAllChildren(src);
    label.textContent = ok ? "Copied" : "Selected";
    icon.setAttribute("href", ok ? "#i-check" : "#i-copy");
    btn.classList.toggle("is-done", ok);
    live.textContent = ok ? "Copied to clipboard" : "Couldn't copy automatically. The text is selected, so copy it from your keyboard.";
    clearTimeout(timer);
    timer = setTimeout(() => {
      label.textContent = "Copy";
      icon.setAttribute("href", "#i-copy");
      btn.classList.remove("is-done");
    }, 1800);
  });
});
