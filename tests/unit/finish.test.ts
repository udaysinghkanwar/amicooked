import { describe, expect, it } from "vitest";
import { finishMessage } from "../../src/cli/setup.js";

describe("finishMessage", () => {
  it("lists every app's next step and says done when one is ready", () => {
    const m = finishMessage([
      { app: "Claude Desktop", next: "set up, and opening now. Ask it: am I cooked?", ready: true },
      { app: "ChatGPT app", next: "install the ChatGPT app from https://chatgpt.com/download, then run `amicooked setup` again.", ready: false },
    ]);
    expect(m.steps).toBe(
      "Claude Desktop: set up, and opening now. Ask it: am I cooked?\nChatGPT app: install the ChatGPT app from https://chatgpt.com/download, then run `amicooked setup` again."
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
