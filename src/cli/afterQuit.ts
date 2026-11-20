import { spawn } from "child_process";
import { APPS, isRunning, open } from "../clients/apps.js";
import { claudeDesktopDir, installClaudeDesktop } from "../clients/claudeDesktop.js";
import { selfCommand } from "../clients/self.js";

// When setup runs inside Claude Desktop (an agent in it, say), it can't quit the app without ending that
// session, and Claude Desktop would save over our config when it quits anyway. So setup leaves this
// running in the background: it waits for the student to quit Claude, writes the config again, and
// reopens Claude, so one Cmd+Q finishes the job.

const POLL_MS = 2000;
const GIVE_UP_MS = 12 * 60 * 60 * 1000;

/** Starts the background helper, detached so it outlives setup. */
export function scheduleAfterQuit(): boolean {
  try {
    const self = selfCommand(["finish-after-quit"]);
    const child = spawn(self.command, self.args, {
      stdio: "ignore",
      detached: true,
      env: { ...process.env, ...self.env },
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export interface AfterQuitSteps {
  running: () => boolean;
  write: () => void;
  reopen: () => void;
  wait: (ms: number) => Promise<void>;
  now: () => number;
}

/** The hidden `finish-after-quit` command the helper runs. */
export async function finishAfterQuit(steps: AfterQuitSteps | null = defaultSteps()): Promise<number> {
  if (!steps) return 1;
  const end = steps.now() + GIVE_UP_MS;
  while (steps.running()) {
    if (steps.now() > end) return 1;
    await steps.wait(POLL_MS);
  }
  // Give the app a moment to finish writing its own copy before ours goes on top
  await steps.wait(1500);
  steps.write();
  steps.reopen();
  return 0;
}

function defaultSteps(): AfterQuitSteps | null {
  const dir = claudeDesktopDir();
  if (!dir) return null;
  return {
    running: () => isRunning(APPS.claude),
    write: () => installClaudeDesktop(dir, selfCommand(["mcp"])),
    reopen: () => void open(APPS.claude),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}
