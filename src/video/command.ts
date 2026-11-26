import { spawnSync } from "node:child_process";
import { parseArgs, stripVTControlCharacters, styleText } from "node:util";
import path from "node:path";
import { log } from "@clack/prompts";
import { isNpxRuntime } from "../clients/self.js";
import { getConfig } from "../config.js";
import { getVideoTools, prepareVideo, probeVideo, videoEnvironment, videoStatus } from "./runtime.js";
import { videoEntry, videoProject, videoScratch } from "./workspace.js";

const workspaceOptions = { project: { type: "string" }, scratch: { type: "string" } } as const;

export async function prepareVideoSafely({ force = false, humanOutput = false } = {}): Promise<boolean> {
  const config = getConfig();
  if (!force && (!config.school || config.uninstalled || config.prepareVideo === false)) return false;
  const { state } = videoStatus();
  if (state === "ready") return true;
  if (state === "unsupported") return false;
  const print = humanOutput ? console.log : console.error;
  try {
    await prepareVideo(print);
    if (humanOutput) log.success(styleText("green", "Lecture video tools are ready."));
    else print("Lecture video tools are ready.");
    return true;
  } catch (error) {
    const retry = isNpxRuntime() ? "npx -y amicooked@0 video prepare" : "amicooked video prepare";
    const message = stripVTControlCharacters(error instanceof Error ? error.message : String(error));
    print(`Lecture video setup could not finish: ${message}\nCourse tools still work. Check your internet connection and run ${retry} to retry.`);
    return false;
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
    case "probe": {
      const { values } = parseArgs({ args, options: workspaceOptions });
      const result = probeVideo(values.project, values.scratch);
      console.log(JSON.stringify(result));
      return result.ok ? 0 : 1;
    }
    case "run": {
      const separator = args.indexOf("--");
      const { positionals: [tool, ...extra], values } = parseArgs({
        args: args.slice(0, separator < 0 ? args.length : separator), options: workspaceOptions, allowPositionals: true,
      });
      if (separator < 0 || extra.length || !["hyperframes", "ffmpeg", "ffprobe", "voice"].includes(tool)) {
        throw new Error("Use amicooked video run <hyperframes|ffmpeg|ffprobe|voice> [--project <folder>] [--scratch <folder>] -- <arguments>.");
      }
      const tools = getVideoTools();
      const toolArgs = args.slice(separator + 1);
      if (tool === "voice" && toolArgs.length !== 2) throw new Error("Voice arguments: narration.txt output.wav.");
      const project = videoProject(values.project);
      if (tool === "hyperframes" && values.project && ["check", "snapshot", "render"].includes(toolArgs[0]) &&
          !toolArgs.some(arg => ["--help", "-h", "--entry"].includes(arg) || arg.startsWith("--entry="))) videoEntry(project);
      const scratch = videoScratch(project, values.scratch);
      const command = tool === "ffmpeg" || tool === "ffprobe" ? tools[tool] : tools.node;
      const argv = tool === "voice"
        ? [tools.voice, tools.model, ...toolArgs.map(file => path.resolve(project, file))]
        : tool === "hyperframes" ? [tools.hyperframes, ...toolArgs] : toolArgs;
      const result = spawnSync(command, argv, { cwd: project, env: videoEnvironment(tools, scratch), stdio: "inherit" });
      if (result.error) throw result.error;
      return result.status ?? 1;
    }
    default:
      throw new Error("Use amicooked video status, prepare, probe, or run.");
  }
}
