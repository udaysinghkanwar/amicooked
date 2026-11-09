import { describe, expect, it } from "vitest";
import type { Course } from "../../src/courseResolver.js";
import {
  buildCourseReport,
  estimateGrade,
  heatScore,
  type CourseData,
  type RawFolder,
  type RawGradeValue,
  type Window,
} from "../../src/tools/cooked.js";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const w: Window = { now: NOW, daysAhead: 7, overdueDaysBack: 14, announcementsDays: 7 };
const hours = (h: number) => new Date(NOW + h * 3600000).toISOString();
const course: Course = { id: 1, code: "SFWRENG_3BB4", name: "Concurrent Systems", isActive: true, lastAccessed: null, endDate: null, pinned: true };

const item = (num: number | null, den: number, weights?: [number, number], type = 1): RawGradeValue => ({
  GradeObjectName: "x",
  GradeObjectType: type,
  PointsNumerator: num,
  PointsDenominator: den,
  WeightedNumerator: weights?.[0] ?? null,
  WeightedDenominator: weights?.[1] ?? null,
  DisplayedGrade: null,
});

const folder = (id: number, due: string, extra: Partial<RawFolder> = {}): RawFolder => ({ Id: id, Name: `A${id}`, DueDate: due, ...extra });

const data = (overrides: Partial<CourseData> = {}): CourseData => ({
  finalGrade: null,
  gradeItems: [],
  folders: [],
  events: [],
  news: [],
  errors: [],
  ...overrides,
});

describe("estimateGrade", () => {
  it("uses weights when the course has them", () => {
    expect(estimateGrade([item(9, 10, [9, 10]), item(5, 10, [15, 30])]).percent).toBe(60);
  });

  it("falls back to points and skips ungraded and category items", () => {
    expect(estimateGrade([item(8, 10), item(null, 10), item(50, 100, undefined, 9)])).toEqual({ percent: 80, gradedItems: 1 });
  });

  it("returns null with nothing graded", () => {
    expect(estimateGrade([item(null, 10)]).percent).toBeNull();
  });
});

describe("buildCourseReport", () => {
  it("prefers the released final grade over the estimate", () => {
    const final = { ...item(42, 50), DisplayedGrade: "84 %" };
    const r = buildCourseReport(course, data({ finalGrade: final, gradeItems: [item(1, 10)] }), w);
    expect(r.grade).toMatchObject({ percent: 84, source: "final_calculated" });
  });

  it("splits assignments into due soon and overdue, ignoring submitted and hidden ones", () => {
    const r = buildCourseReport(
      course,
      data({
        folders: [
          { folder: folder(1, hours(20)), submitted: false },
          { folder: folder(2, hours(-48), { Availability: { StartDate: null, EndDate: hours(24) } }), submitted: false },
          { folder: folder(3, hours(-48)), submitted: true },
          { folder: folder(4, hours(10), { IsHidden: true }), submitted: false },
          { folder: folder(5, hours(24 * 30)), submitted: null },
        ],
      }),
      w
    );
    expect(r.dueSoon.map((d) => d.assignmentId)).toEqual([1]);
    expect(r.overdue).toEqual([expect.objectContaining({ assignmentId: 2, daysLate: 2, stillOpenUntil: hours(24) })]);
    expect(r.signals).toEqual(expect.arrayContaining(["overdue_work", "late_window_open", "no_grades_released"]));
  });

  it("adds quizzes from the calendar without double-counting dropboxes", () => {
    const event = (title: string, type: string, id: number, end: string) => ({
      CalendarEventId: id, OrgUnitId: 1, Title: title, Description: "", StartDateTime: end, EndDateTime: end,
      CalendarEventViewUrl: "", OrgUnitName: "", AssociatedEntity: { AssociatedEntityType: type, AssociatedEntityId: id, Link: "" },
    });
    const r = buildCourseReport(
      course,
      data({
        folders: [{ folder: folder(7, hours(30)), submitted: false }],
        events: [event("Lab 7 - Due", "D2L.LE.Dropbox.Dropbox", 7, hours(30)), event("Quiz 3", "D2L.LE.Quizzing.Quiz", 99, hours(50))],
      }),
      w
    );
    expect(r.dueSoon.map((d) => [d.title, d.type])).toEqual([["A7", "assignment"], ["Quiz 3", "quiz"]]);
  });

  it("counts recent announcements and flags partial data", () => {
    const r = buildCourseReport(
      course,
      data({
        news: [{ Title: "Old", StartDate: hours(-24 * 30) }, { Title: "Room change", StartDate: hours(-5) }],
        errors: [{ part: "calendar", message: "timeout" }],
      }),
      w
    );
    expect(r.announcements).toEqual({ count: 1, latest: [{ title: "Room change", date: hours(-5) }] });
    expect(r.signals).toContain("partial_data");
  });
});

describe("heatScore", () => {
  const report = (overrides: object) => ({ ...buildCourseReport(course, data(), w), ...overrides });

  it("is raw with nothing going on", () => {
    expect(heatScore([report({})]).heatLabel).toBe("raw");
  });

  it("adds up overdue work, urgent deadlines and low grades, capped at 10", () => {
    const overdue = [{ title: "x", due: "", daysLate: 1, stillOpenUntil: null, assignmentId: 1 }];
    const dueSoon = [{ title: "y", type: "assignment", due: "", dueInHours: 12, submitted: false }];
    const r = report({ overdue, dueSoon, grade: { percent: 55, display: null, source: "estimated_from_items", gradedItems: 3 } });
    expect(heatScore([r])).toMatchObject({ heat: 5, heatLabel: "toasty" });
    expect(heatScore([r, r, r]).heat).toBe(10);
    expect(heatScore([r, r, r]).heatLabel).toBe("well done");
  });
});
