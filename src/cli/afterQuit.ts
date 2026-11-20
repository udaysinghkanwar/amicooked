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

/** The hidden `finish-after-quit` command the helper runs. */
export async function finishAfterQuit(): Promise<number> {
  const dir = claudeDesktopDir();
  if (!dir) return 1;
  for (const end = Date.now() + GIVE_UP_MS; isRunning(APPS.claude); ) {
    if (Date.now() > end) return 1;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  // Give the app a moment to finish writing its own copy before ours goes on top
  await new Promise((resolve) => setTimeout(resolve, 1500));
  installClaudeDesktop(dir, selfCommand(["mcp"]));
  open(APPS.claude);
  return 0;
}
