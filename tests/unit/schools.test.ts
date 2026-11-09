import { describe, expect, it } from "vitest";
import { checkBrightspaceHost, detectSchool, findPreset } from "../../src/schools.js";

const versions = JSON.stringify([
  { ProductCode: "le", SupportedVersions: ["1.57"] },
  { ProductCode: "lp", SupportedVersions: ["1.43"] },
]);

/** A fake fetch serving `routes` keyed by URL; anything else is a 404. */
function fakeFetch(routes: Record<string, { body: string; redirectTo?: string }>): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const route = routes[url];
    if (!route) return { ok: false, status: 404, url, text: async () => "", json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      url: route.redirectTo ?? url,
      text: async () => route.body,
      json: async () => JSON.parse(route.body),
    };
  }) as unknown as typeof fetch;
}

describe("schools", () => {
  it("finds presets by id or host", () => {
    expect(findPreset("McMaster")?.host).toBe("avenue.cllmcmaster.ca");
    expect(findPreset("learn.uwaterloo.ca")?.id).toBe("waterloo");
  });

  it("matches a preset from its SSO login URL", async () => {
    const school = await detectSchool("https://avenue.mcmaster.ca/login.php", fakeFetch({}));
    expect(school.id).toBe("mcmaster");
  });

  it("accepts a bare D2L host", async () => {
    const fetchImpl = fakeFetch({ "https://lms.example.edu/d2l/api/versions/": { body: versions } });
    const school = await detectSchool("lms.example.edu/d2l/home", fetchImpl);
    expect(school).toMatchObject({ id: "custom", host: "lms.example.edu" });
    expect(school.loginUrl).toBeUndefined();
  });

  it("follows a redirect to the D2L host and keeps the pasted URL for login", async () => {
    const fetchImpl = fakeFetch({
      "https://go.example.edu/": { body: "<html></html>", redirectTo: "https://d2l.example.edu/d2l/login" },
      "https://d2l.example.edu/d2l/api/versions/": { body: versions },
    });
    const school = await detectSchool("go.example.edu", fetchImpl);
    expect(school.host).toBe("d2l.example.edu");
    expect(school.loginUrl).toBe("https://go.example.edu/");
  });

  it("finds the D2L host linked from a portal page", async () => {
    const fetchImpl = fakeFetch({
      "https://portal.example.edu/": { body: '<a href="https://courses.example.edu/d2l/home">Courses</a>' },
      "https://courses.example.edu/d2l/api/versions/": { body: versions },
    });
    expect((await detectSchool("portal.example.edu", fetchImpl)).host).toBe("courses.example.edu");
  });

  it("rejects hosts without the API versions we need", async () => {
    const old = JSON.stringify([{ ProductCode: "le", SupportedVersions: ["1.10"] }]);
    const fetchImpl = fakeFetch({ "https://old.example.edu/d2l/api/versions/": { body: old } });
    expect(await checkBrightspaceHost("old.example.edu", fetchImpl)).toBe(false);
    await expect(detectSchool("old.example.edu", fetchImpl)).rejects.toThrow(/Couldn't find D2L/);
  });
});
