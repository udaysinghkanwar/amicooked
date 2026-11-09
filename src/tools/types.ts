import type { ZodTypeAny } from "zod";

export interface Tool {
  name: string;
  description: string;
  schema: Record<string, ZodTypeAny>;
  handler: (args: any) => Promise<string>;
  /** Reads or writes local files, so it isn't offered to remote clients like ChatGPT. */
  localOnly?: boolean;
}

export const json = (value: unknown) => JSON.stringify(value, null, 2);
