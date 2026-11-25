#!/usr/bin/env node
import "./validationRuntime.js";
import { serveGeminiLocal } from "./clients/geminiLocal.js";
import { parseArgs } from "util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loginCommand, pairCommand, statusCommand, uninstallCommand } from "./cli/manage.js";
import { finishAfterQuit } from "./cli/afterQuit.js";
import { serveCommand } from "./cli/serve.js";
import { doctorCommand } from "./cli/doctor.js";
import { setup } from "./cli/setup.js";
import { serverInstructions } from "./instructions.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";
import { automaticUpdateCommand, maybeStartAutomaticUpdate } from "./cli/autoUpdate.js";
import { updateCommand } from "./cli/update.js";
import { featuresCommand } from "./features.js";
import { refreshSkills } from "./skills.js";

const HELP = `Am I Cooked ${VERSION}: ask your AI about your D2L Brightspace courses.

Usage: amicooked <command>

  setup        Pick your school, sign in, and connect your AI apps
               --school <id|url>       e.g. mcmaster, or the URL you log in through
               --clients <list>        desktop,code,chatgpt-desktop,gemini
               --yes                   accept the detected apps without asking
               --skill-dir <folder>    install full skill for another local AI client
               --clients none          skip automatic client configuration
  login        Sign in to your school again
  status       Show what's set up (--json for machines)
  doctor       Test the Gemini connection (--live for school access)
  update       Update the app and installed skills (--check to only check; --json)
  auto-update  Manage automatic patch updates: enable|disable|status|check-if-due
  features     List available features; features <id> reads a guide (--json)
  uninstall    Disconnect your AI apps (--purge also deletes your login and settings)
  mcp          Run the MCP server over stdio (AI apps run this for you)
`;

async function runMcp(): Promise<number> {
  // stdout carries the protocol; a library logging there would corrupt it
  console.log = console.error;
  maybeStartAutomaticUpdate();
  const server = createServer({ instructions: serverInstructions() });
  await server.connect(new StdioServerTransport());
  // Keep running until the AI app closes stdin
  return new Promise<number>(() => {});
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      school: { type: "string" },
      clients: { type: "string" },
      yes: { type: "boolean", short: "y" },
      "no-login": { type: "boolean" },
      json: { type: "boolean" },
      live: { type: "boolean" },
      purge: { type: "boolean" },
      quick: { type: "boolean" },
      local: { type: "boolean" },
      port: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      check: { type: "boolean" },
      "skill-dir": { type: "string" },
    },
  });

  if (values.version) return console.log(VERSION), 0;
  const command = positionals[0] ?? (process.stdin.isTTY ? "help" : "mcp");
  if (values.help || command === "help") return console.log(HELP), 0;

  switch (command) {
    case "gemini-serve":
      return serveGeminiLocal();
    case "mcp":
      return runMcp();
    case "setup":
      return setup({ school: values.school, clients: values.clients, yes: values.yes, login: !values["no-login"], skillDir: values["skill-dir"] });
    case "auto-update":
      return automaticUpdateCommand(positionals[1], values.json);
    case "update":
      return updateCommand({ check: values.check, json: values.json });
    case "features":
      return featuresCommand(positionals[1], values.json);
    case "refresh-skills":
      // Used by the new release after an update. No login, client config changes or app restarts.
      console.log(JSON.stringify(refreshSkills()));
      return 0;
    case "login":
      return loginCommand();
    case "pair":
      return pairCommand();
    case "serve":
      // --quick (a throwaway trycloudflare URL) and --local are for development
      return serveCommand({ quick: values.quick, local: values.local, port: values.port ? Number(values.port) : undefined });
    case "doctor":
      return doctorCommand(Boolean(values.live));
    case "status":
      return statusCommand(Boolean(values.json));
    case "finish-after-quit":
      // Hidden: setup starts this in the background when it can't restart Claude Desktop itself
      return finishAfterQuit();
    case "uninstall":
      return uninstallCommand(Boolean(values.purge));
    default:
      console.error(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
);
