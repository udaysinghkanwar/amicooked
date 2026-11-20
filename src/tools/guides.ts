import { LECTURE_VIDEO_GUIDE_MD } from "../skill.js";
import type { Tool } from "./types.js";

export const getLectureVideoGuide: Tool = {
  name: "get_lecture_video_guide",
  description: "Read the optional workflow before creating a lecture or study video. Returns setup, intent questions, study modes, teaching and quality guidance. Does not render media or access school data.",
  schema: {},
  handler: async () => LECTURE_VIDEO_GUIDE_MD,
};
