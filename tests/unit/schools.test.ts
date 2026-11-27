import { describe, expect, it, vi } from "vitest";
import { AmbiguousSchoolError, checkBrightspaceHost, detectSchool, findPreset, PRESETS, resolveSchool, searchSchools } from "../../src/schools.js";

const versions = JSON.stringify([
  { ProductCode: "le", SupportedVersions: ["1.57"] },
  { ProductCode: "lp", SupportedVersions: ["1.43"] },
]);

/** A fake fetch serving `routes` keyed by URL; anything else is a 404. */
function fakeFetch(routes: Record<string, { body: string; redirectTo?: string }>): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const route = routes[url];
    const response = new Response(route?.body ?? "", { status: route ? 200 : 404 });
    Object.defineProperty(response, "url", { value: route?.redirectTo ?? url });
    return response;
  }) as unknown as typeof fetch;
}

describe("schools", () => {
  it("finds presets by id or host", () => {
    expect(findPreset("McMaster")?.host).toBe("avenue.cllmcmaster.ca");
    expect(findPreset("learn.uwaterloo.ca")?.id).toBe("waterloo");
    expect(findPreset("  McMaster University ")?.id).toBe("mcmaster");
    expect(findPreset("Queen’s University")?.id).toBe("queens");
  });

  it("matches a preset from its SSO login URL", async () => {
    const school = await detectSchool("https://avenue.mcmaster.ca/login.php", fakeFetch({}));
    expect(school.id).toBe("mcmaster");
  });

  it("resolves board acronyms, full names, directory aliases and login URLs without directory access", async () => {
    const fetchImpl = vi.fn();
    for (const board of PRESETS.filter((s) => s.host.endsWith("elearningontario.ca") || s.host.endsWith("apprentissageelectroniqueontario.ca"))) {
      for (const input of [board.id.toUpperCase(), board.name, ...(board.aliases ?? []), board.loginUrl!]) {
        expect((await resolveSchool(input, fetchImpl)).host, input).toBe(board.host);
      }
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps only the universities, TDSB and Peel as presets", () => {
    expect(PRESETS.map((s) => s.id)).toEqual(["mcmaster", "waterloo", "western", "queens", "guelph", "laurier", "tmu",
      "uottawa", "carleton", "brock", "windsor", "laurentian", "lakehead", "mcgill", "ucalgary", "tdsb", "pdsb"]);
    expect(findPreset("waterloo")?.host).toBe("learn.uwaterloo.ca");
    expect(findPreset("lakehead")?.host).toBe("mycourselink.lakeheadu.ca");
    expect(findPreset("Toronto DSB")?.host).toBe("tdsb.elearningontario.ca");
    expect(findPreset("Peel DSB")?.host).toBe("pdsb.elearningontario.ca");
    expect(findPreset("wrdsb")).toBeUndefined();
    expect(findPreset("Toronto")).toBeUndefined();
    expect(findPreset("York")).toBeUndefined();
    expect(findPreset("Peel")).toBeUndefined();
  });

  it("has no conflicting preset identifiers, names, hosts or aliases", () => {
    const owners = new Map<string, string>();
    for (const school of PRESETS) {
      for (const input of [school.id, school.name, school.host, ...(school.aliases ?? [])]) {
        const key = input.trim().toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ");
        expect(owners.get(key) ?? school.id, input).toBe(school.id);
        owners.set(key, school.id);
      }
    }
  });

  it.each([
    { id: "mcgill", host: "mycourses2.mcgill.ca", inputs: ["McGill", " McGill University ", "mycourses2.mcgill.ca", "https://mycourses2.mcgill.ca/d2l/home"] },
    { id: "ucalgary", host: "d2l.ucalgary.ca", inputs: ["ucalgary", "University of Calgary", " Calgary ", "U of C", "d2l.ucalgary.ca", "https://d2l.ucalgary.ca/d2l/home"] },
  ])("resolves $id names and portal URLs without directory access", async ({ id, host, inputs }) => {
    const fetchImpl = vi.fn();
    for (const input of inputs) {
      expect(await resolveSchool(input, fetchImpl)).toMatchObject({ id, host });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it("accepts a deep course URL using only the host's public API check", async () => {
    const fetchImpl = vi.fn(fakeFetch({ "https://lms.example.edu/d2l/api/versions/": { body: versions } }));
    expect((await detectSchool("https://lms.example.edu/d2l/le/content/123/Home#section", fetchImpl)).host).toBe("lms.example.edu");
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual(["https://lms.example.edu/d2l/api/versions/"]);
  });

  it("finds an LMS root URL from a Brightspace-labelled link", async () => {
    const fetchImpl = fakeFetch({
      "https://portal.example.edu/": { body: '<a href="https://courses.example.edu">Open <strong>Brightspace</strong></a>' },
      "https://courses.example.edu/d2l/api/versions/": { body: versions },
    });
    expect(await detectSchool("portal.example.edu", fetchImpl)).toMatchObject({ host: "courses.example.edu", loginUrl: "https://portal.example.edu/" });
  });

  it("follows a relative LMS landing-page link using the redirected page as its base", async () => {
    const fetchImpl = fakeFetch({
      "https://go.example.edu/": { body: "<a href='../brightspace'>Course access</a>", redirectTo: "https://www.example.edu/students/index" },
      "https://www.example.edu/brightspace": { body: '<a href="//courses.example.edu/d2l/home">Sign in</a>' },
      "https://courses.example.edu/d2l/api/versions/": { body: versions },
    });
    expect((await detectSchool("go.example.edu", fetchImpl)).host).toBe("courses.example.edu");
  });

  it("handles HTML-escaped LMS links", async () => {
    const fetchImpl = fakeFetch({
      "https://portal.example.edu/": { body: '<a href="/brightspace?view=student&amp;lang=en">Brightspace</a>' },
      "https://portal.example.edu/brightspace?view=student&lang=en": { body: '<a href="https://courses.example.edu/d2l/home">Courses</a>' },
      "https://courses.example.edu/d2l/api/versions/": { body: versions },
    });
    expect((await detectSchool("portal.example.edu", fetchImpl)).host).toBe("courses.example.edu");
  });

  it("detects an intermediate Brightspace host even when redirects end at an identity provider", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://go.example.edu/") return new Response(null, { status: 302, headers: { location: "https://courses.example.edu/d2l/login" } });
      if (url === "https://courses.example.edu/d2l/login") return new Response(null, { status: 302, headers: { location: "https://idp.example.edu/sso?SAMLRequest=temporary" } });
      if (url === "https://courses.example.edu/d2l/api/versions/") return new Response(versions);
      return new Response("", { status: 403 });
    }) as unknown as typeof fetch;
    expect(await detectSchool("go.example.edu", fetchImpl)).toMatchObject({
      host: "courses.example.edu", loginUrl: "https://go.example.edu/",
    });
  });

  it("returns multiple verified instances for selection instead of taking the first link", async () => {
    const fetchImpl = fakeFetch({
      "https://portal.example.edu/": { body: '<a href="https://students.example.edu/d2l/home">Students</a><a href="https://training.example.edu/d2l/home">Staff training</a>' },
      "https://students.example.edu/d2l/api/versions/": { body: versions },
      "https://training.example.edu/d2l/api/versions/": { body: versions },
    });
    await expect(detectSchool("portal.example.edu", fetchImpl)).rejects.toMatchObject({ matches: [
      { name: "students.example.edu", loginUrl: "https://students.example.edu/d2l/home" },
      { name: "training.example.edu", loginUrl: "https://training.example.edu/d2l/home" },
    ] });
    // A selected result resolves directly instead of scanning the ambiguous original portal again.
    expect((await resolveSchool("https://students.example.edu/d2l/home", fetchImpl)).host).toBe("students.example.edu");
  });

  it("keeps discovery bounded and ignores unrelated links", async () => {
    const html = Array.from({ length: 30 }, (_, i) => `<a href="https://lms${i}.example.edu/">Brightspace</a>`).join("") +
      '<a href="https://unrelated.example.edu/">Contact us</a>';
    const fetchImpl = vi.fn(fakeFetch({ "https://portal.example.edu/": { body: html } }));
    await expect(detectSchool("portal.example.edu", fetchImpl)).rejects.toThrow(/Couldn't find D2L/);
    const requests = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(requests.some((url) => url.includes("unrelated.example.edu"))).toBe(false);
    expect(requests.filter((url) => url.includes("/d2l/api/versions/"))).toHaveLength(8);
    expect(requests.filter((url) => !url.includes("/d2l/api/versions/"))).toHaveLength(3);
  });

  it("rejects embedded credentials, insecure URLs and temporary auth links without fetching them", async () => {
    const fetchImpl = vi.fn();
    for (const url of ["https://user:secret@example.edu", "http://example.edu", "ftp://example.edu", "javascript:123", "data:text/plain,hello", "https://example.edu/sso?SAMLResponse=private", "https://example.edu/callback?code=private"]) {
      await expect(resolveSchool(url, fetchImpl)).rejects.toThrow(/HTTPS|temporary sign-in/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cancels oversized portal responses instead of downloading the entire body", async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input) === "https://portal.example.edu/") {
        return new Response(new ReadableStream({
          pull(controller) { controller.enqueue(new Uint8Array(64000).fill(32)); },
          cancel,
        }));
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    await expect(detectSchool("portal.example.edu", fetchImpl)).rejects.toThrow(/Couldn't find D2L/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not label an API redirect as the original LMS host", async () => {
    const fetchImpl = fakeFetch({
      "https://alias.example.edu/d2l/api/versions/": { body: versions, redirectTo: "https://courses.example.edu/d2l/api/versions/" },
    });
    expect(await checkBrightspaceHost("alias.example.edu", fetchImpl)).toBe(false);
  });

  it("rejects malformed API version payloads", async () => {
    const body = JSON.stringify([{ ProductCode: "le", SupportedVersions: "1.57" }, { ProductCode: "lp", SupportedVersions: "1.43" }]);
    const fetchImpl = fakeFetch({ "https://courses.example.edu/d2l/api/versions/": { body } });
    expect(await checkBrightspaceHost("courses.example.edu", fetchImpl)).toBe(false);
  });

  it("rejects hosts without the API versions we need", async () => {
    const old = JSON.stringify([{ ProductCode: "le", SupportedVersions: ["1.10"] }]);
    const fetchImpl = fakeFetch({ "https://old.example.edu/d2l/api/versions/": { body: old } });
    expect(await checkBrightspaceHost("old.example.edu", fetchImpl)).toBe(false);
    await expect(detectSchool("old.example.edu", fetchImpl)).rejects.toThrow(/Couldn't find D2L/);
  });
});

const directoryUrl = (name: string) => `https://lms-disco.api.brightspace.com/institutions?${new URLSearchParams({ contains: name })}`;
const directory = (matches: Array<[string, string]>) => JSON.stringify({
  class: ["institutions", "searchable"],
  entities: matches.map(([name, href]) => ({
    properties: { name },
    // Match by relation, not array position: self is not the LMS.
    links: [{ rel: ["lms"], href }, { rel: ["self"], href: "https://lms-disco.api.brightspace.com/institutions/123" }],
  })),
});

describe("school-name discovery", () => {
  it("resolves full preset names without a network request", async () => {
    const fetchImpl = vi.fn();
    expect((await resolveSchool("McMaster University", fetchImpl)).id).toBe("mcmaster");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("finds an unlisted school by name and validates its API", async () => {
    const fetchImpl = fakeFetch({
      [directoryUrl("Example University")]: { body: directory([["Example University", "https://courses.example.edu/login"]]) },
      "https://courses.example.edu/d2l/api/versions/": { body: versions },
    });
    expect(await resolveSchool("Example University", fetchImpl)).toMatchObject({
      id: "custom", name: "Example University", host: "courses.example.edu", loginUrl: "https://courses.example.edu/login",
    });
  });

  it("prefers an exact name to continuing-education and campus matches", async () => {
    const fetchImpl = fakeFetch({
      [directoryUrl("Example University")]: { body: directory([
        ["Example University Continuing Education", "https://other.example.edu"],
        ["Example University", "https://courses.example.edu"],
      ]) },
      "https://courses.example.edu/d2l/api/versions/": { body: versions },
    });
    expect((await resolveSchool("Example University", fetchImpl)).host).toBe("courses.example.edu");
  });

  it("returns alternatives instead of guessing between schools or portals", async () => {
    const fetchImpl = fakeFetch({
      [directoryUrl("Example")]: { body: directory([
        ["Example University", "https://one.example.edu"], ["Example College", "https://two.example.edu"],
      ]) },
    });
    await expect(resolveSchool("Example", fetchImpl)).rejects.toBeInstanceOf(AmbiguousSchoolError);
    await expect(resolveSchool("Example", fetchImpl)).rejects.toMatchObject({ matches: [
      { name: "Example University", loginUrl: "https://one.example.edu/" },
      { name: "Example College", loginUrl: "https://two.example.edu/" },
    ] });
  });

  it("validates a discovered SSO redirect and preserves the directory login URL", async () => {
    const fetchImpl = fakeFetch({
      [directoryUrl("Example")]: { body: directory([["Example University", "https://login.example.edu"]]) },
      "https://login.example.edu/": { body: "", redirectTo: "https://courses.example.edu/d2l/login" },
      "https://courses.example.edu/d2l/api/versions/": { body: versions },
    });
    expect(await resolveSchool("Example", fetchImpl)).toMatchObject({ host: "courses.example.edu", loginUrl: "https://login.example.edu/" });
  });

  it("does not accept a directory result without a compatible Brightspace API", async () => {
    const fetchImpl = fakeFetch({ [directoryUrl("Example")]: { body: directory([["Example", "https://example.edu"]]) } });
    await expect(resolveSchool("Example", fetchImpl)).rejects.toThrow(/Couldn't find D2L/);
  });

  it("keeps pasted URL detection independent of the directory", async () => {
    const fetchImpl = vi.fn(fakeFetch({ "https://lms.example.edu/d2l/api/versions/": { body: versions } }));
    expect((await resolveSchool("lms.example.edu/d2l/home", fetchImpl)).host).toBe("lms.example.edu");
    expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes("lms-disco"))).toBe(true);
  });

  it("handles the directory's no-results response with URL fallback guidance", async () => {
    const fetchImpl = fakeFetch({ [directoryUrl("Unknown")]: { body: JSON.stringify({ class: ["institutions"] }) } });
    await expect(resolveSchool("Unknown", fetchImpl)).rejects.toThrow(/full name or paste/);
  });

  it("handles network failures and malformed responses with URL fallback guidance", async () => {
    for (const fetchImpl of [fakeFetch({}), vi.fn().mockRejectedValue(new Error("offline")), fakeFetch({
      [directoryUrl("Example")]: { body: JSON.stringify({ entities: "unexpected" }) },
    })]) {
      await expect(searchSchools("Example", fetchImpl)).rejects.toThrow(/paste.*portal URL/);
    }
  });

  it("encodes names, deduplicates results and ignores unsafe or malformed links", async () => {
    const name = "Example & Queen's";
    const fetchImpl = fakeFetch({ [directoryUrl(name)]: { body: directory([
      [name, "https://courses.example.edu"], [name, "https://courses.example.edu"],
      [name, "javascript:alert(1)"], [name, "http://courses.example.edu"], [name, "https://user:password@example.edu"],
    ]) } });
    expect(await searchSchools(name, fetchImpl)).toEqual([{ name, loginUrl: "https://courses.example.edu/" }]);
  });

  it("removes terminal control codes from directory names and ignores transient login links", async () => {
    const fetchImpl = fakeFetch({ [directoryUrl("Example")]: { body: directory([
      ["\u001b[31mExample University\u001b[0m\n", "https://courses.example.edu/#overview"],
      ["Example University", "https://courses.example.edu/callback?code=temporary"],
    ]) } });
    expect(await searchSchools("Example", fetchImpl)).toEqual([
      { name: "Example University", loginUrl: "https://courses.example.edu/" },
    ]);
  });
});
