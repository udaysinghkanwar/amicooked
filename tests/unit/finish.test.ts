import { describe, expect, it } from "vitest";
import { finishMessage, setupPromptNotes } from "../../src/cli/setup.js";

describe("finishMessage", () => {
  it("lists every app's next step and says done when one is ready", () => {
    const m = finishMessage([
      { app: "Claude Desktop", next: "set up, and opening now.", ready: true },
      { app: "ChatGPT app", next: "install the ChatGPT app from https://chatgpt.com/download, then run `amicooked setup` again.", ready: false },
    ]);
    expect(m.steps).toBe(
      "Claude Desktop: set up, and opening now.\nChatGPT app: install the ChatGPT app from https://chatgpt.com/download, then run `amicooked setup` again."
    );
    expect(m.outro).toBe("You're set.");
  });

  it("says what's left when nothing is ready yet", () => {
    expect(finishMessage([{ app: "Claude Desktop", next: "quit it, then run setup again.", ready: false }]).outro).toMatch(/Almost there/);
  });

  it("points to the downloads when no app was set up", () => {
    const m = finishMessage([]);
    expect(m.steps).toBeNull();
    expect(m.outro).toContain("https://claude.ai/download");
    expect(m.outro).toContain("https://chatgpt.com/download");
  });
});

describe("setupPromptNotes", () => {
  it.each([false, true])("hides all suggestions without a connected app (video ready: %s)", (ready) => {
    expect(setupPromptNotes(false, true, ready)).toEqual([]);
    expect(setupPromptNotes(false, false, ready)).toEqual([]);
  });

  it("keeps starter prompts when login was skipped, without advertising video access", () => {
    const notes = setupPromptNotes(true, false, true);
    expect(notes.map((n) => n.title)).toEqual(["Try asking your AI"]);
    expect(notes[0].text).toContain("Am I cooked?");
  });

  it("keeps course suggestions if video preparation was skipped or failed", () => {
    expect(setupPromptNotes(true, true, false).map((n) => n.title)).toEqual(["Try asking your AI"]);
  });

  it("offers video prompts only with an app, verified login and ready tools", () => {
    const notes = setupPromptNotes(true, true, true);
    expect(notes.map((n) => n.title)).toEqual(["Try asking your AI", "Try asking for a lecture video"]);
    expect(notes[1].text).toContain("in one of my courses");
    expect(notes[1].text).not.toContain("[course]");
  });
});

describe("finishAfterQuit", () => {
  it("waits for Claude to quit, then writes the config and reopens it", async () => {
    const { finishAfterQuit } = await import("../../src/cli/afterQuit.js");
    const log: string[] = [];
    let polls = 0;
    let clock = 0;
    const code = await finishAfterQuit({
      running: () => (log.push("check"), ++polls < 3),
      write: () => log.push("write"),
      reopen: () => log.push("reopen"),
      wait: async (ms) => void (clock += ms),
      now: () => clock,
    });
    expect(code).toBe(0);
    expect(log).toEqual(["check", "check", "check", "write", "reopen"]);
  });

  it("gives up without writing if Claude is never quit", async () => {
    const { finishAfterQuit } = await import("../../src/cli/afterQuit.js");
    let clock = 0;
    const log: string[] = [];
    const code = await finishAfterQuit({
      running: () => true,
      write: () => log.push("write"),
      reopen: () => log.push("reopen"),
      wait: async (ms) => void (clock += ms * 1000),
      now: () => clock,
    });
    expect(code).toBe(1);
    expect(log).toEqual([]);
  });
});
