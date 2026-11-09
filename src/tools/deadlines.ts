import { z } from "zod";
import { client } from "../client.js";
import { courseParams, currentCourses, listCourses, resolveCourse } from "../courseResolver.js";
import {
  isSubmitted,
  marshalAssignment,
  marshalCalendarEvents,
  marshalSubmissions,
  type RawAssignment,
  type RawCalendarEvent,
  type RawSubmission,
} from "../utils/marshal.js";
import { json, type Tool } from "./types.js";

const DAY = 24 * 60 * 60 * 1000;

export const getUpcomingDueDates: Tool = {
  name: "get_upcoming_due_dates",
  description:
    "Calendar due dates and events (assignments, quizzes, exams) sorted by date. Leave out the course to get every current course at once. Defaults to 7 days back and 30 days ahead.",
  schema: {
    ...courseParams,
    daysBack: z.coerce.number().min(0).max(120).optional().describe("Days in the past to include (default 7)"),
    daysAhead: z.coerce.number().min(0).max(180).optional().describe("Days ahead to include (default 30)"),
  },
  handler: async (args) => {
    const now = Date.now();
    const start = new Date(now - (args.daysBack ?? 7) * DAY).toISOString();
    const end = new Date(now + (args.daysAhead ?? 30) * DAY).toISOString();
    const ids =
      args.course || args.orgUnitId
        ? [await resolveCourse(args)]
        : currentCourses(await listCourses()).map((c) => c.id);

    const results = await Promise.allSettled(
      ids.map(async (id) => (await client.getMyCalendarEvents(id, start, end)) as { Objects: RawCalendarEvent[] })
    );
    const events = results.flatMap((r) => (r.status === "fulfilled" ? r.value.Objects : []));
    const failed = results.filter((r) => r.status === "rejected").length;
    const sorted = marshalCalendarEvents({ Objects: events }).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    return json(failed ? { events: sorted, note: `${failed} course(s) couldn't be loaded` } : sorted);
  },
};

export const getAssignments: Tool = {
  name: "get_assignments",
  description:
    'Assignments (dropbox folders) in one course with due dates and whether you submitted each one. Pass assignmentId for full instructions, attachments, your submitted files, grade and feedback. Use for "did I submit lab 4?" or "what does assignment 2 ask for?".',
  schema: {
    ...courseParams,
    assignmentId: z.coerce.number().optional().describe("Assignment ID from the list, for full details and your submission"),
  },
  handler: async (args) => {
    const orgUnitId = await resolveCourse(args);
    if (args.assignmentId) {
      const [folder, submissions] = await Promise.all([
        client.getDropboxFolder(orgUnitId, args.assignmentId) as Promise<RawAssignment>,
        client.getDropboxSubmissions(orgUnitId, args.assignmentId) as Promise<RawSubmission[]>,
      ]);
      return json({ ...marshalAssignment(folder), submissions: marshalSubmissions(submissions) });
    }

    const folders = (await client.getDropboxFolders(orgUnitId)) as Array<RawAssignment & { IsHidden?: boolean }>;
    const visible = folders.filter((f) => !f.IsHidden);
    const list = await Promise.all(
      visible.map(async (folder) => {
        const { instructions: _, ...summary } = marshalAssignment(folder);
        try {
          const subs = (await client.getDropboxSubmissions(orgUnitId, folder.Id)) as RawSubmission[];
          return { ...summary, submitted: subs.some(isSubmitted) };
        } catch {
          return { ...summary, submitted: null };
        }
      })
    );
    return json(list);
  },
};
