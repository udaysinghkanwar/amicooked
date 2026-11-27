import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../site/main.js", import.meta.url), "utf8");
const code = source.slice(source.indexOf("let handoffStatusTimer;"), source.indexOf("copySetup.addEventListener"));
const payload = { title: "Am I Cooked", text: "Set up Am I Cooked on your computer.", url: "https://amicooked-mcp.vercel.app/#install" };

function fixture(navigator: { share?: ReturnType<typeof vi.fn>; canShare?: ReturnType<typeof vi.fn> }, secure = true) {
  const buttons = new Map<string, { hidden: boolean; disabled: boolean; textContent: string; addEventListener: ReturnType<typeof vi.fn>; setAttribute: ReturnType<typeof vi.fn> }>();
  for (const id of ["share-setup", "copy-setup", "mobile-install-toggle"]) buttons.set(id, {
    hidden: false, disabled: false, textContent: "", addEventListener: vi.fn(), setAttribute: vi.fn(),
  });
  const status = { textContent: "" };
  const actions = { append: vi.fn() };
  const separator = { hidden: false };
  runInNewContext(code, {
    navigator, isSecureContext: secure, setupLink: payload.url, handoffStatus: status,
    setTimeout, clearTimeout, installDetails: { open: false, addEventListener: vi.fn() },
    document: {
      getElementById: (id: string) => buttons.get(id),
      querySelector: (selector: string) => selector === ".handoff-actions" ? actions : separator,
    },
  });
  const button = buttons.get("share-setup")!;
  const click = button.addEventListener.mock.calls.find(([event]) => event === "click")![1] as () => Promise<void>;
  return { button, click, status, actions, separator, copy: buttons.get("copy-setup")! };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("native setup-link sharing", () => {
  it("passes the canonical public link directly to the native API before any async wait", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    const f = fixture({ share, canShare });
    expect(f.button.hidden).toBe(false);
    expect(canShare).toHaveBeenCalledWith(payload);
    const pending = f.click();
    expect(share).toHaveBeenCalledWith(payload);
    await pending;
    expect(f.status.textContent).toBe("Setup link shared. Open it on your computer to get started.");
    vi.advanceTimersByTime(10000);
    expect(f.status.textContent).toBe("");
  });

  it("supports older native-share browsers without canShare", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const f = fixture({ share });
    expect(f.button.hidden).toBe(false);
    await f.click();
    expect(share).toHaveBeenCalledOnce();
  });

  it.each(["missing", "insecure", "rejected", "throws"])("promotes Copy Setup Link when sharing is %s", (reason) => {
    const f = fixture({
      ...(reason !== "missing" && { share: vi.fn() }),
      canShare: reason === "throws" ? vi.fn(() => { throw new Error("Policy"); }) : vi.fn(() => reason !== "rejected"),
    }, reason !== "insecure");
    expect(f.button.hidden).toBe(true);
    expect(f.actions.append).toHaveBeenCalledWith(f.copy);
    expect(f.separator.hidden).toBe(true);
  });

  it("ignores double taps until the native sheet closes", async () => {
    let finish!: () => void;
    const share = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const f = fixture({ share });
    const first = f.click();
    expect(f.button.disabled).toBe(true);
    await f.click();
    expect(share).toHaveBeenCalledOnce();
    finish();
    await first;
    expect(f.button.disabled).toBe(false);
  });

  it("silently handles cancellation and restores the button", async () => {
    const f = fixture({ share: vi.fn().mockRejectedValue({ name: "AbortError" }) });
    await f.click();
    expect(f.status.textContent).toBe("");
    expect(f.button.disabled).toBe(false);
  });

  it("keeps a blocked-sharing error visible for the copy fallback", async () => {
    const f = fixture({ share: vi.fn().mockRejectedValue({ name: "NotAllowedError" }) });
    await f.click();
    vi.advanceTimersByTime(30000);
    expect(f.status.textContent).toBe("Couldn’t share the link. Try Copy Setup Link instead.");
    expect(f.button.disabled).toBe(false);
  });
});
