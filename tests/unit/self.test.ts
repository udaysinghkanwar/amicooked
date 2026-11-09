import { describe, expect, it } from "vitest";
import { selfCommand } from "../../src/clients/self.js";

describe("selfCommand", () => {
  it("runs a compiled binary directly", () => {
    const rt = { execPath: "/Users/a/.amicooked/bin/amicooked", argv: ["x", "/$bunfs/root/amicooked"], platform: "darwin" as const, isCompiled: true };
    expect(selfCommand(["mcp"], rt)).toEqual({ command: "/Users/a/.amicooked/bin/amicooked", args: ["mcp"] });
  });

  it("runs a global npm install through node", () => {
    const rt = { execPath: "/opt/homebrew/bin/node", argv: ["node", "/opt/homebrew/lib/node_modules/amicooked/dist/cli.js"], platform: "darwin" as const, isCompiled: false };
    expect(selfCommand(["mcp"], rt)).toEqual({ command: "/opt/homebrew/bin/node", args: ["/opt/homebrew/lib/node_modules/amicooked/dist/cli.js", "mcp"] });
  });

  it("uses a pinned npx with a usable PATH when run through npx", () => {
    const rt = { execPath: "/Users/a/.nvm/versions/node/v22/bin/node", argv: ["node", "/Users/a/.npm/_npx/abc/node_modules/amicooked/dist/cli.js"], platform: "darwin" as const, isCompiled: false };
    expect(selfCommand(["mcp"], rt)).toEqual({
      command: "/Users/a/.nvm/versions/node/v22/bin/npx",
      args: ["-y", "amicooked@0", "mcp"],
      env: { PATH: "/Users/a/.nvm/versions/node/v22/bin:/usr/bin:/bin" },
    });
  });

  it("goes through cmd on Windows npx", () => {
    const rt = { execPath: "C:\\node\\node.exe", argv: ["node", "C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\abc\\cli.js"], platform: "win32" as const, isCompiled: false };
    expect(selfCommand(["mcp"], rt)).toEqual({ command: "cmd", args: ["/c", "npx", "-y", "amicooked@0", "mcp"] });
  });
});
