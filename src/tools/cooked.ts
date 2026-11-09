import { z } from "zod";
import { getToken } from "../auth.js";
import { client, D2LApiError } from "../client.js";
import { currentCourses, listCourses, matchCourses, type Course } from "../courseResolver.js";
import { getSchool } from "../config.js";
import { classifyDateEvent, DateType } from "../utils/dateEvent.js";
import { isSubmitted, stripHtml, type RawCalendarEvent, type RawSubmission } from "../utils/marshal.js";
import type { Tool } from "./types.js";

const DAY = 24 * 60 * 60 * 1000;

// ---- raw D2L shapes this report reads ----

export interface RawFolder {
  Id: number;
  Name: string;
  DueDate: string | null;
  IsHidden?: boolean;
  Availability?: { StartDate: string | null; EndDate: string | null } | null;
  Assessment?: { ScoreDenominator: number | null } | null;
}

export interface RawGradeValue {
  GradeObjectName: string;
  GradeObjectType: number;
  PointsNumerator: number | null;
  PointsDenominator: number | null;
  WeightedNumerator: number | null;
  WeightedDenominator: number | null;
  DisplayedGrade: string | null;
}

interface RawNews {
  Title: string;
  StartDate: string | null;
  IsHidden?: boolean;
}

export interface CourseData {
  finalGrade: RawGradeValue | null;
  gradeItems: RawGradeValue[] | null;
  folders: Array<{ folder: RawFolder; submitted: boolean | null }> | null;
  events: RawCalendarEvent[] | null;
  news: RawNews[] | null;
  errors: Array<{ part: string; message: string }>;
}

// ---- report shape ----

export type Signal =
  | "grade_below_60"
  | "grade_below_70"
  | "overdue_work"
  | "late_window_open"
  | "heavy_week"
  | "no_grades_released"
  | "partial_data";

export interface DueItem {
  title: string;
  type: "assignment" | "quiz" | "exam" | "event";
  due: string;
  dueInHours: number;
  submitted: boolean | null;
  points?: number;
  assignmentId?: number;
}

export interface OverdueItem {
  title: string;
  due: string;
  daysLate: number;
  /** When the dropbox finally closes, if late submissions are still accepted. */
  stillOpenUntil: string | null;
  assignmentId: number;
}

export interface CourseReport {
  id: number;
  code: string;
  name: string;
  grade: { percent: number | null; display: string | null; source: "final_calculated" | "estimated_from_items" | "none"; gradedItems: number };
  dueSoon: DueItem[];
  overdue: OverdueItem[];
  announcements: { count: number; latest: Array<{ title: string; date: string }> };
  signals: Signal[];
  errors: Array<{ part: string; message: string }>;
}

export interface Window {
  now: number;
  daysAhead: number;
  overdueDaysBack: number;
  announcementsDays: number;
}

// ---- pure aggregation ----

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Grade items that count: numeric, pass/fail and select-box items with a score. */
const SCORED_TYPES = new Set([1, 2, 3]);

/** Weighted average over graded items, falling back to points when the course has no weights. */
export function estimateGrade(items: RawGradeValue[]): { percent: number | null; gradedItems: number } {
  const graded = items.filter((g) => SCORED_TYPES.has(g.GradeObjectType) && g.PointsNumerator !== null);
  const weighted = graded.filter((g) => g.WeightedNumerator !== null && g.WeightedDenominator);
  const pool = weighted.length ? weighted : graded.filter((g) => g.PointsDenominator);
  const [num, den] = pool.reduce(
    ([n, d], g) =>
      weighted.length ? [n + g.WeightedNumerator!, d + g.WeightedDenominator!] : [n + g.PointsNumerator!, d + g.PointsDenominator!],
    [0, 0]
  );
  return { percent: den ? round1((num / den) * 100) : null, gradedItems: graded.length };
}

function finalPercent(g: RawGradeValue): number | null {
  if (g.PointsNumerator !== null && g.PointsDenominator) return round1((g.PointsNumerator / g.PointsDenominator) * 100);
  const shown = g.DisplayedGrade?.match(/([\d.]+)\s*%/);
  return shown ? Number(shown[1]) : null;
}

