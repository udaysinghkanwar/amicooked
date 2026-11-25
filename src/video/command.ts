import { spawnSync } from "node:child_process";
import path from "node:path";
import { writeConfig } from "../config.js";
import { getVideoTools, prepareVideo, videoEnvironment, videoStatus } from "./runtime.js";

export async function videoCommand([action = "status", ...args]: string[]) {
  switch (action) {
    case "status":
      console.log(JSON.stringify(videoStatus()));
      return 0;
    case "prepare":
      if (args.length) throw new Error("Use amicooked video prepare.");
      console.log(JSON.stringify(await prepareVideo()));
      writeConfig({ prepareVideo: true });
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
