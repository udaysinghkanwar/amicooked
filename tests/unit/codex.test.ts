import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  codexConfigured,
  codexSkillPath,
  hasCodex,
  installCodex,
  installCodexSkill,
  tomlEntry,
  uninstallCodex,
} from "../../src/clients/codex.js";

let dir: string;
let file: string;
const launch = { command: "/Users/me/.amicooked/bin/amicooked", args: ["mcp"] };

const EXISTING = `model = "gpt-5"

[mcp_servers.node_repl]
command = "/Applications/ChatGPT.app/node_repl"
args = []

[mcp_servers.node_repl.env]
CODEX_HOME = "/Users/me/.codex"

# settings for the desktop app
[desktop]
ambient-suggestions-enabled = true
`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-"));
  file = path.join(dir, "config.toml");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("installCodex", () => {
  it("adds our server and keeps every other setting as it was", () => {
    fs.writeFileSync(file, EXISTING);
    expect(installCodex(launch, file)).toBe("added");
    const text = fs.readFileSync(file, "utf8");
    expect(text.startsWith(EXISTING.trimEnd())).toBe(true);
    expect(text).toContain('[mcp_servers.amicooked]\ncommand = "/Users/me/.amicooked/bin/amicooked"\nargs = ["mcp"]\n');
    expect(fs.readFileSync(`${file}.amicooked.bak`, "utf8")).toBe(EXISTING);
  });

  it("changes nothing on a second run", () => {
    fs.writeFileSync(file, EXISTING);
    installCodex(launch, file);
    const once = fs.readFileSync(file, "utf8");
    expect(installCodex(launch, file)).toBe("unchanged");
    expect(fs.readFileSync(file, "utf8")).toBe(once);
  });

  it("replaces an older entry, sub-tables included, without duplicating it", () => {
    fs.writeFileSync(
      file,
      `[mcp_servers.amicooked]\ncommand = "npx"\nargs = ["-y", "amicooked@0", "mcp"]\n\n[mcp_servers.amicooked.env]\nPATH = "/usr/bin"\n\n# the app's own settings\n[desktop]\nx = 1\n`
    );
    expect(installCodex(launch, file)).toBe("updated");
    const text = fs.readFileSync(file, "utf8");
    expect(text.match(/\[mcp_servers\.amicooked\]/g)).toHaveLength(1);
    expect(text).not.toContain("npx");
    expect(text).not.toContain("[mcp_servers.amicooked.env]");
    expect(text).toContain("# the app's own settings\n[desktop]\nx = 1");
  });

  it("creates the file when Codex has no config yet", () => {
    const nested = path.join(dir, "fresh", "config.toml");
    expect(installCodex(launch, nested)).toBe("added");
    expect(fs.readFileSync(nested, "utf8")).toBe(`${tomlEntry(launch)}\n`);
  });

  it("writes env as its own table, escaping quotes", () => {
    const entry = tomlEntry({ command: "/opt/node/bin/npx", args: ["-y", "amicooked@0", "mcp"], env: { PATH: '/opt/"node"/bin:/usr/bin' } });
    expect(entry).toBe(
      '[mcp_servers.amicooked]\ncommand = "/opt/node/bin/npx"\nargs = ["-y", "amicooked@0", "mcp"]\n\n[mcp_servers.amicooked.env]\nPATH = "/opt/\\"node\\"/bin:/usr/bin"'
    );
  });
});

describe("uninstallCodex", () => {
  it("removes only our server", () => {
    fs.writeFileSync(file, EXISTING);
    installCodex(launch, file);
    expect(codexConfigured(file)).toBe(true);
    expect(uninstallCodex(file)).toBe("removed");
    expect(codexConfigured(file)).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(EXISTING);
    expect(uninstallCodex(file)).toBe("absent");
  });
});

describe("detection and skill", () => {
  it("finds Codex by its home folder, or by the macOS app", () => {
    fs.mkdirSync(path.join(dir, ".codex"));
    expect(hasCodex({ platform: "linux", home: dir }, () => false)).toBe(true);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "nocodex-"));
    expect(hasCodex({ platform: "darwin", home: empty }, () => true)).toBe(true);
    expect(hasCodex({ platform: "darwin", home: empty }, () => false)).toBe(false);
    expect(hasCodex({ platform: "linux", home: empty, codexHome: path.join(dir, ".codex") }, () => false)).toBe(true);
    fs.rmSync(empty, { recursive: true });
  });

  it("installs the skill where the desktop app reads skills", () => {
    expect(installCodexSkill(dir)).toBe("added");
    expect(codexSkillPath(dir)).toBe(path.join(dir, ".agents", "skills", "amicooked", "SKILL.md"));
    expect(installCodexSkill(dir)).toBe("unchanged");
  });
});
