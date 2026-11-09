import { describe, expect, it } from "vitest";
import { currentCourses, matchCourses, type Course } from "../../src/courseResolver.js";

const course = (id: number, code: string, name: string, isActive = true): Course => ({
  id, code, name, isActive, lastAccessed: null, endDate: null, pinned: false,
});

const courses = [
  course(101, "SFWRENG_3BB4_2026FALL", "SFWRENG 3BB4 - Concurrent Systems"),
  course(102, "COMPSCI_3MX3_2026FALL", "COMPSCI 3MX3 - Machine Learning"),
  course(90, "SFWRENG_3BB4_2025FALL", "SFWRENG 3BB4 - Concurrent Systems", false),
];

describe("matchCourses", () => {
  it("matches an exact org unit ID", () => {
    expect(matchCourses(courses, "102").map((c) => c.id)).toEqual([102]);
  });

  it("matches a code token regardless of case", () => {
    expect(matchCourses(courses, "3mx3").map((c) => c.id)).toEqual([102]);
  });

  it("returns every offering of a course code", () => {
    expect(matchCourses(courses, "3BB4").map((c) => c.id)).toEqual([101, 90]);
  });

  it("falls back to a name substring", () => {
    expect(matchCourses(courses, "machine learn").map((c) => c.id)).toEqual([102]);
  });

  it("returns nothing for unknown courses", () => {
    expect(matchCourses(courses, "4HC3")).toEqual([]);
  });
});

describe("currentCourses", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  const at = (daysAgo: number) => new Date(now - daysAgo * 86400000).toISOString();

  it("keeps active courses opened recently or pinned", () => {
    const list = [
      { ...course(1, "A_1", "A"), lastAccessed: at(3) },
      { ...course(2, "B_1", "B"), pinned: true },
      { ...course(3, "C_1", "C"), lastAccessed: at(400) },
      { ...course(4, "D_1", "D", false), lastAccessed: at(1) },
    ];
    expect(currentCourses(list, now).map((c) => c.id)).toEqual([1, 2]);
  });

  it("drops courses that ended weeks ago", () => {
    const list = [{ ...course(1, "A_1", "A"), pinned: true, endDate: at(30) }];
    expect(currentCourses(list, now)).toEqual([]);
  });

  it("falls back to all active courses when none look recent", () => {
    const list = [{ ...course(1, "A_1", "A"), lastAccessed: at(300) }];
    expect(currentCourses(list, now).map((c) => c.id)).toEqual([1]);
  });
});
