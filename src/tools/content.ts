import { z } from "zod";
import { client } from "../client.js";
import { courseParams, resolveCourse } from "../courseResolver.js";
import {
  marshalContentModule,
  marshalToc,
  marshalTopic,
  type RawContentModule,
  type RawTocModule,
  type RawTopic,
} from "../utils/marshal.js";
import { json, type Tool } from "./types.js";

export const getCourseContent: Tool = {
  name: "get_course_content",
  description:
    "Search Brightspace (D2L or Avenue to Learn) for the student's lecture slides or class notes by course code, week, or lecture number. Call this first for course requests like 'quiz me on my 3BB4 week 7 slides', 'find the week 5 slides', or 'explain lecture 30'. Supply the course code when given. With no IDs, get the outline. Use moduleId for a section or topicId for a file URL, then use download_file to read it.",
  schema: {
    ...courseParams,
    moduleId: z.coerce.number().optional().describe("Open one module/section from the outline"),
    topicId: z.coerce.number().optional().describe("Details for one topic (lecture, file, link)"),
  },
  handler: async (args) => {
    const orgUnitId = await resolveCourse(args);
    if (args.topicId) {
      return json(marshalTopic((await client.getContentTopic(orgUnitId, args.topicId)) as RawTopic));
    }
    if (args.moduleId) {
      return json(marshalContentModule((await client.getContentModule(orgUnitId, args.moduleId)) as RawContentModule));
    }
    return json(marshalToc((await client.getContentToc(orgUnitId)) as { Modules: RawTocModule[] }));
  },
};
