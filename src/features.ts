import { z } from "zod";
import catalog from "./feature-catalog.json" with { type: "json" };
import { SKILL_FILES } from "./skill.js";
import { VERSION } from "./version.js";
import { videoStatus } from "./video/runtime.js";
import type { Tool } from "./tools/types.js";

type Feature = {
  name: string;
  description: string;
  requests: string;
  requires: string;
  guide: string;
  mcpTool?: string;
};

// Add a catalog entry and a guide to expose a workflow to the skill, MCP and CLI.
const featureCatalog: Record<string, Feature> = catalog;
export const FEATURES = Object.entries(featureCatalog).map(([id, feature]) => ({ id, ...feature }));

export function featureInfo(id?: string) {
  if (!id) return { version: VERSION, features: FEATURES };
  const feature = FEATURES.find(f => f.id === id);
  if (!feature) throw new Error(`Unknown feature: ${id}. Run \`amicooked features\` to list them.`);
  return {
    version: VERSION, ...feature, instructions: SKILL_FILES[feature.guide],
  };
}

export function featuresCommand(id?: string, json = false): number {
  const info = featureInfo(id);
  if (json) console.log(JSON.stringify(info, null, 2));
  else if ("instructions" in info) {
    console.log(`${info.name} · Am I Cooked ${VERSION}\n\n${info.instructions}`);
  } else {
    console.log(`Am I Cooked ${VERSION}\n`);
    for (const f of info.features) console.log(`${f.id}: ${f.description}\n  Needs: ${f.requires}`);
    console.log("\nRead a guide: amicooked features <id>");
  }
  return 0;
}

export const getFeatureGuide: Tool = {
  name: "get_feature_guide",
  description: "List Am I Cooked features or read a workflow guide, including lecture videos with the managed local renderer and narration. For a video request, get_lecture_video_workflow also checks tool readiness.",
  schema: { feature: z.enum(FEATURES.map(f => f.id) as [string, ...string[]]).optional() },
  handler: async ({ feature }: { feature?: string }) => JSON.stringify(featureInfo(feature), null, 2),
};

const videoNextStep = {
  ready: "Use the managed HyperFrames renderer, Kokoro narration and FFmpeg through amicooked video run.",
  previous: "Run amicooked video prepare to update the tools. Use the verified previous tools if that fails.",
  missing: "Run amicooked video prepare on the Am I Cooked computer, then check video status again.",
  unsupported: "Explain that the managed video tools are unavailable on this platform. Offer source-linked notes or a storyboard.",
};

export const getLectureVideoWorkflow: Tool = {
  name: catalog["lecture-videos"].mcpTool,
  description: `Start here for ${catalog["lecture-videos"].requests}. Returns the Am I Cooked workflow and checks whether its managed HyperFrames, Kokoro and FFmpeg tools are ready.`,
  schema: {},
  handler: async () => {
    const videoTools = videoStatus();
    return JSON.stringify({
      ...featureInfo("lecture-videos"),
      videoTools,
      nextStep: videoNextStep[videoTools.state],
      execution: "Status describes the computer running Am I Cooked. Use local commands on that computer and a writable folder. If setup used npx, use npx -y amicooked@0 in place of amicooked.",
    }, null, 2);
  },
};