export function buildCourseReport(course: Course, data: CourseData, w: Window): CourseReport {
  const errors = [...data.errors];
  const horizon = w.now + w.daysAhead * DAY;
  const overdueFrom = w.now - w.overdueDaysBack * DAY;

  // Grade: the released final calculated grade wins, otherwise estimate from items
  let grade: CourseReport["grade"] = { percent: null, display: null, source: "none", gradedItems: 0 };
  const estimate = data.gradeItems ? estimateGrade(data.gradeItems) : { percent: null, gradedItems: 0 };
  const final = data.finalGrade ? finalPercent(data.finalGrade) : null;
  if (final !== null) {
    grade = { percent: final, display: data.finalGrade!.DisplayedGrade?.trim() || null, source: "final_calculated", gradedItems: estimate.gradedItems };
  } else if (estimate.percent !== null) {
    grade = { percent: estimate.percent, display: `${estimate.percent}%`, source: "estimated_from_items", gradedItems: estimate.gradedItems };
  }

  // Assignments due soon, and overdue ones without a submission
  const dueSoon: DueItem[] = [];
  const overdue: OverdueItem[] = [];
  const dropboxIds = new Set<number>();
  for (const { folder, submitted } of data.folders ?? []) {
    if (folder.IsHidden) continue;
    const dueIso = folder.DueDate ?? folder.Availability?.EndDate ?? null;
    if (!dueIso) continue;
    const due = Date.parse(dueIso);
    dropboxIds.add(folder.Id);
    if (due > w.now && due <= horizon) {
      dueSoon.push({
        title: folder.Name,
        type: "assignment",
        due: dueIso,
        dueInHours: Math.round((due - w.now) / 3600000),
        submitted,
        ...(folder.Assessment?.ScoreDenominator ? { points: folder.Assessment.ScoreDenominator } : {}),
        assignmentId: folder.Id,
      });
    } else if (due <= w.now && due >= overdueFrom && submitted === false) {
      const closes = folder.Availability?.EndDate ? Date.parse(folder.Availability.EndDate) : null;
      overdue.push({
        title: folder.Name,
        due: dueIso,
        daysLate: Math.floor((w.now - due) / DAY),
        stillOpenUntil: closes && closes > w.now ? folder.Availability!.EndDate : null,
        assignmentId: folder.Id,
      });
    }
  }

  // Calendar adds quizzes and exams; dropbox events are already covered above
  for (const e of data.events ?? []) {
    const entity = e.AssociatedEntity;
    if (entity?.AssociatedEntityType.includes("Dropbox") && dropboxIds.has(entity.AssociatedEntityId)) continue;
    const due = Date.parse(e.EndDateTime);
    if (!(due > w.now && due <= horizon)) continue;
    const { dateType } = classifyDateEvent(e.Title, stripHtml(e.Description), entity?.AssociatedEntityType ?? null);
    const isQuiz = entity?.AssociatedEntityType.includes("Quiz");
    if (!isQuiz && dateType !== DateType.DUE && dateType !== DateType.EXAM) continue;
    dueSoon.push({
      title: e.Title,
      type: isQuiz ? "quiz" : dateType === DateType.EXAM ? "exam" : "event",
      due: e.EndDateTime,
      dueInHours: Math.round((due - w.now) / 3600000),
      submitted: null,
    });
  }
  dueSoon.sort((a, b) => a.due.localeCompare(b.due));

  const since = w.now - w.announcementsDays * DAY;
  const recentNews = (data.news ?? [])
    .filter((n) => !n.IsHidden && n.StartDate && Date.parse(n.StartDate) >= since)
    .sort((a, b) => b.StartDate!.localeCompare(a.StartDate!));

  const signals: Signal[] = [];
  if (grade.percent !== null && grade.percent < 60) signals.push("grade_below_60");
  else if (grade.percent !== null && grade.percent < 70) signals.push("grade_below_70");
  if (overdue.length) signals.push("overdue_work");
  if (overdue.some((o) => o.stillOpenUntil)) signals.push("late_window_open");
  if (dueSoon.length >= 3) signals.push("heavy_week");
  if (grade.source === "none") signals.push("no_grades_released");
  if (errors.length) signals.push("partial_data");

  return {
    id: course.id,
    code: course.code,
    name: course.name,
    grade,
    dueSoon,
    overdue,
    announcements: { count: recentNews.length, latest: recentNews.slice(0, 3).map((n) => ({ title: n.Title, date: n.StartDate! })) },
    signals,
    errors,
  };
}

export const HEAT_LABELS = ["raw", "warming up", "toasty", "cooked", "well done"] as const;

/**
 * 0-10: +2 per unsubmitted overdue item, +1 per unsubmitted item due within 72h,
 * +3/+2/+1 for a grade under 50/60/70.
 */
export function heatScore(reports: CourseReport[]): { heat: number; heatLabel: (typeof HEAT_LABELS)[number]; reasons: string[] } {
  let heat = 0;
  const reasons: string[] = [];
  for (const r of reports) {
    if (r.overdue.length) {
      heat += 2 * r.overdue.length;
      reasons.push(`${r.overdue.length} overdue in ${r.code}`);
    }
    const urgent = r.dueSoon.filter((d) => d.dueInHours <= 72 && d.submitted !== true);
    if (urgent.length) {
      heat += urgent.length;
      reasons.push(`${urgent.length} due within 3 days in ${r.code}`);
    }
    const p = r.grade.percent;
    if (p !== null && p < 70) {
      heat += p < 50 ? 3 : p < 60 ? 2 : 1;
      reasons.push(`${p}% in ${r.code}`);
    }
  }
  heat = Math.min(heat, 10);
  const heatLabel = heat === 0 ? "raw" : heat <= 2 ? "warming up" : heat <= 5 ? "toasty" : heat <= 8 ? "cooked" : "well done";
  return { heat, heatLabel, reasons };
}

// ---- fetching ----

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function part<T>(name: string, errors: CourseData["errors"], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    errors.push({ part: name, message: errorMessage(error).slice(0, 160) });
    return null;
  }
}

