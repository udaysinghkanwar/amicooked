// Compiles standalone amicooked binaries with Bun and writes SHA256SUMS.
// Usage: node scripts/build-binaries.mjs [target ...]   (default: all targets; "host" is this machine)
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";

const TARGETS = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-x64": "bun-linux-x64",
  "windows-x64": "bun-windows-x64",
};

const BUN_VERSION = "1.4.4";
const host = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const wanted = process.argv.slice(2).map(name => (name === "host" ? host : name));

// Use an installed Bun of the pinned version (CI installs it with setup-bun); otherwise fetch it with npx.
let installedBun = false;
try {
  installedBun = execFileSync("bun", ["--version"], { encoding: "utf8" }).trim() === BUN_VERSION;
} catch {}
const targets = wanted.length ? wanted : Object.keys(TARGETS);
mkdirSync("build", { recursive: true });

const sums = [];
for (const name of targets) {
  const bunTarget = TARGETS[name];
  if (!bunTarget) throw new Error(`Unknown target ${name}. Use one of: ${Object.keys(TARGETS).join(", ")}`);
  const file = `amicooked-${name}${name.startsWith("windows") ? ".exe" : ""}`;
  console.log(`Building ${file}`);
  const args = ["build", "src/cli.ts", "--compile", "--minify", `--target=${bunTarget}`, `--outfile=build/${file}`];
  if (installedBun) execFileSync("bun", args, { stdio: "inherit" });
  else {
    const npx = ["-y", `bun@${BUN_VERSION}`, ...args];
    execFileSync(process.platform === "win32" ? "cmd.exe" : "npx", process.platform === "win32" ? ["/d", "/c", "npx", ...npx] : npx, {
      stdio: "inherit",
    });
  }
  sums.push(`${createHash("sha256").update(readFileSync(`build/${file}`)).digest("hex")}  ${file}`);
}
writeFileSync("build/SHA256SUMS", sums.join("\n") + "\n");
