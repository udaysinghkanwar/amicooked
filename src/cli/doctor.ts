import { checkMcp } from "../clients/check.js";
import { geminiConfigPath, geminiEntry, type GeminiClient } from "../clients/gemini.js";

export async function doctorCommand(clients?: string, live = false): Promise<number> {
  const targets = clients ? [...new Set(clients.split(",").map((s) => s.trim().toLowerCase()).map((s) => s === "gemini" ? "gemini-desktop" : s))] : ["gemini-desktop", "gemini-cli"];
  if (targets.some((s) => s !== "gemini-desktop" && s !== "gemini-cli")) {
    console.error("Use --clients gemini-desktop or --clients gemini-cli.");
    return 1;
  }
  let checked = 0;
  let failed = false;
  for (const target of targets as GeminiClient[]) {
    try {
      const entry = geminiEntry(target);
      if (!entry && !clients) continue;
      if (!entry) throw new Error(`No enabled local Am I Cooked server in ${geminiConfigPath(target)}. Run setup --clients ${target}.`);
      const result = await checkMcp(entry, live);
      checked++;
      console.log(`${target}: MCP handshake, usage instructions and ${result.tools} read-only tools verified${live ? "; school access verified" : ""}.`);
      console.log("This tests the configured server process. Reload Gemini and ask 'am I cooked?' to verify the host/account too.");
    } catch (error) {
      failed = true;
      console.error(`${target}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!checked && !failed) console.error("No Gemini connection configured. Run amicooked setup --clients gemini-desktop or --clients gemini-cli.");
  return failed || !checked ? 1 : 0;
}
