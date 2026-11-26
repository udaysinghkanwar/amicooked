import { spawnSync } from "node:child_process";
import { stripVTControlCharacters, styleText } from "node:util";
import path from "node:path";
import { log } from "@clack/prompts";
import { isNpxRuntime } from "../clients/self.js";
import { getConfig } from "../config.js";
import { getVideoTools, prepareVideo, videoEnvironment, videoStatus } from "./runtime.js";

export async function prepareVideoSafely({ force = false, humanOutput = false } = {}) {
  const config = getConfig();
  if (!force && (!config.school || config.uninstalled || config.prepareVideo === false)) return;
  const { state } = videoStatus();
  if (state === "ready" || state === "unsupported") return;
  const print = humanOutput ? console.log : console.error;
  try {
    await prepareVideo(print);
    if (humanOutput) log.success(styleText("green", "Lecture video tools are ready."));
    else print("Lecture video tools are ready.");
  } catch (error) {
    const retry = isNpxRuntime() ? "npx -y amicooked@0 video prepare" : "amicooked video prepare";
    const message = stripVTControlCharacters(error instanceof Error ? error.message : String(error));
    print(`Lecture video setup could not finish: ${message}\nCourse tools still work. Check your internet connection and run ${retry} to retry.`);
  }
}

export async function videoCommand([action = "status", ...args]: string[]) {
  switch (action) {
    case "status":
      console.log(JSON.stringify(videoStatus()));
      return 0;
    case "prepare":
      if (args.length) throw new Error("Use amicooked video prepare.");
      console.log(JSON.stringify(await prepareVideo()));
      return 0;
    case "run": {
      const [tool, separator, ...toolArgs] = args;
      if (separator !== "--" || !["hyperframes", "ffmpeg", "ffprobe", "voice"].includes(tool)) {
        throw new Error("Use amicooked video run <hyperframes|ffmpeg|ffprobe|voice> -- <arguments>.");
      }
      const tools = getVideoTools();
      if (tool === "voice" && toolArgs.length !== 2) throw new Error("Voice arguments: narration.txt output.wav.");
      const command = tool === "ffmpeg" || tool === "ffprobe" ? tools[tool] : tools.node;
      const argv = tool === "voice"
        ? [tools.voice, tools.model, ...toolArgs.map(file => path.resolve(file))]
        : tool === "hyperframes" ? [tools.hyperframes, ...toolArgs] : toolArgs;
      const result = spawnSync(command, argv, { env: videoEnvironment(tools), stdio: "inherit" });
      if (result.error) throw result.error;
      return result.status ?? 1;
    }
    default:
      throw new Error("Use amicooked video status, prepare, or run.");
  }
}
