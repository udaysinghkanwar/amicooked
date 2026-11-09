import { z } from "zod";
import { client } from "./client.js";
import type { RawEnrollment } from "./utils/marshal.js";

export interface Course {
  id: number;
  name: string;
  code: string;
  isActive: boolean;
  lastAccessed: string | null;
  endDate: string | null;
  pinned: boolean;
}

/** Zod fields every per-course tool accepts: a course code/name, or the D2L org unit ID. */
export const courseParams = {
  course: z.string().optional().describe('Course code or name, e.g. "3BB4" or "Software Design". Preferred over orgUnitId.'),
  orgUnitId: z.coerce.number().optional().describe("D2L org unit ID of the course, if you already have it"),
};

const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; courses: Course[] } | null = null;

type RawWithDates = RawEnrollment & { Access: RawEnrollment["Access"] & { EndDate?: string | null }; PinDate?: string | null };

/** Course offerings the student can open, cached for a few minutes. */
export async function listCourses(): Promise<Course[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.courses;
  const { Items } = (await client.getMyEnrollments()) as { Items: RawWithDates[] };
  const courses = Items.filter((e) => e.OrgUnit.Type.Code === "Course Offering" && e.Access.CanAccess).map((e) => ({
    id: e.OrgUnit.Id,
    name: e.OrgUnit.Name,
    code: e.OrgUnit.Code,
    isActive: e.Access.IsActive,
    lastAccessed: e.Access.LastAccessed,
    endDate: e.Access.EndDate ?? null,
    pinned: Boolean(e.PinDate),
  }));
  cache = { at: Date.now(), courses };
  return courses;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * This term's courses: active, not ended more than two weeks ago, and pinned or opened
 * in the last four months. D2L often leaves EndDate empty, so recency does most of the work.
 */
export function currentCourses(courses: Course[], now = Date.now()): Course[] {
  const active = courses.filter((c) => c.isActive && (!c.endDate || Date.parse(c.endDate) > now - 14 * DAY));
  const recent = active.filter((c) => c.pinned || (c.lastAccessed && Date.parse(c.lastAccessed) > now - 120 * DAY));
  return recent.length ? recent : active;
}

export function clearCourseCache(): void {
  cache = null;
}

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Courses matching `query`: exact ID, then a code token like "3BB4", then a name substring. */
export function matchCourses(courses: Course[], query: string): Course[] {
  const q = query.trim().toLowerCase();
  if (/^\d+$/.test(q)) {
    const byId = courses.filter((c) => String(c.id) === q);
    if (byId.length) return byId;
  }
  const qTokens = tokens(q);
  const byCode = courses.filter((c) => {
    const codeTokens = [...tokens(c.code), ...tokens(c.name)];
    return qTokens.every((t) => codeTokens.includes(t));
  });
  if (byCode.length) return byCode;
  return courses.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
}

/** Resolve a tool's `course` / `orgUnitId` arguments to one org unit ID. */
export async function resolveCourse(args: { course?: string; orgUnitId?: number }): Promise<number> {
  if (args.orgUnitId) return args.orgUnitId;
  if (!args.course) throw new Error('Say which course, e.g. course: "3BB4". Use get_my_courses to list them.');

  const matches = matchCourses(await listCourses(), args.course);
  // Prefer current courses when an old offering of the same course also matches
  const active = matches.filter((c) => c.isActive);
  const pool = active.length ? active : matches;
  if (pool.length === 1) return pool[0].id;
  if (pool.length === 0) throw new Error(`No course matches "${args.course}". Use get_my_courses to list them.`);
  const list = pool.slice(0, 8).map((c) => `${c.code} (${c.name}, id ${c.id})`).join("; ");
  throw new Error(`"${args.course}" matches several courses: ${list}. Use a more specific code or the orgUnitId.`);
}
