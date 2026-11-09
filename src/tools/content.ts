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
    "A course's content: modules, lectures, readings and files with their IDs. With no IDs you get the whole outline; pass moduleId to open one section, or topicId for one item's details and URL (then use download_file to read it).",
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
