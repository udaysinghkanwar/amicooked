import { spawnSync } from "node:child_process";
import path from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { getVideoTools, prepareVideo, videoEnvironment, videoStatus } from "./runtime.js";

export async function chooseVideoPreparation(options: { requested?: boolean; prompt?: boolean; upgrading?: boolean }) {
  const { state } = videoStatus();
  if (state === "unsupported" || (state === "ready" && !options.upgrading)) return false;
  if (options.requested) return true;
  if (!options.prompt || !process.stdin.isTTY || !process.stdout.isTTY) return false;
  const choice = await confirm({
    message: "Set up the lecture-video tools now? Downloads require internet and roughly 1–2 GB of disk space.",
    initialValue: false,
  });
  return !isCancel(choice) && choice;
}

export async function prepareVideoSafely() {
  try {
    await prepareVideo();
    console.error("Lecture video tools are ready.");
  } catch (error) {
    console.error(`Lecture video setup could not finish: ${error instanceof Error ? error.message : String(error)}\nRun amicooked video prepare to retry.`);
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
