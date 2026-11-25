import { it, expect } from "vitest";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

it("reports existing install/setup counters and upgrades, appending CSV fields without changing old rows", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-stats-"));
  try {
    const preload = path.join(root, "fixture.mjs");
    fs.writeFileSync(preload, `globalThis.fetch = async (url, init) => {
      url = String(url);
      if (url.endsWith('/pipeline')) return Response.json([
        12, ['mcmaster', '12'], ['darwin-arm64', '12'], ['mac', '6'], 4,
        5, ['manual', '3', 'automatic', '2'], ['native', '5'], ['darwin-arm64', '5'], ['0.1.7->0.1.8', '5']
      ].map(result => ({ result })));
      if (url.includes('/releases?')) return Response.json([{ assets: [{ name:'SHA256SUMS', download_count:20 }, { name:'amicooked-darwin-arm64', download_count:25 }] }]);
      if (url.includes('registry.npmjs.org')) return Response.json({ time:{ created:new Date().toISOString() } });
      if (url.includes('api.npmjs.org')) return Response.json({ downloads:30 });
      return Response.json({ count:10, uniques:8 });
    };`);
    const csv = path.join(root, "stats.csv");
    const legacyHeader = "date,installer_runs,binary_downloads,npm_downloads,setups,schools,repo_views_14d,repo_uniques_14d,repo_clones_14d,copies,prompt_opens";
    const oldRow = "2026-11-24,10,15,20,8,1,5,4,3,2,1";
    fs.writeFileSync(csv, `${legacyHeader}\n${oldRow}\n`);
    const output = execFileSync(process.execPath, ["--import", pathToFileURL(preload).href, "scripts/stats.mjs", "--csv", csv], {
      encoding: "utf8", timeout: 15000,
      env: { ...process.env, GITHUB_TOKEN: "fixture", KV_REST_API_URL: "https://redis.test", KV_REST_API_READ_ONLY_TOKEN: "fixture" },
    });
    expect(output).toMatch(/Finished setups\s+12/);
    expect(output).toMatch(/Installer\/update runs\s+20/);
    expect(output).toMatch(/Finished upgrades\s+5/);
    expect(output).toMatch(/Manual \/ automatic\s+3 \/ 2/);
    const lines = fs.readFileSync(csv, "utf8").trim().split("\n");
    expect(lines[0]).toBe(`${legacyHeader},upgrades,upgrades_manual,upgrades_automatic`);
    expect(lines[1]).toBe(oldRow);
    expect(lines[2].split(",").slice(1)).toEqual(["20", "25", "30", "12", "1", "10", "8", "10", "6", "4", "5", "3", "2"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
