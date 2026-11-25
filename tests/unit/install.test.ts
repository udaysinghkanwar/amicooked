import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { createHash } from "crypto";
import { spawnSync } from "child_process";

let home: string;
let capture: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "amicooked-installer-"));
  capture = path.join(home, "args");
  const fixture = '#!/bin/sh\nprintf "%s\\n" "$@" > "$AMICOOKED_CAPTURE"\nexit "${AMICOOKED_TEST_EXIT:-0}"\n';
  const assets = ["amicooked-darwin-arm64", "amicooked-darwin-x64", "amicooked-linux-x64"];
  for (const name of assets) fs.writeFileSync(path.join(home, name), fixture);
  const hash = createHash("sha256").update(fixture).digest("hex");
  fs.writeFileSync(path.join(home, "SHA256SUMS"), assets.map((a) => `${hash}  ${a}\n`).join(""));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
function install(args: string[], extra: Record<string, string> = {}) {
  return spawnSync("sh", [path.resolve("install/install.sh"), ...args], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, HOME: home, AMICOOKED_HOME: path.join(home, "space home"), AMICOOKED_DOWNLOAD_BASE: pathToFileURL(home).href, AMICOOKED_CAPTURE: capture, AMICOOKED_NO_SETUP: "", AMICOOKED_CLIENTS: "", AMICOOKED_SCHOOL: "", ...extra },
  });
}

describe.skipIf(process.platform === "win32" || (process.platform === "linux" && process.arch === "arm64"))("POSIX installer with local checksum-verified fixture", () => {
  it("forwards client and school as exact arguments without a TTY", () => {
    const school = "https://school.example/a path?literal=$(not-a-command)";
    const r = install(["--clients", "gemini", "--school", school, "--yes"]);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(capture, "utf8")).toBe(`setup\n--clients\ngemini\n--school\n${school}\n--yes\n`);
  });
  it("supports client selection through the environment", () => {
    expect(install(["--school", "mcmaster"], { AMICOOKED_CLIENTS: "gemini-desktop" }).status).toBe(0);
    expect(fs.readFileSync(capture, "utf8")).toContain("--clients\ngemini-desktop\n--school\nmcmaster");
  });
  it("keeps --no-setup effective alongside forwarded flags", () => {
    expect(install(["--school", "mcmaster", "--no-setup", "--clients", "gemini"]).status).toBe(0);
    expect(fs.existsSync(capture)).toBe(false);
  });
  it("propagates setup failures", () => {
    expect(install(["--clients", "gemini"], { AMICOOKED_TEST_EXIT: "7" }).status).toBe(7);
  });
});
