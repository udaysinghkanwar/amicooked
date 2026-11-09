import { describe, expect, it } from "vitest";
import { matchCourses, type Course } from "../../src/courseResolver.js";

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
