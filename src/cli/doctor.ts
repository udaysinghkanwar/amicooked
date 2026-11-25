import { checkMcp } from "../clients/check.js";
import { geminiConfigPath, geminiEntry } from "../clients/gemini.js";

export async function doctorCommand(live = false): Promise<number> {
  try {
    const entry = geminiEntry();
    if (!entry) throw new Error(`No enabled Am I Cooked connection in ${geminiConfigPath()}. Run setup --clients gemini.`);
    const tools = await checkMcp(entry, live);
    console.log(`Gemini: MCP handshake, usage instructions and ${tools} read-only tools verified${live ? "; school access verified" : ""}.`);
    console.log("Reload Gemini/Antigravity and ask 'am I cooked?' to verify the host/account too.");
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
