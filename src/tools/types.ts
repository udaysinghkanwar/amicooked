import type { ZodTypeAny } from "zod";

export interface Tool {
  name: string;
  description: string;
  schema: Record<string, ZodTypeAny>;
  handler: (args: any) => Promise<string>;
}

export const json = (value: unknown) => JSON.stringify(value, null, 2);
