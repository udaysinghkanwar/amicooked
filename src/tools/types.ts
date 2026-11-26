import type { ZodTypeAny } from "zod";

export interface Tool {
  name: string;
  description: string;
  schema: Record<string, ZodTypeAny>;
  handler: (args: any) => Promise<string>;
  /** MCP hints for the AI app. Defaults to read-only; tools that write lesson files say so. */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

export const json = (value: unknown) => JSON.stringify(value, null, 2);
