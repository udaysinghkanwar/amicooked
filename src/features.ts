import { z } from "zod";
import { SKILL_FILES } from "./skill.js";
import { VERSION } from "./version.js";
import type { Tool } from "./tools/types.js";

// Add one entry and its reference when shipping a feature. Dependencies remain optional.
export const FEATURES = [
  { id: "courses", name: "Course planning", description: "Grades, deadlines, announcements and course files.", requires: "A Brightspace login.", guide: "references/courses.md" },
  { id: "lecture-videos", name: "Lecture videos", description: "Source-grounded narrated lessons and local study players.", requires: "Local command and file access. Setup prepares the managed video tools.", guide: "references/lecture-videos.md" },
  { id: "updates", name: "Updates", description: "Update the app and skills, manually or with automatic patch updates.", requires: "An installed app with local command access.", guide: "references/updates.md" },
  { id: "setup", name: "Setup", description: "Connect your school and AI apps.", requires: "Local command access and Chrome or Edge.", guide: "references/setup.md" },
] as const;

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
  description: "List shipped Am I Cooked features, or read one feature's bundled guide. No network, setup or updates are performed.",
  schema: { feature: z.enum(FEATURES.map(f => f.id) as [string, ...string[]]).optional() },
  handler: async ({ feature }: { feature?: string }) => JSON.stringify(featureInfo(feature), null, 2),
};
