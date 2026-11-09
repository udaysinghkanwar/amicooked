import * as path from "path";

export interface LaunchCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface Runtime {
  execPath: string;
  argv: string[];
  platform: NodeJS.Platform;
  isCompiled: boolean;
}

function currentRuntime(): Runtime {
  // Bun-compiled binaries run their bundled script from a virtual /$bunfs (B:/~BUN on Windows) path
  const script = process.argv[1] ?? "";
  const isCompiled = script.includes("$bunfs") || script.includes("~BUN");
  return { execPath: process.execPath, argv: process.argv, platform: process.platform, isCompiled };
}

/**
 * How an AI app should start this same install of Am I Cooked, plus `extraArgs`.
 * Configs must keep working after this process exits, so npx's temporary cache
 * is never referenced directly.
 */
export function selfCommand(extraArgs: string[], rt: Runtime = currentRuntime()): LaunchCommand {
  if (rt.isCompiled) return { command: rt.execPath, args: extraArgs };

  const script = rt.argv[1] ?? "";
  const viaNpx = /[\\/]_npx[\\/]/.test(script);
  if (!viaNpx) return { command: rt.execPath, args: [script, ...extraArgs] };

  const pkg = ["-y", "amicooked@0", ...extraArgs];
  if (rt.platform === "win32") return { command: "cmd", args: ["/c", "npx", ...pkg] };
  // GUI apps don't inherit the shell's PATH (nvm, Homebrew), and npx's shebang needs `node` on it
  const binDir = path.dirname(rt.execPath);
  return { command: path.join(binDir, "npx"), args: pkg, env: { PATH: `${binDir}:/usr/bin:/bin` } };
}
