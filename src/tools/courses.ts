import { client } from "../client.js";
import { courseParams, listCourses, resolveCourse } from "../courseResolver.js";
import { marshalAnnouncements, marshalGrades, type RawAnnouncement, type RawGrade } from "../utils/marshal.js";
import { json, type Tool } from "./types.js";

export const getMyCourses: Tool = {
  name: "get_my_courses",
  description:
    'List the courses you can open, with code, name, ID and whether they are active. Other tools take a course code like "3BB4" directly, so you only need this to see what exists or to settle an ambiguous code.',
  schema: {},
  handler: async () => json(await listCourses()),
};

export const getMyGrades: Tool = {
  name: "get_my_grades",
  description:
    'Your grade items for one course: item name, points earned and possible, percentage and instructor feedback. Use for "what did I get on the midterm?" or "what\'s my grade in 3BB4?". For an overview across all courses, use am_i_cooked.',
  schema: { ...courseParams },
  handler: async (args) => {
    const grades = (await client.getMyGradeValues(await resolveCourse(args))) as RawGrade[];
    return json(marshalGrades(grades));
  },
};

export const getAnnouncements: Tool = {
  name: "get_announcements",
  description:
    "Announcements (news) your instructors posted in one course: title, body, date, attachments. Check these before giving a verdict, since deadlines and exam details often change here.",
  schema: { ...courseParams },
  handler: async (args) => {
    const news = (await client.getNews(await resolveCourse(args))) as RawAnnouncement[];
    return json(marshalAnnouncements(news));
  },
};
