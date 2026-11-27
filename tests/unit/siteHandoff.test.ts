import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the actual classic browser script's status helpers with a fake clock.
// No DOM library, browser globals, network calls or duplicate implementation needed.
const source = readFileSync(new URL("../../site/main.js", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("let handoffStatusTimer;"), source.indexOf("const shareSetup ="));
function fixture() {
  const status = { textContent: "" };
  const actions = runInNewContext(`${helpers}\n({ begin: resetHandoffStatus, show: showHandoffStatus })`, {
    handoffStatus: status, setTimeout, clearTimeout,
  }) as { begin(): number; show(action: number, message: string, success?: boolean): void };
  return { status, ...actions };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("website handoff feedback", () => {
  it.each(["Link copied", "Setup link shared"])("clears %s after ten seconds", (message) => {
    const f = fixture();
    f.show(f.begin(), message, true);
    vi.advanceTimersByTime(9999);
    expect(f.status.textContent).toBe(message);
    vi.advanceTimersByTime(1);
    expect(f.status.textContent).toBe("");
  });

  it("gives a new success its own full ten seconds", () => {
    const f = fixture();
    f.show(f.begin(), "Copied", true);
    vi.advanceTimersByTime(6000);
    f.show(f.begin(), "Shared", true);
    vi.advanceTimersByTime(4000);
    expect(f.status.textContent).toBe("Shared");
    vi.advanceTimersByTime(6000);
    expect(f.status.textContent).toBe("");
  });

  it("keeps errors visible and cancels the previous success timer", () => {
    const f = fixture();
    f.show(f.begin(), "Copied", true);
    vi.advanceTimersByTime(2000);
    f.show(f.begin(), "Sharing failed");
    vi.advanceTimersByTime(30000);
    expect(f.status.textContent).toBe("Sharing failed");
    f.begin();
    expect(f.status.textContent).toBe("");
  });

  it("ignores an older share response after a newer copy action", () => {
    const f = fixture();
    const old = f.begin();
    f.show(f.begin(), "Copied", true);
    f.show(old, "Shared", true);
    expect(f.status.textContent).toBe("Copied");
    vi.advanceTimersByTime(10000);
    expect(f.status.textContent).toBe("");
  });

  it("clears an old message when a new action is cancelled", () => {
    const f = fixture();
    f.show(f.begin(), "Copied", true);
    f.begin();
    vi.advanceTimersByTime(10000);
    expect(f.status.textContent).toBe("");
  });
});
