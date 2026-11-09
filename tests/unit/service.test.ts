import { describe, expect, it } from "vitest";
import { hiddenLauncherVbs, launchAgentPlist, systemdUnit } from "../../src/remote/service.js";

const launch = { command: "/Users/a b/.amicooked/bin/amicooked", args: ["serve"], env: { PATH: "/usr/bin:/bin" } };

describe("background service files", () => {
  it("writes a LaunchAgent that keeps serve running", () => {
    const plist = launchAgentPlist(launch, "/tmp/serve.log");
    expect(plist).toContain("<string>/Users/a b/.amicooked/bin/amicooked</string>\n    <string>serve</string>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toContain("<key>PATH</key>\n    <string>/usr/bin:/bin</string>");
  });

  it("escapes XML in paths", () => {
    expect(launchAgentPlist({ command: "/a&b", args: [] }, "/log")).toContain("<string>/a&amp;b</string>");
  });

  it("quotes paths with spaces in the systemd unit", () => {
    const unit = systemdUnit(launch);
    expect(unit).toContain('ExecStart="/Users/a b/.amicooked/bin/amicooked" serve');
    expect(unit).toContain("Environment=PATH=/usr/bin:/bin");
  });

  it("starts the Windows binary hidden", () => {
    const vbs = hiddenLauncherVbs({ command: "C:\\Users\\a\\.amicooked\\bin\\amicooked.exe", args: ["serve"] });
    expect(vbs).toBe('CreateObject("Wscript.Shell").Run """C:\\Users\\a\\.amicooked\\bin\\amicooked.exe"" ""serve""", 0, False\r\n');
  });
});
