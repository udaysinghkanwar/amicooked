// Prints Am I Cooked's numbers: installs, npm downloads, finished setups, upgrades and repo traffic.
//   npm run stats               print a table
//   npm run stats -- --csv F    also append one line to CSV file F (used by the weekly workflow)
// Redis credentials come from the environment or .env.local (`vercel env pull .env.local`).
// GitHub uses GITHUB_TOKEN / GH_TOKEN, or `gh auth token`. Anything unavailable shows as "-".
import { execFileSync } from "child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const REPO = pkg.repository.url.match(/github\.com\/(.+?)(\.git)?$/)[1];
const today = new Date().toISOString().slice(0, 10);

function githubToken() {
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

async function json(url, headers = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const token = githubToken();
const gh = (path) =>
  json(`https://api.github.com/repos/${REPO}${path}`, {
    accept: "application/vnd.github+json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });

async function releases() {
  const list = await gh("/releases?per_page=100");
  if (!list) return null;
  let installs = 0;
  let binaries = 0;
  for (const asset of list.flatMap((r) => r.assets)) {
    // Native installers and updaters fetch SHA256SUMS; this is activity, not unique installs.
    // Binary downloads also include bots that grab every release asset.
    if (asset.name === "SHA256SUMS") installs += asset.download_count;
    else binaries += asset.download_count;
  }
  return { installs, binaries };
}

async function npmDownloads() {
  const meta = await json(`https://registry.npmjs.org/${pkg.name}`);
  const created = meta?.time?.created?.slice(0, 10);
  if (!created) return null;
  // The API takes ranges of at most 18 months, so add it up a year at a time
  let total = 0;
  for (let start = new Date(created); start.toISOString().slice(0, 10) <= today; ) {
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 364);
    const from = start.toISOString().slice(0, 10);
    const to = end.toISOString().slice(0, 10) < today ? end.toISOString().slice(0, 10) : today;
    const point = await json(`https://api.npmjs.org/downloads/point/${from}:${to}/${pkg.name}`);
    if (typeof point?.downloads !== "number") return null;
    total += point.downloads;
    start = new Date(end);
    start.setUTCDate(start.getUTCDate() + 1);
  }
  return total;
}

async function setups() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const key =
    process.env.KV_REST_API_READ_ONLY_TOKEN ?? process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["GET", "setup:total"], ["HGETALL", "setup:schools"], ["HGETALL", "setup:platforms"],
        ["HGETALL", "copy:tabs"], ["GET", "prompt:opens"],
        ["GET", "upgrade:total"], ["HGETALL", "upgrade:modes"], ["HGETALL", "upgrade:channels"],
        ["HGETALL", "upgrade:platforms"], ["HGETALL", "upgrade:versions"],
      ]),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const [total, schools, platforms, tabs, prompt, upgrades, modes, channels, upgradePlatforms, versions] = (await res.json()).map((r) => r.result);
    const pairs = (flat) =>
      Object.fromEntries((flat ?? []).flatMap((v, i, a) => (i % 2 ? [] : [[v, Number(a[i + 1])]])));
    const copies = pairs(tabs);
    return {
      upgrades: Number(upgrades ?? 0), upgradeModes: pairs(modes), upgradeChannels: pairs(channels),
      upgradePlatforms: pairs(upgradePlatforms), upgradeVersions: pairs(versions),
      total: Number(total ?? 0), schools: pairs(schools), platforms: pairs(platforms),
      copies, copyTotal: Object.values(copies).reduce((a, b) => a + b, 0), promptOpens: Number(prompt ?? 0),
    };
  } catch {
    return null;
  }
}

const [rel, npm, setup, views, clones] = await Promise.all([
  releases(),
  npmDownloads(),
  setups(),
  gh("/traffic/views"),
  gh("/traffic/clones"),
]);

const show = (v) => (v === null || v === undefined ? "-" : String(v));
const top = (counts) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
const namedSchools = setup ? Object.keys(setup.schools).filter((s) => s !== "custom").length : null;

const row = (label, value, note = "") => console.log(`  ${label.padEnd(22)}${show(value).padStart(6)}${note ? `   ${note}` : ""}`);
console.log(`\nAm I Cooked stats (${today})\n\nInstalls`);
row("Installer/update runs", rel?.installs, "SHA256SUMS downloads; includes native upgrades, not unique installs");
row("Binary downloads", rel?.binaries, "includes bots");
row("npm downloads", npm, "since first publish");
console.log("\nSite");
row("Install copies", setup?.copyTotal, setup && setup.copyTotal ? top(setup.copies) : "");
row("Full prompt opened", setup?.promptOpens);
console.log("\nSetups");
row("Finished setups", setup?.total, "first setup per computer");
row("Schools", namedSchools, setup && Object.keys(setup.schools).length ? top(setup.schools) : "");
if (setup && Object.keys(setup.platforms).length) row("Platforms", "", top(setup.platforms));
console.log("\nUpgrades (anonymous successful version changes)");
row("Finished upgrades", setup?.upgrades);
row("Manual / automatic", setup ? `${setup.upgradeModes.manual ?? 0} / ${setup.upgradeModes.automatic ?? 0}` : null);
if (setup?.upgrades) {
  row("Channels", "", top(setup.upgradeChannels));
  row("Platforms", "", top(setup.upgradePlatforms));
  row("Versions", "", top(setup.upgradeVersions));
}
console.log("\nGitHub repo (last 14 days)");
row("Views", views?.count, views ? `${views.uniques} unique` : "needs a token with push access");
row("Clones", clones?.count, clones ? `${clones.uniques} unique` : "");
console.log("\nSite visitors: Vercel dashboard → Analytics\n");

const csvAt = process.argv.indexOf("--csv");
if (csvAt !== -1) {
  const file = process.argv[csvAt + 1];
  const header = "date,installer_runs,binary_downloads,npm_downloads,setups,schools,repo_views_14d,repo_uniques_14d,repo_clones_14d,copies,prompt_opens,upgrades,upgrades_manual,upgrades_automatic";
  const values = [today, rel?.installs, rel?.binaries, npm, setup?.total, namedSchools, views?.count, views?.uniques, clones?.count, setup?.copyTotal, setup?.promptOpens, setup?.upgrades, setup ? setup.upgradeModes.manual ?? 0 : null, setup ? setup.upgradeModes.automatic ?? 0 : null];
  if (!existsSync(file)) appendFileSync(file, `${header}\n`);
  else {
    // New columns go on the end, so older rows just leave them empty
    const lines = readFileSync(file, "utf8").split("\n");
    if (lines[0] !== header) writeFileSync(file, [header, ...lines.slice(1)].join("\n"));
  }
  appendFileSync(file, `${values.map((v) => v ?? "").join(",")}\n`);
  console.log(`Appended to ${file}`);
}