async function fetchCourseData(course: Course, w: Window): Promise<CourseData> {
  const errors: CourseData["errors"] = [];
  const start = new Date(w.now - w.overdueDaysBack * DAY).toISOString();
  const end = new Date(w.now + w.daysAhead * DAY).toISOString();

  const [finalGrade, gradeItems, folders, events, news] = await Promise.all([
    part("final_grade", errors, async () => {
      try {
        return (await client.getMyFinalGrade(course.id)) as RawGradeValue;
      } catch (error) {
        // Not released yet is normal, not an error
        if (error instanceof D2LApiError && (error.status === 403 || error.status === 404)) return null;
        throw error;
      }
    }),
    part("grades", errors, async () => (await client.getMyGradeValues(course.id)) as RawGradeValue[]),
    part("assignments", errors, async () => {
      const all = (await client.getDropboxFolders(course.id)) as RawFolder[];
      // Only check submissions for folders in the window; that's where "submitted?" matters
      return Promise.all(
        all.map(async (folder) => {
          const dueIso = folder.DueDate ?? folder.Availability?.EndDate;
          const due = dueIso ? Date.parse(dueIso) : NaN;
          const inWindow = due >= w.now - w.overdueDaysBack * DAY && due <= w.now + w.daysAhead * DAY;
          if (folder.IsHidden || !inWindow) return { folder, submitted: null };
          try {
            const subs = (await client.getDropboxSubmissions(course.id, folder.Id)) as RawSubmission[];
            return { folder, submitted: subs.some(isSubmitted) };
          } catch {
            return { folder, submitted: null };
          }
        })
      );
    }),
    part("calendar", errors, async () => ((await client.getMyCalendarEvents(course.id, start, end)) as { Objects: RawCalendarEvent[] }).Objects),
    part("announcements", errors, async () => (await client.getNews(course.id)) as RawNews[]),
  ]);
  return { finalGrade, gradeItems, folders, events, news, errors };
}

export async function amICooked(args: { daysAhead?: number; overdueDaysBack?: number; announcementsDays?: number; courses?: string[] }) {
  // Log in once up front so a fan-out over every course doesn't race to open login windows
  await getToken();
  const w: Window = {
    now: Date.now(),
    daysAhead: args.daysAhead ?? 7,
    overdueDaysBack: args.overdueDaysBack ?? 14,
    announcementsDays: args.announcementsDays ?? 7,
  };

  const all = await listCourses();
  const selected = args.courses?.length
    ? [...new Map(args.courses.flatMap((q) => matchCourses(all, q)).map((c) => [c.id, c])).values()]
    : currentCourses(all);
  const skipped = all.filter((c) => c.isActive && !selected.some((s) => s.id === c.id)).map((c) => ({ code: c.code, reason: "not this term" }));

  const courses = await Promise.all(selected.map(async (c) => buildCourseReport(c, await fetchCourseData(c, w), w)));
  const { heat, heatLabel, reasons } = heatScore(courses);
  const graded = courses.filter((c) => c.grade.percent !== null);
  const lowest = graded.sort((a, b) => a.grade.percent! - b.grade.percent!)[0];

  return {
    generatedAt: new Date(w.now).toISOString(),
    school: getSchool().name,
    window: { daysAhead: w.daysAhead, overdueDaysBack: w.overdueDaysBack },
    summary: {
      heat,
      heatLabel,
      reasons,
      courses: courses.length,
      dueSoon: courses.reduce((n, c) => n + c.dueSoon.length, 0),
      overdue: courses.reduce((n, c) => n + c.overdue.length, 0),
      newAnnouncements: courses.reduce((n, c) => n + c.announcements.count, 0),
      lowestGrade: lowest ? { course: lowest.code, percent: lowest.grade.percent, source: lowest.grade.source } : null,
    },
    courses: courses.sort((a, b) => a.code.localeCompare(b.code)),
    skippedCourses: skipped,
    notes: [
      "Times are UTC; convert to the student's local time.",
      "estimated_from_items grades ignore dropped or bonus items, so treat them as rough.",
      "Quiz completion isn't known (submitted: null).",
    ],
  };
}

export const amICookedTool: Tool = {
  name: "am_i_cooked",
  description:
    'One-call overview across all current courses: grade so far, what is due soon, overdue unsubmitted work, and new announcements, plus a heat score (0-10: raw, warming up, toasty, cooked, well done). Start here for "am I cooked?", "what should I work on?", "how am I doing?" or "what\'s due this week?".',
  schema: {
    daysAhead: z.coerce.number().min(1).max(60).optional().describe("How far ahead to look for due dates (default 7)"),
    overdueDaysBack: z.coerce.number().min(0).max(60).optional().describe("How far back to look for missed work (default 14)"),
    announcementsDays: z.coerce.number().min(1).max(60).optional().describe("Count announcements from the last N days (default 7)"),
    courses: z.array(z.string()).optional().describe('Limit to these course codes or names, e.g. ["3BB4"]'),
  },
  handler: async (args) => JSON.stringify(await amICooked(args)),
};
