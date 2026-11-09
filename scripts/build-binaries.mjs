// Compiles standalone amicooked binaries with Bun and writes SHA256SUMS.
// Usage: node scripts/build-binaries.mjs [target ...]   (default: all targets)
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";

const TARGETS = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-x64": "bun-linux-x64",
  "windows-x64": "bun-windows-x64",
};

const wanted = process.argv.slice(2);
const targets = wanted.length ? wanted : Object.keys(TARGETS);
mkdirSync("build", { recursive: true });

const sums = [];
for (const name of targets) {
  const bunTarget = TARGETS[name];
  if (!bunTarget) throw new Error(`Unknown target ${name}. Use one of: ${Object.keys(TARGETS).join(", ")}`);
  const file = `amicooked-${name}${name.startsWith("windows") ? ".exe" : ""}`;
  console.log(`Building ${file}`);
  execFileSync("npx", ["-y", "bun@1.4.4", "build", "src/cli.ts", "--compile", "--minify", `--target=${bunTarget}`, `--outfile=build/${file}`], {
    stdio: "inherit",
  });
  sums.push(`${createHash("sha256").update(readFileSync(`build/${file}`)).digest("hex")}  ${file}`);
}
writeFileSync("build/SHA256SUMS", sums.join("\n") + "\n");
